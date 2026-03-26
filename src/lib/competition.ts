import { eq, asc, gte, and, desc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { getCompetitionStart, getCompetitionEnd, getCompetitionMode, getConfig, saveConfig } from "./config.ts";

/**
 * Get confirmed measurements for a user, filtered to current competition period.
 * If no competition_start is set, returns all measurements (backward compat).
 */
export function getCompetitionMeasurements(userId: number) {
  const start = getCompetitionStart();

  let query = db
    .select({
      reportId: schema.reports.id,
      measuredAt: schema.reports.measuredAt,
      weight: schema.measurements.weight,
      skeletalMuscle: schema.measurements.skeletalMuscle,
      bodyFatMass: schema.measurements.bodyFatMass,
      bodyFatPct: schema.measurements.bodyFatPct,
      bmi: schema.measurements.bmi,
      inbodyScore: schema.measurements.inbodyScore,
      basalMetabolicRate: schema.measurements.basalMetabolicRate,
    })
    .from(schema.measurements)
    .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
    .where(
      start
        ? and(eq(schema.reports.userId, userId), gte(schema.reports.measuredAt, start))
        : eq(schema.reports.userId, userId)
    )
    .orderBy(asc(schema.reports.measuredAt))
    .all();

  return query;
}

/**
 * Count confirmed reports for a user in current competition period.
 * Used for feature unlock gating.
 */
export function getCompetitionReportCount(userId: number): number {
  return getCompetitionMeasurements(userId).length;
}

/**
 * Start a new competition. Called by admin.
 * - Sets global competition dates
 * - Updates all users' competition dates
 * - Resets streaks
 * - Clears narrative + advice caches
 * Returns snapshot of ended competition (if any) for notification purposes.
 */
export function startNewCompetition(name: string, mode: "cut" | "bulk", startDate: string, endDate: string): { name: string; resultsJson: string } | null {
  // End current competition first (snapshot results)
  let snapshot: { name: string; resultsJson: string } | null = null;
  const currentStart = getCompetitionStart();
  const currentEnd = getCompetitionEnd();
  if (currentStart && currentEnd) {
    snapshot = snapshotCompetitionResults();
  }

  // Set new competition config
  saveConfig("competition_mode", mode);
  saveConfig("competition_start", startDate);
  saveConfig("competition_end", endDate);

  // Update all non-demo users' competition dates
  const allUsers = db.select().from(schema.users).all().filter((u) => !u.isDemo);
  for (const u of allUsers) {
    db.update(schema.users)
      .set({ competitionStart: startDate, competitionEnd: endDate })
      .where(eq(schema.users.id, u.id))
      .run();
  }

  // Reset streaks
  db.delete(schema.streaks).run();

  // Clear caches
  db.delete(schema.narrativeCache).run();
  db.delete(schema.adviceCache).run();

  return snapshot;
}

/**
 * Snapshot current competition results into competition_history.
 */
function snapshotCompetitionResults(): { name: string; resultsJson: string } | null {
  const start = getCompetitionStart();
  const end = getCompetitionEnd();
  const mode = getCompetitionMode();
  if (!start || !end) return null;

  const allUsers = db.select().from(schema.users).all().filter((u) => !u.isDemo);
  const metricField = mode === "bulk" ? "skeletalMuscle" : "bodyFatPct";

  const results: { userId: number; name: string; rank: number; metric: string; change: number }[] = [];

  for (const u of allUsers) {
    const ms = getCompetitionMeasurements(u.id).filter((m) => m[metricField] != null);
    if (ms.length < 2) continue;
    const change = Math.round(((ms[ms.length - 1]![metricField] as number) - (ms[0]![metricField] as number)) * 10) / 10;
    results.push({ userId: u.id, name: u.name, rank: 0, metric: metricField, change });
  }

  // Sort and assign ranks
  if (mode === "bulk") {
    results.sort((a, b) => b.change - a.change);
  } else {
    results.sort((a, b) => a.change - b.change);
  }
  results.forEach((r, i) => { r.rank = i + 1; });

  // Determine competition name
  const historyCount = db.select().from(schema.competitionHistory).all().length;
  const autoName = `第${historyCount + 1}屆${mode === "bulk" ? "增肌" : "減脂"}賽`;

  const resultsJson = JSON.stringify(results);

  db.insert(schema.competitionHistory)
    .values({
      name: autoName,
      mode,
      startDate: start,
      endDate: end,
      resultsJson,
    })
    .run();

  return { name: autoName, resultsJson };
}

/**
 * Get user's title emoji from their activeTitle badge type.
 * Returns empty string if no title set.
 */
export function getUserTitle(userId: number): string {
  const user = db.select({ activeTitle: schema.users.activeTitle }).from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user?.activeTitle) return "";

  // Find the badge label to extract emoji
  const badge = db
    .select({ badgeLabel: schema.badges.badgeLabel })
    .from(schema.badges)
    .where(and(eq(schema.badges.userId, userId), eq(schema.badges.badgeType, user.activeTitle)))
    .get();

  if (!badge) return "";

  // Extract first emoji from label (e.g. "🏆 前三強" → "🏆")
  const match = badge.badgeLabel.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)/u);
  return match ? match[0] : "";
}

/**
 * Get display name with title for a user.
 */
export function getDisplayName(userId: number, name: string): string {
  const title = getUserTitle(userId);
  return title ? `${title} ${name}` : name;
}
