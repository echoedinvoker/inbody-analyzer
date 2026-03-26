import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { getCompetitionMode } from "./config.ts";
import { getCompetitionMeasurements } from "./competition.ts";

export type Prediction = {
  userId: number;
  name: string;
  firstValue: number;
  currentValue: number;
  predictedValue: number;
  predictedChange: number; // predicted - first (negative = good for cut, positive = good for bulk)
  metric: "bodyFatPct" | "skeletalMuscle";
  dataPoints: number;
  competitionEnd: string;
};

/**
 * Linear regression: y = slope * x + intercept
 * x = days since first measurement, y = metric value
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
 * Predict a single user's final metric value, scoped to current competition.
 */
export function predictUser(userId: number): Prediction | null {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user || !user.competitionEnd) return null;

  const mode = getCompetitionMode();
  const metricField = mode === "bulk" ? "skeletalMuscle" : "bodyFatPct";

  const rows = getCompetitionMeasurements(userId).filter((r) => r[metricField] != null);
  if (rows.length < 2) return null;

  const firstDate = new Date(rows[0]!.measuredAt).getTime();
  const points = rows.map((r) => ({
    x: (new Date(r.measuredAt).getTime() - firstDate) / (1000 * 60 * 60 * 24),
    y: r[metricField]!,
  }));

  const reg = linearRegression(points);
  if (!reg) return null;

  const endDays = (new Date(user.competitionEnd).getTime() - firstDate) / (1000 * 60 * 60 * 24);
  const predictedValue = Math.round((reg.slope * endDays + reg.intercept) * 10) / 10;

  return {
    userId,
    name: user.name,
    firstValue: rows[0]![metricField]!,
    currentValue: rows[rows.length - 1]![metricField]!,
    predictedValue,
    predictedChange: Math.round((predictedValue - rows[0]![metricField]!) * 10) / 10,
    metric: metricField,
    dataPoints: rows.length,
    competitionEnd: user.competitionEnd,
  };
}

/**
 * Get predictions for all users, sorted by best performance.
 */
export function predictAll(includeDemoUserId?: number): Prediction[] {
  const mode = getCompetitionMode();
  const users = db.select().from(schema.users).all().filter((u) => {
    if (!u.isDemo) return true;
    return u.id === includeDemoUserId;
  });
  const predictions: Prediction[] = [];

  for (const u of users) {
    const p = predictUser(u.id);
    if (p) predictions.push(p);
  }

  if (mode === "bulk") {
    predictions.sort((a, b) => b.predictedChange - a.predictedChange);
  } else {
    predictions.sort((a, b) => a.predictedChange - b.predictedChange);
  }
  return predictions;
}
