import { eq, asc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";

export type Prediction = {
  userId: number;
  name: string;
  firstFatPct: number;
  currentFatPct: number;
  predictedFatPct: number;
  predictedChange: number; // predicted - first (negative = good for cut)
  dataPoints: number;
  competitionEnd: string;
};

/**
 * Linear regression: y = slope * x + intercept
 * x = days since first measurement, y = body fat %
 */
function linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * Predict a single user's final body fat %
 */
export function predictUser(userId: number): Prediction | null {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user || !user.competitionEnd) return null;

  const rows = db
    .select({
      measuredAt: schema.reports.measuredAt,
      bodyFatPct: schema.measurements.bodyFatPct,
    })
    .from(schema.measurements)
    .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
    .where(eq(schema.reports.userId, userId))
    .orderBy(asc(schema.reports.measuredAt))
    .all()
    .filter((r) => r.bodyFatPct != null);

  if (rows.length < 2) return null;

  const firstDate = new Date(rows[0]!.measuredAt).getTime();
  const points = rows.map((r) => ({
    x: (new Date(r.measuredAt).getTime() - firstDate) / (1000 * 60 * 60 * 24), // days
    y: r.bodyFatPct!,
  }));

  const reg = linearRegression(points);
  if (!reg) return null;

  const endDays = (new Date(user.competitionEnd).getTime() - firstDate) / (1000 * 60 * 60 * 24);
  const predictedFatPct = Math.round((reg.slope * endDays + reg.intercept) * 10) / 10;

  return {
    userId,
    name: user.name,
    firstFatPct: rows[0]!.bodyFatPct!,
    currentFatPct: rows[rows.length - 1]!.bodyFatPct!,
    predictedFatPct,
    predictedChange: Math.round((predictedFatPct - rows[0]!.bodyFatPct!) * 10) / 10,
    dataPoints: rows.length,
    competitionEnd: user.competitionEnd,
  };
}

/**
 * Get predictions for all users, sorted by most fat loss (most negative change first)
 */
export function predictAll(): Prediction[] {
  const users = db.select().from(schema.users).all().filter((u) => !u.isDemo);
  const predictions: Prediction[] = [];

  for (const u of users) {
    const p = predictUser(u.id);
    if (p) predictions.push(p);
  }

  // Sort: most negative change first (best fat loss)
  predictions.sort((a, b) => a.predictedChange - b.predictedChange);
  return predictions;
}
