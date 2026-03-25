import { Hono } from "hono";
import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth } from "../lib/session.ts";
import { getBadgeCount } from "../lib/badges.ts";

const apiLeaderboard = new Hono();

type MetricKey = "bodyFatPct" | "skeletalMuscle" | "inbodyScore";

const METRIC_CONFIG: Record<
  MetricKey,
  { label: string; unit: string; lowerIsBetter: boolean }
> = {
  bodyFatPct: { label: "體脂率變化", unit: "%", lowerIsBetter: true },
  skeletalMuscle: { label: "骨骼肌變化", unit: "kg", lowerIsBetter: false },
  inbodyScore: { label: "InBody 分數變化", unit: "", lowerIsBetter: false },
};

// GET /api/rooms/:slug/leaderboard — room-scoped leaderboard
apiLeaderboard.get("/api/rooms/:slug/leaderboard", (c) => {
  const user = requireAuth(c);
  const { slug } = c.req.param();
  const metric = (c.req.query("metric") as MetricKey) || "bodyFatPct";
  const period = c.req.query("period") || "90";

  // Verify room and membership
  const room = db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, slug))
    .get();

  if (!room) return c.json({ error: "Room not found" }, 404);

  const membership = db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        eq(schema.roomMembers.userId, user.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .get();

  if (!membership) return c.json({ error: "Not a member" }, 403);

  // Get all active members of this room
  const members = db
    .select({
      userId: schema.roomMembers.userId,
      name: schema.users.name,
      isGhost: schema.roomMembers.isGhost,
    })
    .from(schema.roomMembers)
    .innerJoin(schema.users, eq(schema.roomMembers.userId, schema.users.id))
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .all();

  // Use room date range as the primary filter (ignore period param for now)
  const roomStart = room.startDate;
  const roomEnd = room.endDate;

  type RankEntry = {
    userId: number;
    name: string;
    isGhost: boolean;
    firstVal: number;
    lastVal: number;
    diff: number;
    count: number;
    badgeCount: number;
  };

  const rankings: RankEntry[] = [];

  for (const m of members) {
    // Ghost filtering: hide ghost members from non-ghost viewers
    if (m.isGhost && m.userId !== user.id) continue;

    let rows = db
      .select({
        measuredAt: schema.reports.measuredAt,
        bodyFatPct: schema.measurements.bodyFatPct,
        skeletalMuscle: schema.measurements.skeletalMuscle,
        inbodyScore: schema.measurements.inbodyScore,
      })
      .from(schema.measurements)
      .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
      .where(eq(schema.reports.userId, m.userId))
      .orderBy(schema.reports.measuredAt)
      .all();

    // Filter to room date range
    rows = rows.filter((r) => {
      const date = r.measuredAt?.slice(0, 10) || "";
      return date >= roomStart && date <= roomEnd;
    });

    if (rows.length < 2) continue;

    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const firstVal = first[metric] as number | null;
    const lastVal = last[metric] as number | null;

    if (firstVal == null || lastVal == null) continue;

    rankings.push({
      userId: m.userId,
      name: m.name,
      isGhost: m.isGhost ?? false,
      firstVal,
      lastVal,
      diff: lastVal - firstVal,
      count: rows.length,
      badgeCount: getBadgeCount(m.userId),
    });
  }

  // Sort
  const cfg = METRIC_CONFIG[metric]!;
  rankings.sort((a, b) => (cfg.lowerIsBetter ? a.diff - b.diff : b.diff - a.diff));

  // Room-scoped MVP: best single-period improvement among room members
  const memberIds = new Set(members.map((m) => m.userId));
  let mvp: { userId: number; name: string; gain: number; metric: string } | null = null;
  if (rankings.length > 0) {
    // MVP = the top-ranked person (best change in the selected metric)
    const top = rankings[0]!;
    mvp = {
      userId: top.userId,
      name: top.name,
      gain: Number(top.diff.toFixed(1)),
      metric,
    };
  }

  return c.json({
    metric,
    metricLabel: cfg.label,
    metricUnit: cfg.unit,
    lowerIsBetter: cfg.lowerIsBetter,
    rankings: rankings.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      name: r.name,
      isMe: r.userId === user.id,
      firstVal: r.firstVal,
      lastVal: r.lastVal,
      diff: Number(r.diff.toFixed(1)),
      count: r.count,
      badgeCount: r.badgeCount,
    })),
    mvp,
  });
});

export default apiLeaderboard;
