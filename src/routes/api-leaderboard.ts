import { Hono } from "hono";
import { eq, and, isNull, count, desc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth } from "../lib/session.ts";
import { getBadgeCount } from "../lib/badges.ts";
import { predictAllInRoom } from "../lib/predict-room.ts";
import { isRoomEnded, applyMirrorFilter, resolveRankType, computeHasHidden, classifyMember } from "../lib/room-utils.ts";

const apiLeaderboard = new Hono();

type MetricKey = "bodyFatPct" | "skeletalMuscle" | "inbodyScore";

function getMyLatestMeasuredAt(userId: number, roomId: number): string {
  const latest = db
    .select({ measuredAt: schema.reports.measuredAt })
    .from(schema.roomSubmissions)
    .innerJoin(schema.reports, eq(schema.roomSubmissions.reportId, schema.reports.id))
    .where(and(
      eq(schema.roomSubmissions.roomId, roomId),
      eq(schema.roomSubmissions.userId, userId)
    ))
    .orderBy(desc(schema.reports.measuredAt))
    .limit(1)
    .get();
  return latest?.measuredAt?.slice(0, 10) || "";
}

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

  if (!room || !room.isActive) return c.json({ error: "Room not found" }, 404);

  const isEnded = isRoomEnded(room.endDate);

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
  let myLatestDate = "";

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
    myLatestDate = getMyLatestMeasuredAt(user.id, room.id);
  }

  const members = db
    .select({
      userId: schema.roomMembers.userId,
      name: schema.users.name,
      isGhost: schema.roomMembers.isGhost,
      weightMultiplier: schema.roomMembers.weightMultiplier,
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

  let maxOtherDate = "";
  let totalHiddenCount = 0;

  type RankEntry = {
    userId: number;
    name: string;
    isGhost: boolean;
    multiplier: number;
    firstVal: number;
    lastVal: number;
    rawDiff: number;
    weightedDiff: number;
    diff: number;
    count: number;
    badgeCount: number;
    submissionCount: number;
    hasHidden: boolean;
  };

  const rankings: RankEntry[] = [];
  const trendData: Record<string, { dates: string[]; values: number[] }> = {};
  const unqualifiedMembers: Array<{
    userId: number; name: string; count: number; isMe: boolean;
    reason: "no_participation" | "below_minimum";
  }> = [];
  const minSubs = room.minSubmissions ?? 3;

  for (const m of members) {
    if (m.isGhost && m.userId !== user.id) continue;

    const rows = getMemberRows(m.userId, room.id, room);
    const theirSubCount = subCountMap.get(m.userId) ?? rows.length;
    const actualCount = isMirror ? theirSubCount : rows.length;

    // Mirror visibility: time-based filter (bypassed when room ended)
    let visibleRows = rows;
    if (isMirror && m.userId !== user.id) {
      visibleRows = applyMirrorFilter(rows, { isMe: false, isEnded, myLatestDate });
      // Track max date across other members (for rankType calculation)
      const lastDate = rows.at(-1)?.measuredAt?.slice(0, 10) ?? "";
      if (lastDate > maxOtherDate) maxOtherDate = lastDate;
      totalHiddenCount += rows.length - visibleRows.length;
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

    const classification = classifyMember(actualCount, minSubs);
    if (classification === "no_participation") {
      unqualifiedMembers.push({
        userId: m.userId, name: m.name, count: actualCount,
        isMe: m.userId === user.id, reason: "no_participation",
      });
      continue;
    }
    if (classification === "below_minimum") {
      unqualifiedMembers.push({
        userId: m.userId, name: m.name, count: actualCount,
        isMe: m.userId === user.id, reason: "below_minimum",
      });
    }

    // Ranking uses visible rows only
    if (visibleRows.length < 2) continue;

    const first = visibleRows[0]!;
    const last = visibleRows[visibleRows.length - 1]!;
    const firstVal = first[metric] as number | null;
    const lastVal = last[metric] as number | null;

    if (firstVal == null || lastVal == null) continue;

    const multiplier = m.weightMultiplier ?? 1.0;
    const rawDiff = lastVal - firstVal;
    const weightedDiff = rawDiff * multiplier;

    rankings.push({
      userId: m.userId,
      name: m.name,
      isGhost: m.isGhost ?? false,
      multiplier,
      firstVal,
      lastVal,
      rawDiff,
      weightedDiff,
      diff: weightedDiff,
      count: visibleRows.length,
      badgeCount: getBadgeCount(m.userId),
      submissionCount: theirSubCount,
      hasHidden: computeHasHidden(rows, { isMirror, isEnded, isMe: m.userId === user.id, myLatestDate }),
    });
  }

  const cfg = METRIC_CONFIG[metric]!;
  rankings.sort((a, b) => (cfg.lowerIsBetter ? a.weightedDiff - b.weightedDiff : b.weightedDiff - a.weightedDiff));

  // Rank type and range
  const resolved = resolveRankType({ isMirror, isEnded, myLatestDate, maxOtherDate });
  let rankType: "real" | "estimated" = resolved.rankType;
  let rankRange: { min: number; max: number } | null = null;

  if (resolved.shouldComputeRange) {
    const myRankEntry = rankings.find((r) => r.userId === user.id);
    if (myRankEntry) {
      const myIdx = rankings.indexOf(myRankEntry);
      const hiddenCount = rankings.filter((r) => r.hasHidden && r.userId !== user.id).length;
      rankRange = {
        min: Math.max(1, myIdx + 1 - hiddenCount),
        max: Math.min(rankings.length, myIdx + 1 + hiddenCount),
      };
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

  // Progressive visibility for mirror mode: 0 submissions sees first entry only
  if (isMirror && !myLatestDate && !isEnded) {
    const maxSubCount = Math.max(0, ...[...subCountMap.values()]);
    const firstOnlyRankings = members
      .filter((m) => !m.isGhost && m.userId !== user.id)
      .map((m) => {
        const rows = getMemberRows(m.userId, room.id, room);
        const first = rows[0];
        const metric_val = first?.[metric] as number | null ?? null;
        return {
          userId: m.userId,
          name: m.name,
          isMe: false,
          firstVal: metric_val,
          isFirstDataOnly: true,
        };
      });
    return c.json({
      visibility: "first_only" as const,
      metric,
      metricLabel: cfg.label,
      metricUnit: cfg.unit,
      rankings: firstOnlyRankings,
      room: {
        mode: room.mode,
        endDate: room.endDate,
        isEnded,
        memberCount: members.filter((m) => !m.isGhost).length,
        visibilityMode: room.visibilityMode,
        minSubmissions: minSubs,
      },
      mirrorInfo: { mySubmissions: 0, maxSubmissions: maxSubCount },
    });
  }

  return c.json({
    visibility: "full" as const,
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
      diff: Number(r.weightedDiff.toFixed(1)),
      rawDiff: Number(r.rawDiff.toFixed(1)),
      weightedDiff: Number(r.weightedDiff.toFixed(1)),
      multiplier: r.multiplier,
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
      isEnded,
      memberCount: members.filter((m) => !m.isGhost).length,
      visibilityMode: room.visibilityMode,
      minSubmissions: minSubs,
    },
    mirrorInfo: { mySubmissions: mySubCount, maxSubmissions: Math.max(0, ...[...subCountMap.values()]) },
    hiddenDataCount: isMirror ? totalHiddenCount : 0,
  });
});

export default apiLeaderboard;
