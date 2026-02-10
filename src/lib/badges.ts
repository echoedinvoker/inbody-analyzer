import { eq, asc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { predictAll } from "./predict.ts";

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
  {
    type: "top_3",
    label: "🏆 前三強",
    check: (ctx) => {
      const predictions = predictAll();
      if (predictions.length < 2) return false;
      const idx = predictions.findIndex((p) => p.userId === ctx.userId);
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

  // Get measurements for context
  const measurements = db
    .select({
      bodyFatPct: schema.measurements.bodyFatPct,
      skeletalMuscle: schema.measurements.skeletalMuscle,
    })
    .from(schema.measurements)
    .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
    .where(eq(schema.reports.userId, userId))
    .orderBy(asc(schema.reports.measuredAt))
    .all();

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
