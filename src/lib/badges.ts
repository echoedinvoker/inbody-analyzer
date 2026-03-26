import { eq, asc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { predictAll } from "./predict.ts";
import { getStreak } from "./streak.ts";
import { getCompetitionMeasurements } from "./competition.ts";

export type BadgeDef = {
  type: string;
  label: string;
  check: (ctx: BadgeContext) => boolean;
};

type BadgeContext = {
  userId: number;
  measurements: {
    bodyFatPct: number | null;
    skeletalMuscle: number | null;
    weight: number | null;
  }[];
  reportCount: number;
};

const BADGE_DEFS: BadgeDef[] = [
  {
    type: "first_upload",
    label: "🎯 起步",
    check: (ctx) => ctx.reportCount >= 1,
  },
  {
    type: "second_upload",
    label: "📊 有跡可循",
    check: (ctx) => ctx.reportCount >= 2,
  },
  {
    type: "four_uploads",
    label: "🔬 數據控",
    check: (ctx) => ctx.reportCount >= 4,
  },
  {
    type: "fat_down_1",
    label: "🔥 初見成效",
    check: (ctx) => {
      const ms = ctx.measurements.filter((m) => m.bodyFatPct != null);
      if (ms.length < 2) return false;
      return ms[ms.length - 1]!.bodyFatPct! - ms[0]!.bodyFatPct! <= -1;
    },
  },
  {
    type: "fat_down_3",
    label: "💪 穩定燃脂",
    check: (ctx) => {
      const ms = ctx.measurements.filter((m) => m.bodyFatPct != null);
      if (ms.length < 2) return false;
      return ms[ms.length - 1]!.bodyFatPct! - ms[0]!.bodyFatPct! <= -3;
    },
  },
  {
    type: "muscle_up_05",
    label: "🏋️ 增肌有感",
    check: (ctx) => {
      const ms = ctx.measurements.filter((m) => m.skeletalMuscle != null);
      if (ms.length < 2) return false;
      return ms[ms.length - 1]!.skeletalMuscle! - ms[0]!.skeletalMuscle! >= 0.5;
    },
  },
  {
    type: "muscle_up_1",
    label: "💎 肌肉雕刻",
    check: (ctx) => {
      const ms = ctx.measurements.filter((m) => m.skeletalMuscle != null);
      if (ms.length < 2) return false;
      return ms[ms.length - 1]!.skeletalMuscle! - ms[0]!.skeletalMuscle! >= 1;
    },
  },
  // --- 增肌徽章 ---
  {
    type: "muscle_up_03",
    label: "🌱 萌芽",
    check: (ctx) => {
      const ms = ctx.measurements.filter((m) => m.skeletalMuscle != null);
      if (ms.length < 2) return false;
      return ms[ms.length - 1]!.skeletalMuscle! - ms[0]!.skeletalMuscle! >= 0.3;
    },
  },
  {
    type: "muscle_streak_3",
    label: "📈 三連增",
    check: (ctx) => {
      const ms = ctx.measurements.filter((m) => m.skeletalMuscle != null);
      if (ms.length < 3) return false;
      // Check last 3 consecutive measurements show positive growth
      for (let i = ms.length - 2; i >= Math.max(0, ms.length - 3); i--) {
        if (ms[i + 1]!.skeletalMuscle! <= ms[i]!.skeletalMuscle!) return false;
      }
      return true;
    },
  },
  {
    type: "lean_bulk",
    label: "🎯 精準增肌",
    check: (ctx) => {
      const ms = ctx.measurements.filter((m) => m.skeletalMuscle != null && m.bodyFatPct != null);
      if (ms.length < 2) return false;
      const muscleDiff = ms[ms.length - 1]!.skeletalMuscle! - ms[0]!.skeletalMuscle!;
      const fatPctDiff = Math.abs(ms[ms.length - 1]!.bodyFatPct! - ms[0]!.bodyFatPct!);
      return muscleDiff >= 1 && fatPctDiff <= 1;
    },
  },
  {
    type: "muscle_up_2",
    label: "⚡ 爆發增長",
    check: (ctx) => {
      const ms = ctx.measurements.filter((m) => m.skeletalMuscle != null);
      if (ms.length < 2) return false;
      return ms[ms.length - 1]!.skeletalMuscle! - ms[0]!.skeletalMuscle! >= 2;
    },
  },
  {
    type: "bmi_muscle_diverge",
    label: "🔄 體態重塑",
    check: (ctx) => {
      const ms = ctx.measurements.filter((m) => m.skeletalMuscle != null && m.weight != null);
      if (ms.length < 2) return false;
      const weightDiff = Math.abs(ms[ms.length - 1]!.weight! - ms[0]!.weight!);
      const muscleDiff = ms[ms.length - 1]!.skeletalMuscle! - ms[0]!.skeletalMuscle!;
      return weightDiff <= 1 && muscleDiff >= 0.5;
    },
  },
  // --- Streak 徽章 ---
  {
    type: "streak_3",
    label: "🔥 三連",
    check: (ctx) => {
      const streak = getStreak(ctx.userId);
      return streak.currentStreak >= 3 || streak.bestStreak >= 3;
    },
  },
  {
    type: "streak_full",
    label: "👑 全勤",
    check: (ctx) => {
      const streak = getStreak(ctx.userId);
      return streak.currentStreak >= 6 || streak.bestStreak >= 6;
    },
  },
  {
    type: "top_3",
    label: "🏆 前三強",
    check: (ctx) => {
      const user = db.select().from(schema.users).where(eq(schema.users.id, ctx.userId)).get();
      const predictions = predictAll(user?.isDemo ? ctx.userId : undefined);
      if (predictions.length < 2) return false;
      // For ghost users, filter to "non-ghost + self" view
      const isGhost = user?.isGhost ?? false;
      const filtered = isGhost
        ? predictions.filter((p) => {
            const pUser = db.select({ isGhost: schema.users.isGhost }).from(schema.users).where(eq(schema.users.id, p.userId)).get();
            return !(pUser?.isGhost) || p.userId === ctx.userId;
          })
        : predictions.filter((p) => {
            const pUser = db.select({ isGhost: schema.users.isGhost }).from(schema.users).where(eq(schema.users.id, p.userId)).get();
            return !(pUser?.isGhost);
          });
      const idx = filtered.findIndex((p) => p.userId === ctx.userId);
      return idx >= 0 && idx < 3;
    },
  },
];

/**
 * Check and award new badges for a user.
 * Returns list of newly earned badges.
 */
export function checkBadges(userId: number): { type: string; label: string }[] {
  // Get existing badges
  const existing = db
    .select({ badgeType: schema.badges.badgeType })
    .from(schema.badges)
    .where(eq(schema.badges.userId, userId))
    .all();
  const owned = new Set(existing.map((b) => b.badgeType));

  // Get measurements scoped to current competition
  const competitionMs = getCompetitionMeasurements(userId);
  const measurements = competitionMs.map((m) => ({
    bodyFatPct: m.bodyFatPct,
    skeletalMuscle: m.skeletalMuscle,
    weight: m.weight,
  }));

  const reportCount = measurements.length;

  const ctx: BadgeContext = { userId, measurements, reportCount };
  const newBadges: { type: string; label: string }[] = [];

  for (const def of BADGE_DEFS) {
    if (owned.has(def.type)) continue;
    if (def.check(ctx)) {
      db.insert(schema.badges)
        .values({ userId, badgeType: def.type, badgeLabel: def.label })
        .run();
      newBadges.push({ type: def.type, label: def.label });
    }
  }

  return newBadges;
}

/**
 * Get all badges for a user.
 */
export function getUserBadges(userId: number): { type: string; label: string; earnedAt: string }[] {
  return db
    .select({
      type: schema.badges.badgeType,
      label: schema.badges.badgeLabel,
      earnedAt: schema.badges.earnedAt,
    })
    .from(schema.badges)
    .where(eq(schema.badges.userId, userId))
    .all()
    .map((b) => ({ type: b.type, label: b.label, earnedAt: b.earnedAt || "" }));
}

/**
 * Get badge count for a user.
 */
export function getBadgeCount(userId: number): number {
  const result = db
    .select({ type: schema.badges.badgeType })
    .from(schema.badges)
    .where(eq(schema.badges.userId, userId))
    .all();
  return result.length;
}
