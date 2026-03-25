import { Hono } from "hono";
import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth } from "../lib/session.ts";
import { getUserBadges } from "../lib/badges.ts";
import { getStreak } from "../lib/streak.ts";
import { getNarrative } from "../lib/narrative.ts";
import { predictUser } from "../lib/predict.ts";
import { getCompetitionReportCount } from "../lib/competition.ts";

const apiDashboard = new Hono();

// GET /api/rooms/:slug/dashboard — personal dashboard data within a room
apiDashboard.get("/api/rooms/:slug/dashboard", async (c) => {
  const user = requireAuth(c);
  const { slug } = c.req.param();

  // Verify room exists and user is a member
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

  // Get all confirmed measurements for this user
  const measurements = db
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
    .where(eq(schema.reports.userId, user.id))
    .orderBy(schema.reports.measuredAt)
    .all();

  // Room info
  const now = new Date();
  const end = new Date(room.endDate);
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  // Streak, badges, narrative (currently global, will be per-room later)
  const streak = getStreak(user.id);
  const badges = getUserBadges(user.id);
  const prediction = predictUser(user.id);
  const reportCount = getCompetitionReportCount(user.id);

  let narrative: string | null = null;
  if (reportCount >= 2) {
    try {
      narrative = await getNarrative(user.id);
    } catch (e: any) {
      console.error("Narrative generation failed:", e.message);
    }
  }

  return c.json({
    room: {
      name: room.name,
      mode: room.mode,
      startDate: room.startDate,
      endDate: room.endDate,
      daysLeft,
    },
    user: {
      id: user.id,
      name: user.name,
      activeTitle: null, // TODO: from user record
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
    prediction: prediction
      ? {
          predictedChange: prediction.predictedChange,
          predictedValue: prediction.predictedValue,
          metric: prediction.metric,
        }
      : null,
    nextStep: reportCount === 0
      ? { action: "upload", message: "上傳你的第一份 InBody 報告" }
      : reportCount < 2
        ? { action: "upload", message: "再上傳一筆即可解鎖趨勢圖" }
        : null,
  });
});

export default apiDashboard;
