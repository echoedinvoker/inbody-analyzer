import { Hono } from "hono";
import { eq, and, isNull, count, desc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth } from "../lib/session.ts";
import { getBadgeCount } from "../lib/badges.ts";
import { predictAllInRoom } from "../lib/predict-room.ts";
import { isRoomEnded, applyMirrorFilter, resolveRankType, computeHasHidden, classifyMember, applyMultiplier, metricDiff, diffDecimals, competitionRanks, winnerCutoff, zoneOf, rankKey, type MetricKey } from "../lib/room-utils.ts";

const apiLeaderboard = new Hono();

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
        editedAt: schema.reports.editedAt,
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
      editedAt: schema.reports.editedAt,
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

  // Load forfeits for this room
  const forfeitRows = db
    .select({
      id: schema.roomForfeits.id,
      userId: schema.roomForfeits.userId,
      name: schema.roomForfeits.name,
      userName: schema.users.name,
    })
    .from(schema.roomForfeits)
    .leftJoin(schema.users, eq(schema.roomForfeits.userId, schema.users.id))
    .where(eq(schema.roomForfeits.roomId, room.id))
    .all();

  const activeMemberIds = new Set(members.map(m => m.userId));
  const forfeitedUserIds = new Set<number>();
  for (const f of forfeitRows) {
    if (f.userId != null && activeMemberIds.has(f.userId)) {
      forfeitedUserIds.add(f.userId);
    }
  }

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
    sortKey: number;
    count: number;
    badgeCount: number;
    submissionCount: number;
    hasHidden: boolean;
    edited: boolean;
    isImprovement: boolean;
  };

  const rankings: RankEntry[] = [];
  const trendData: Record<string, { dates: string[]; values: number[] }> = {};
  const unqualifiedMembers: Array<{
    userId: number; name: string; count: number; isMe: boolean;
    reason: "no_participation" | "below_minimum";
  }> = [];
  const minSubs = room.minSubmissions ?? 3;
  const cfg = METRIC_CONFIG[metric]!;
  const dec = diffDecimals(metric);

  for (const m of members) {
    if (m.isGhost && m.userId !== user.id) continue;
    if (forfeitedUserIds.has(m.userId)) continue;

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
    const rawDiffVal = metricDiff(metric, firstVal, lastVal);
    if (rawDiffVal == null) continue;
    const rawRounded = rankKey(rawDiffVal, dec);
    const { value: weightedDiff, isImprovement } = applyMultiplier(rawRounded, multiplier, cfg.lowerIsBetter);
    const sortKey = rankKey(weightedDiff, dec);

    rankings.push({
      userId: m.userId,
      name: m.name,
      isGhost: m.isGhost ?? false,
      multiplier,
      firstVal,
      lastVal,
      rawDiff: rawRounded,
      weightedDiff,
      diff: weightedDiff,
      sortKey,
      count: visibleRows.length,
      badgeCount: getBadgeCount(m.userId),
      submissionCount: theirSubCount,
      edited: visibleRows.some((r) => r.editedAt != null),
      hasHidden: computeHasHidden(rows, { isMirror, isEnded, isMe: m.userId === user.id, myLatestDate }),
      isImprovement,
    });
  }

  rankings.sort((a, b) => {
    const cmp = cfg.lowerIsBetter ? a.sortKey - b.sortKey : b.sortKey - a.sortKey;
    if (cmp !== 0) return cmp;
    return a.userId - b.userId;
  });

  const sortKeys = rankings.map(r => r.sortKey);
  const ranks = competitionRanks(sortKeys);

  const scoredCount = rankings.length;
  const forfeitRank = scoredCount + 1;
  const activeForfeitEntries = forfeitRows.filter(f => {
    if (f.userId != null) {
      if (!activeMemberIds.has(f.userId)) return false;
      const member = members.find(m => m.userId === f.userId);
      return member && !member.isGhost;
    }
    return true;
  });

  const totalParticipants = scoredCount + activeForfeitEntries.length;
  const wCutoff = winnerCutoff(totalParticipants);
  const viewerIsForfeited = forfeitedUserIds.has(user.id);

  // Rank type and range
  const resolved = resolveRankType({ isMirror, isEnded, myLatestDate, maxOtherDate });
  let rankType: "real" | "estimated" = viewerIsForfeited ? "real" : resolved.rankType;
  let rankRange: { min: number; max: number } | null = null;

  if (!viewerIsForfeited && resolved.shouldComputeRange) {
    const myRankEntry = rankings.find((r) => r.userId === user.id);
    if (myRankEntry) {
      const myIdx = rankings.indexOf(myRankEntry);
      const myRank = ranks[myIdx];
      const hiddenCount = rankings.filter((r) => r.hasHidden && r.userId !== user.id).length;
      rankRange = {
        min: Math.max(1, myRank - hiddenCount),
        max: Math.min(scoredCount, myRank + hiddenCount),
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
      gain: Number(top.diff.toFixed(dec)),
      metric,
    };
  }

  // Predictions
  let predictions: Array<{
    userId: number;
    name: string;
    predictedValue: number;
    predictedChange: number;
    metric: string;
  }> = [];

  try {
    const allPredictions = predictAllInRoom(room.id, room);
    predictions = allPredictions.map((p) => ({
      userId: p.userId,
      name: p.name,
      predictedValue: p.predictedValue,
      predictedChange: p.predictedChange,
      metric: p.metric,
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
      scoring: "absolute" as const,
      diffDecimals: dec,
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
    scoring: "absolute" as const,
    diffDecimals: dec,
    totalParticipants,
    winnerCutoff: wCutoff,
    rankType,
    rankRange,
    rankings: [
      ...rankings.map((r, i) => ({
        rank: ranks[i],
        userId: r.userId,
        name: r.name,
        isMe: r.userId === user.id,
        entryKey: `u:${r.userId}`,
        forfeited: false,
        zone: zoneOf(ranks[i], totalParticipants),
        firstVal: r.firstVal,
        lastVal: r.lastVal,
        diff: Number(r.weightedDiff.toFixed(dec)),
        rawDiff: Number(r.rawDiff.toFixed(dec)),
        weightedDiff: Number(r.weightedDiff.toFixed(dec)),
        multiplier: r.multiplier,
        count: r.count,
        badgeCount: r.badgeCount,
        submissionCount: r.submissionCount,
        hasHidden: r.hasHidden,
        edited: r.edited,
        isImprovement: r.isImprovement,
      })),
      ...activeForfeitEntries.map(f => ({
        rank: forfeitRank,
        userId: f.userId,
        name: f.userId ? f.userName : f.name,
        isMe: f.userId === user.id,
        entryKey: f.userId ? `u:${f.userId}` : `f:${f.id}`,
        forfeited: true,
        zone: zoneOf(forfeitRank, totalParticipants) as "winner" | "loser",
        firstVal: null,
        lastVal: null,
        diff: null,
        rawDiff: null,
        weightedDiff: null,
        multiplier: 1,
        count: 0,
        badgeCount: 0,
        submissionCount: 0,
        hasHidden: false,
        edited: false,
        isImprovement: false,
      })),
    ],
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
