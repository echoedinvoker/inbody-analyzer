import { Hono } from "hono";
import { eq, and, isNull, count } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth } from "../lib/session.ts";
import { getBadgeCount } from "../lib/badges.ts";
import { predictAllInRoom } from "../lib/predict-room.ts";

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

/**
 * Get a member's measurement rows for ranking.
 * Mirror mode: only submitted data. Open mode: date-range filter.
 */
function getMemberRows(
  userId: number,
  roomId: number,
  room: { startDate: string; endDate: string; visibilityMode: string | null }
) {
  if (room.visibilityMode === "mirror") {
    return db
      .select({
        measuredAt: schema.reports.measuredAt,
        bodyFatPct: schema.measurements.bodyFatPct,
        skeletalMuscle: schema.measurements.skeletalMuscle,
        inbodyScore: schema.measurements.inbodyScore,
      })
      .from(schema.roomSubmissions)
      .innerJoin(schema.reports, eq(schema.roomSubmissions.reportId, schema.reports.id))
      .innerJoin(schema.measurements, eq(schema.measurements.reportId, schema.reports.id))
      .where(
        and(
          eq(schema.roomSubmissions.roomId, roomId),
          eq(schema.roomSubmissions.userId, userId)
        )
      )
      .orderBy(schema.reports.measuredAt)
      .all();
  }

  return db
    .select({
      measuredAt: schema.reports.measuredAt,
      bodyFatPct: schema.measurements.bodyFatPct,
      skeletalMuscle: schema.measurements.skeletalMuscle,
      inbodyScore: schema.measurements.inbodyScore,
    })
    .from(schema.measurements)
    .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
    .where(
      and(
        eq(schema.reports.userId, userId),
        eq(schema.reports.confirmed, true)
      )
    )
    .orderBy(schema.reports.measuredAt)
    .all()
    .filter((r) => {
      const date = r.measuredAt?.slice(0, 10) || "";
      return date >= room.startDate && date <= room.endDate;
    });
}

apiLeaderboard.get("/api/rooms/:slug/leaderboard", (c) => {
  const user = requireAuth(c);
  const { slug } = c.req.param();
  const metric = (c.req.query("metric") as MetricKey) || "bodyFatPct";

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

  const isMirror = room.visibilityMode === "mirror";

  // Get submission counts per member (mirror mode)
  let subCountMap = new Map<number, number>();
  let mySubCount = 0;
  let maxSubCount = 0;

  if (isMirror) {
    const allSubs = db
      .select({
        userId: schema.roomSubmissions.userId,
        cnt: count(),
      })
      .from(schema.roomSubmissions)
      .where(eq(schema.roomSubmissions.roomId, room.id))
      .groupBy(schema.roomSubmissions.userId)
      .all();

    subCountMap = new Map(allSubs.map((s) => [s.userId, s.cnt]));
    mySubCount = subCountMap.get(user.id) ?? 0;
    maxSubCount = Math.max(0, ...allSubs.map((s) => s.cnt));
  }

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

  type RankEntry = {
    userId: number;
    name: string;
    isGhost: boolean;
    firstVal: number;
    lastVal: number;
    diff: number;
    count: number;
    badgeCount: number;
    submissionCount: number;
    hasHidden: boolean;
  };

  const rankings: RankEntry[] = [];
  const trendData: Record<string, { dates: string[]; values: number[] }> = {};
  const unqualifiedMembers: Array<{ userId: number; name: string; count: number; isMe: boolean }> = [];
  const minSubs = room.minSubmissions ?? 3;

  for (const m of members) {
    if (m.isGhost && m.userId !== user.id) continue;

    const rows = getMemberRows(m.userId, room.id, room);
    const theirSubCount = subCountMap.get(m.userId) ?? rows.length;
    const actualCount = isMirror ? theirSubCount : rows.length;

    // Mirror visibility: only show first N rows (N = viewer's submission count)
    let visibleRows = rows;
    if (isMirror && m.userId !== user.id) {
      visibleRows = rows.slice(0, mySubCount);
    }

    // Build trend data from visible rows
    const metricValues = visibleRows
      .filter((r) => r[metric] != null)
      .map((r) => ({
        date: r.measuredAt?.slice(0, 10) || "",
        value: r[metric] as number,
      }));

    if (metricValues.length > 0) {
      trendData[m.name] = {
        dates: metricValues.map((v) => v.date),
        values: metricValues.map((v) => v.value),
      };
    }

    // Track unqualified members (below minSubmissions)
    if (actualCount < minSubs) {
      unqualifiedMembers.push({
        userId: m.userId,
        name: m.name,
        count: actualCount,
        isMe: m.userId === user.id,
      });
    }

    // Ranking uses visible rows only
    if (visibleRows.length < 2) continue;

    const first = visibleRows[0]!;
    const last = visibleRows[visibleRows.length - 1]!;
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
      count: visibleRows.length,
      badgeCount: getBadgeCount(m.userId),
      submissionCount: theirSubCount,
      hasHidden: isMirror && theirSubCount > (m.userId === user.id ? 0 : mySubCount),
    });
  }

  const cfg = METRIC_CONFIG[metric]!;
  rankings.sort((a, b) => (cfg.lowerIsBetter ? a.diff - b.diff : b.diff - a.diff));

  // Rank type and range
  let rankType: "real" | "estimated" = "real";
  let rankRange: { min: number; max: number } | null = null;

  if (isMirror) {
    rankType = mySubCount >= maxSubCount ? "real" : "estimated";
    if (rankType === "estimated") {
      const myRankEntry = rankings.find((r) => r.isMe || r.userId === user.id);
      if (myRankEntry) {
        const myIdx = rankings.indexOf(myRankEntry);
        const hiddenCount = rankings.filter((r) => r.hasHidden && r.userId !== user.id).length;
        rankRange = {
          min: Math.max(1, myIdx + 1 - hiddenCount),
          max: Math.min(rankings.length, myIdx + 1 + hiddenCount),
        };
      }
    }
  }

  // MVP
  let mvp: { userId: number; name: string; gain: number; metric: string } | null = null;
  if (rankings.length > 0) {
    const top = rankings[0]!;
    mvp = {
      userId: top.userId,
      name: top.name,
      gain: Number(top.diff.toFixed(1)),
      metric,
    };
  }

  // Predictions
  let predictions: Array<{
    userId: number;
    name: string;
    predictedValue: number;
    predictedChange: number;
  }> = [];

  try {
    const allPredictions = predictAllInRoom(room.id, room);
    predictions = allPredictions.map((p) => ({
      userId: p.userId,
      name: p.name,
      predictedValue: p.predictedValue,
      predictedChange: p.predictedChange,
    }));
  } catch {}

  return c.json({
    metric,
    metricLabel: cfg.label,
    metricUnit: cfg.unit,
    lowerIsBetter: cfg.lowerIsBetter,
    rankType,
    rankRange,
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
      submissionCount: r.submissionCount,
      hasHidden: r.hasHidden,
    })),
    mvp,
    predictions,
    trendData,
    unqualifiedMembers,
    room: {
      mode: room.mode,
      endDate: room.endDate,
      memberCount: members.filter((m) => !m.isGhost).length,
      visibilityMode: room.visibilityMode,
      minSubmissions: minSubs,
    },
    mirrorInfo: isMirror ? { mySubmissions: mySubCount, maxSubmissions: maxSubCount } : undefined,
  });
});

export default apiLeaderboard;
