import { Hono } from "hono";
import { eq, and, isNull, count, desc, asc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth } from "../lib/session.ts";
import { getUserBadges } from "../lib/badges.ts";
import { getStreak, getRoomStreak } from "../lib/streak.ts";
import { getNarrative } from "../lib/narrative.ts";
import { predictAllInRoom } from "../lib/predict-room.ts";
import { getRoomAdvice } from "../lib/advice.ts";
import { isRoomEnded, applyDateMirrorFilter, resolveRankType } from "../lib/room-utils.ts";

const apiDashboard = new Hono();

type MeasurementRow = {
  reportId: number;
  measuredAt: string | null;
  weight: number | null;
  skeletalMuscle: number | null;
  bodyFatMass: number | null;
  bodyFatPct: number | null;
  bmi: number | null;
  totalBodyWater: number | null;
  visceralFatLevel: number | null;
  basalMetabolicRate: number | null;
  inbodyScore: number | null;
};

/**
 * Get measurements for a user in a room.
 * Open mode: all confirmed measurements within date range.
 * Mirror mode: only measurements submitted via room_submissions.
 */
function getUserMeasurements(
  userId: number,
  room: { id: number; startDate: string; endDate: string; visibilityMode: string | null }
): MeasurementRow[] {
  if (room.visibilityMode === "mirror") {
    // Mirror: only submitted reports
    return db
      .select({
        reportId: schema.reports.id,
        measuredAt: schema.reports.measuredAt,
        weight: schema.measurements.weight,
        skeletalMuscle: schema.measurements.skeletalMuscle,
        bodyFatMass: schema.measurements.bodyFatMass,
        bodyFatPct: schema.measurements.bodyFatPct,
        bmi: schema.measurements.bmi,
        totalBodyWater: schema.measurements.totalBodyWater,
        visceralFatLevel: schema.measurements.visceralFatLevel,
        basalMetabolicRate: schema.measurements.basalMetabolicRate,
        inbodyScore: schema.measurements.inbodyScore,
      })
      .from(schema.roomSubmissions)
      .innerJoin(schema.reports, eq(schema.roomSubmissions.reportId, schema.reports.id))
      .innerJoin(schema.measurements, eq(schema.measurements.reportId, schema.reports.id))
      .where(
        and(
          eq(schema.roomSubmissions.roomId, room.id),
          eq(schema.roomSubmissions.userId, userId)
        )
      )
      .orderBy(schema.reports.measuredAt)
      .all();
  }

  // Open: all confirmed measurements within date range
  return db
    .select({
      reportId: schema.reports.id,
      measuredAt: schema.reports.measuredAt,
      weight: schema.measurements.weight,
      skeletalMuscle: schema.measurements.skeletalMuscle,
      bodyFatMass: schema.measurements.bodyFatMass,
      bodyFatPct: schema.measurements.bodyFatPct,
      bmi: schema.measurements.bmi,
      totalBodyWater: schema.measurements.totalBodyWater,
      visceralFatLevel: schema.measurements.visceralFatLevel,
      basalMetabolicRate: schema.measurements.basalMetabolicRate,
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
    .filter((m) => {
      const date = m.measuredAt?.slice(0, 10) || "";
      return date >= room.startDate && date <= room.endDate;
    });
}

// GET /api/rooms/:slug/dashboard — personal dashboard data within a room
apiDashboard.get("/api/rooms/:slug/dashboard", async (c) => {
  const user = requireAuth(c);
  const { slug } = c.req.param();

  const room = db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, slug))
    .get();

  if (!room || !room.isActive) return c.json({ error: "Room not found" }, 404);

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
  const measurements = getUserMeasurements(user.id, room);

  // Room info
  const now = new Date();
  const end = new Date(room.endDate);
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  const isEnded = isRoomEnded(room.endDate);

  const reportCount = measurements.length;

  // Previous measurement
  const previousMeasurement = reportCount >= 2
    ? (() => {
        const prev = measurements[reportCount - 2]!;
        return {
          date: prev.measuredAt?.slice(0, 10) || "",
          weight: prev.weight,
          skeletalMuscle: prev.skeletalMuscle,
          bodyFatMass: prev.bodyFatMass,
          bodyFatPct: prev.bodyFatPct,
          bmi: prev.bmi,
          inbodyScore: prev.inbodyScore,
        };
      })()
    : null;

  // Radar data
  const radarData = reportCount >= 2
    ? {
        latest: {
          weight: measurements[reportCount - 1]!.weight,
          skeletalMuscle: measurements[reportCount - 1]!.skeletalMuscle,
          bodyFatPct: measurements[reportCount - 1]!.bodyFatPct,
          bmi: measurements[reportCount - 1]!.bmi,
          inbodyScore: measurements[reportCount - 1]!.inbodyScore,
        },
        previous: {
          weight: measurements[reportCount - 2]!.weight,
          skeletalMuscle: measurements[reportCount - 2]!.skeletalMuscle,
          bodyFatPct: measurements[reportCount - 2]!.bodyFatPct,
          bmi: measurements[reportCount - 2]!.bmi,
          inbodyScore: measurements[reportCount - 2]!.inbodyScore,
        },
      }
    : null;

  // Evolution data
  const evolutionData = reportCount >= 2
    ? {
        labels: measurements.map((m) => {
          const d = m.measuredAt?.slice(5, 10) || "";
          return d.replace("-", "/");
        }),
        skeletalMuscle: measurements.map((m) => m.skeletalMuscle ?? 0),
        bodyFatMass: measurements.map((m) => m.bodyFatMass ?? 0),
        otherMass: measurements.map((m) =>
          Math.max(0, (m.weight ?? 0) - (m.skeletalMuscle ?? 0) - (m.bodyFatMass ?? 0))
        ),
      }
    : null;

  // Activity feed
  const roomMembers = db
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

  const nonGhostIds = new Set(
    roomMembers.filter((m) => !m.isGhost || m.userId === user.id).map((m) => m.userId)
  );
  const nameMap = new Map(roomMembers.map((m) => [m.userId, m.name]));

  let activityFeed: Array<{ userName: string; userId: number; measuredAt: string | null; isMe: boolean }>;

  if (isMirror) {
    // Mirror: show submissions, not uploads
    const submissions = db
      .select({
        userId: schema.roomSubmissions.userId,
        submittedAt: schema.roomSubmissions.submittedAt,
      })
      .from(schema.roomSubmissions)
      .where(eq(schema.roomSubmissions.roomId, room.id))
      .all();

    activityFeed = submissions
      .filter((s) => nonGhostIds.has(s.userId))
      .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
      .slice(0, 10)
      .map((s) => ({
        userName: nameMap.get(s.userId) || "Unknown",
        userId: s.userId,
        measuredAt: s.submittedAt,
        isMe: s.userId === user.id,
      }));
  } else {
    const allReports = db
      .select({
        userId: schema.reports.userId,
        measuredAt: schema.reports.measuredAt,
      })
      .from(schema.reports)
      .where(eq(schema.reports.confirmed, true))
      .orderBy(schema.reports.measuredAt)
      .all();

    activityFeed = allReports
      .filter((r) => {
        if (!nonGhostIds.has(r.userId)) return false;
        const date = r.measuredAt?.slice(0, 10) || "";
        return date >= room.startDate && date <= room.endDate;
      })
      .reverse()
      .slice(0, 10)
      .map((r) => ({
        userName: nameMap.get(r.userId) || "Unknown",
        userId: r.userId,
        measuredAt: r.measuredAt,
        isMe: r.userId === user.id,
      }));
  }

  // Prediction (uses getUserMeasurements internally for mirror support)
  let prediction: {
    myRank: number | null;
    totalPredicted: number;
    predictedValue: number | null;
    predictedChange: number | null;
    metric: string;
    inDanger: boolean;
    isSafe: boolean;
    rankType: "real" | "estimated";
    rankRange: { min: number; max: number } | null;
  } | null = null;

  // Mirror mode: submission counts for visibility info
  let mirrorInfo: {
    mySubmissionCount: number;
    maxSubmissionCount: number;
    mySubmissions: number;
    maxSubmissions: number;
    visibleOthers: Record<string, { submissionCount: number; visibleCount: number }>;
    myLatestDate: string;
    maxOtherDate: string;
  } | null = null;

  let myLatestDate = "";

  if (isMirror) {
    // Get submission counts per member
    const allSubmissions = db
      .select({
        userId: schema.roomSubmissions.userId,
        cnt: count(),
      })
      .from(schema.roomSubmissions)
      .where(eq(schema.roomSubmissions.roomId, room.id))
      .groupBy(schema.roomSubmissions.userId)
      .all();

    const subCountMap = new Map(allSubmissions.map((s) => [s.userId, s.cnt]));
    const mySubCount = subCountMap.get(user.id) ?? 0;
    const maxSubCount = Math.max(0, ...allSubmissions.map((s) => s.cnt));

    // My latest measuredAt for time-based visibility
    const myLatestResult = db
      .select({ measuredAt: schema.reports.measuredAt })
      .from(schema.roomSubmissions)
      .innerJoin(schema.reports, eq(schema.roomSubmissions.reportId, schema.reports.id))
      .where(and(
        eq(schema.roomSubmissions.roomId, room.id),
        eq(schema.roomSubmissions.userId, user.id)
      ))
      .orderBy(desc(schema.reports.measuredAt))
      .limit(1)
      .get();
    myLatestDate = myLatestResult?.measuredAt?.slice(0, 10) || "";

    // Fetch all member submission dates in one query, group in memory
    const allMemberDates = db
      .select({
        userId: schema.roomSubmissions.userId,
        measuredAt: schema.reports.measuredAt,
      })
      .from(schema.roomSubmissions)
      .innerJoin(schema.reports, eq(schema.roomSubmissions.reportId, schema.reports.id))
      .where(eq(schema.roomSubmissions.roomId, room.id))
      .orderBy(asc(schema.reports.measuredAt))
      .all();

    const memberDatesMap = new Map<number, string[]>();
    for (const row of allMemberDates) {
      const date = row.measuredAt?.slice(0, 10) ?? "";
      if (!memberDatesMap.has(row.userId)) memberDatesMap.set(row.userId, []);
      memberDatesMap.get(row.userId)!.push(date);
    }

    let maxOtherDate = "";
    const visibleOthers: Record<string, { submissionCount: number; visibleCount: number }> = {};
    for (const member of roomMembers) {
      if (member.isGhost && member.userId !== user.id) continue;
      if (member.userId === user.id) continue;
      const theirCount = subCountMap.get(member.userId) ?? 0;
      const theirDates = memberDatesMap.get(member.userId) ?? [];
      const visibleCount = applyDateMirrorFilter(theirDates, { isEnded, myLatestDate });
      visibleOthers[member.name] = { submissionCount: theirCount, visibleCount };
      const lastDate = theirDates.at(-1) ?? "";
      if (lastDate > maxOtherDate) maxOtherDate = lastDate;
    }

    mirrorInfo = {
      mySubmissionCount: mySubCount,
      maxSubmissionCount: maxSubCount,
      mySubmissions: mySubCount,
      maxSubmissions: maxSubCount,
      visibleOthers,
      myLatestDate,
      maxOtherDate,
    };
  }

  // Interval info for mirror mode
  let intervalInfo: {
    lastSubmittedDate: string | null;
    nextAllowedDate: string | null;
    daysUntilNextAllowed: number | null;
  } | null = null;

  if (isMirror && room.measurementInterval) {
    const latestSub = db
      .select({ measuredAt: schema.reports.measuredAt })
      .from(schema.roomSubmissions)
      .innerJoin(schema.reports, eq(schema.roomSubmissions.reportId, schema.reports.id))
      .where(
        and(
          eq(schema.roomSubmissions.roomId, room.id),
          eq(schema.roomSubmissions.userId, user.id)
        )
      )
      .orderBy(desc(schema.reports.measuredAt))
      .limit(1)
      .get();

    const lastDate = latestSub?.measuredAt?.slice(0, 10) || null;
    if (lastDate) {
      const nextMs = new Date(lastDate + "T00:00:00Z").getTime() + room.measurementInterval * 86400000;
      const nextAllowed = new Date(nextMs).toISOString().slice(0, 10);
      const todayMs = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
      const daysUntil = Math.max(0, Math.ceil((nextMs - todayMs) / 86400000));
      intervalInfo = {
        lastSubmittedDate: lastDate,
        nextAllowedDate: nextAllowed,
        daysUntilNextAllowed: daysUntil > 0 ? daysUntil : null,
      };
    }
  }

  if (reportCount >= 2) {
    try {
      const predictions = predictAllInRoom(room.id, room);
      const total = predictions.length;
      const myPred = predictions.find((p) => p.userId === user.id);
      const myRank = myPred ? predictions.indexOf(myPred) + 1 : null;

      const resolved = resolveRankType({
        isMirror, isEnded,
        myLatestDate: mirrorInfo?.myLatestDate ?? "",
        maxOtherDate: mirrorInfo?.maxOtherDate ?? "",
      });
      let rankType: "real" | "estimated" = resolved.rankType;
      let rankRange: { min: number; max: number } | null = null;

      if (resolved.shouldComputeRange && myRank != null) {
        const hiddenCount = Object.values(mirrorInfo!.visibleOthers)
          .filter((v) => v.submissionCount > v.visibleCount).length;
        rankRange = { min: Math.max(1, myRank - hiddenCount), max: Math.min(total, myRank + hiddenCount) };
      }

      prediction = {
        myRank,
        totalPredicted: total,
        predictedValue: myPred?.predictedValue ?? null,
        predictedChange: myPred?.predictedChange ?? null,
        metric: room.mode === "bulk" ? "skeletalMuscle" : "bodyFatPct",
        inDanger: myRank != null && total > 3 && myRank > total - Math.floor(total / 2),
        isSafe: myRank != null && myRank <= Math.ceil(total / 2),
        rankType,
        rankRange,
      };
    } catch (e: any) {
      console.error("Prediction failed:", e.message);
    }
  }

  // Streak (room-level, fallback to global)
  const roomStreak = getRoomStreak(user.id, room.id);
  const streak = roomStreak.deadline ? roomStreak : getStreak(user.id);
  const badges = getUserBadges(user.id);

  // Narrative
  let narrative: string | null = null;
  if (reportCount >= 2) {
    try {
      narrative = await getNarrative(user.id);
    } catch (e: any) {
      console.error("Narrative generation failed:", e.message);
    }
  }

  // AI room coach (mirror mode, 1+ submission)
  let roomCoach: string | null = null;
  if (isMirror && measurements.length >= 1) {
    try {
      roomCoach = await getRoomAdvice(user.id, room.id);
    } catch (e: any) {
      console.error("Room coach generation failed:", e.message);
    }
  }

  const mySubCount = mirrorInfo?.mySubmissionCount ?? 0;
  const hasHiddenData = isMirror && Object.values(mirrorInfo?.visibleOthers ?? {}).some(
    (v) => v.submissionCount > v.visibleCount
  );

  const nextStepMessage = isEnded
    ? null
    : isMirror
      ? !myLatestDate
        ? "提交第一筆 InBody 數據，查看所有對手起點！"
        : hasHiddenData
          ? "提交更新的 InBody 數據，解鎖對手最新進展！"
          : mySubCount === 1
            ? "你已完成第一筆！保持節奏，提交下一次量測"
            : null
      : reportCount === 0
        ? "上傳你的第一份 InBody 報告"
        : reportCount < 2
          ? "再上傳一筆即可解鎖趨勢圖和預測功能"
          : null;

  // Member count (always returned)
  const memberCountResult = db
    .select({ count: count() })
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .get();
  const memberCount = memberCountResult?.count ?? 0;

  // Member list always visible (first_only tier shows names to 0-sub users)
  let memberList: Array<{ userId: number; name: string; multiplier: number }> | null = null;
  {
    const allMembers = db
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

    memberList = allMembers
      .filter((m) => !m.isGhost || m.userId === user.id)
      .map((m) => ({
        userId: m.userId,
        name: m.isGhost && m.userId !== user.id ? "👻" : m.name,
        multiplier: m.weightMultiplier ?? 1.0,
      }));
  }

  // Activity feed is always visible (first_only users can see who submitted)
  const visibleActivityFeed = activityFeed;

  const visibleMirrorInfo = mirrorInfo;

  const isOwner = membership.role === "owner";

  const myRejections = db.select({
    measuredAt: schema.roomSubmissionRejections.measuredAt,
    reason: schema.roomSubmissionRejections.reason,
    rejectedAt: schema.roomSubmissionRejections.rejectedAt,
  }).from(schema.roomSubmissionRejections)
    .where(and(
      eq(schema.roomSubmissionRejections.roomId, room.id),
      eq(schema.roomSubmissionRejections.userId, user.id)
    ))
    .orderBy(desc(schema.roomSubmissionRejections.id))
    .limit(3)
    .all();

  return c.json({
    room: {
      name: room.name,
      slug: room.slug,
      mode: room.mode,
      startDate: room.startDate,
      endDate: room.endDate,
      isEnded,
      daysLeft,
      visibilityMode: room.visibilityMode,
      minSubmissions: room.minSubmissions,
      inviteCode: room.inviteCode,
      measurementInterval: room.measurementInterval,
      streakInterval: room.streakInterval,
    },
    isOwner,
    memberCount,
    memberList,
    user: {
      id: user.id,
      name: user.name,
      activeTitle: null,
    },
    measurements: measurements.map((m) => ({
      date: m.measuredAt?.slice(0, 10) || "",
      weight: m.weight,
      skeletalMuscle: m.skeletalMuscle,
      bodyFatMass: m.bodyFatMass,
      bodyFatPct: m.bodyFatPct,
      bmi: m.bmi,
      totalBodyWater: m.totalBodyWater,
      visceralFatLevel: m.visceralFatLevel,
      basalMetabolicRate: m.basalMetabolicRate,
      inbodyScore: m.inbodyScore,
    })),
    reportCount,
    previousMeasurement,
    radarData,
    evolutionData,
    activityFeed: visibleActivityFeed,
    prediction,
    mirrorInfo: visibleMirrorInfo,
    intervalInfo,
    streak: streak
      ? {
          current: streak.currentStreak,
          best: streak.bestStreak,
          deadline: streak.deadline,
        }
      : null,
    badges: badges.map((b) => ({
      type: b.badgeType,
      label: b.badgeLabel,
      earnedAt: b.earnedAt,
    })),
    narrative,
    roomCoach,
    nextStep: nextStepMessage
      ? { action: isMirror ? "submit" : "upload", message: nextStepMessage }
      : null,
    myRejections,
  });
});

export default apiDashboard;
