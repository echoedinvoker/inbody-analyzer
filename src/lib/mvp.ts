import { eq, desc, and, gte } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { getConfig, getCompetitionMode, getCompetitionStart } from "./config.ts";

export type PeriodMVP = {
  userId: number;
  name: string;
  gain: number; // single-period metric change
  metric: "bodyFatPct" | "skeletalMuscle";
  periodLabel: string;
};

/**
 * Calculate the "period MVP" — the user with the best single-period improvement.
 * For bulk mode: most skeletal muscle gain between their last two measurements.
 * For cut mode: most body fat % reduction between their last two measurements.
 * Returns null if no one qualifies.
 */
export function calculatePeriodMVP(): PeriodMVP | null {
  const mode = getCompetitionMode();
  const interval = Number(getConfig("measurement_interval_days") || "14");
  const grace = 3;
  const maxGapDays = interval + grace + 7; // Allow some extra slack

  const allUsers = db.select().from(schema.users).all().filter((u) => !u.isDemo);
  const candidates: PeriodMVP[] = [];

  for (const user of allUsers) {
    // Get last 2 confirmed measurements
    const start = getCompetitionStart();
    const rows = db
      .select({
        measuredAt: schema.reports.measuredAt,
        skeletalMuscle: schema.measurements.skeletalMuscle,
        bodyFatPct: schema.measurements.bodyFatPct,
      })
      .from(schema.measurements)
      .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
      .where(
        start
          ? and(eq(schema.reports.userId, user.id), gte(schema.reports.measuredAt, start))
          : eq(schema.reports.userId, user.id)
      )
      .orderBy(desc(schema.reports.measuredAt))
      .limit(2)
      .all();

    if (rows.length < 2) continue;

    const [latest, previous] = rows;

    // Check gap is reasonable
    const gap = Math.abs(
      (new Date(latest!.measuredAt).getTime() - new Date(previous!.measuredAt).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    if (gap > maxGapDays) continue;

    if (mode === "bulk") {
      if (latest!.skeletalMuscle == null || previous!.skeletalMuscle == null) continue;
      const gain = Math.round((latest!.skeletalMuscle - previous!.skeletalMuscle) * 10) / 10;
      candidates.push({
        userId: user.id,
        name: user.name,
        gain,
        metric: "skeletalMuscle",
        periodLabel: `${previous!.measuredAt.slice(0, 10)} → ${latest!.measuredAt.slice(0, 10)}`,
      });
    } else {
      if (latest!.bodyFatPct == null || previous!.bodyFatPct == null) continue;
      const gain = Math.round((latest!.bodyFatPct - previous!.bodyFatPct) * 10) / 10;
      candidates.push({
        userId: user.id,
        name: user.name,
        gain,
        metric: "bodyFatPct",
        periodLabel: `${previous!.measuredAt.slice(0, 10)} → ${latest!.measuredAt.slice(0, 10)}`,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Sort: bulk = most positive gain, cut = most negative gain
  if (mode === "bulk") {
    candidates.sort((a, b) => b.gain - a.gain);
    if (candidates[0]!.gain <= 0) return null; // No one gained muscle
  } else {
    candidates.sort((a, b) => a.gain - b.gain);
    if (candidates[0]!.gain >= 0) return null; // No one lost fat
  }

  return candidates[0]!;
}
