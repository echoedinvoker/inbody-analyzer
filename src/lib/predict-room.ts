import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.ts";

export type RoomPrediction = {
  userId: number;
  name: string;
  firstValue: number;
  currentValue: number;
  predictedValue: number;
  predictedChange: number;
  metric: "bodyFatPct" | "skeletalMuscle";
  dataPoints: number;
};

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
 * Get measurement rows for a member in a room.
 * Open mode: confirmed measurements within date range.
 * Mirror mode: measurements via room_submissions.
 */
function getMemberMeasurements(
  userId: number,
  roomId: number,
  room: { startDate: string; endDate: string; visibilityMode?: string | null },
  metricField: "bodyFatPct" | "skeletalMuscle"
) {
  if (room.visibilityMode === "mirror") {
    return db
      .select({
        measuredAt: schema.reports.measuredAt,
        bodyFatPct: schema.measurements.bodyFatPct,
        skeletalMuscle: schema.measurements.skeletalMuscle,
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
      .all()
      .filter((r) => r[metricField] != null);
  }

  return db
    .select({
      measuredAt: schema.reports.measuredAt,
      bodyFatPct: schema.measurements.bodyFatPct,
      skeletalMuscle: schema.measurements.skeletalMuscle,
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
    })
    .filter((r) => r[metricField] != null);
}

/**
 * Room-scoped predictions for all members.
 */
export function predictAllInRoom(
  roomId: number,
  room: { mode: string; startDate: string; endDate: string; visibilityMode?: string | null }
): RoomPrediction[] {
  const metricField = room.mode === "bulk" ? "skeletalMuscle" : "bodyFatPct";

  const members = db
    .select({
      userId: schema.roomMembers.userId,
      name: schema.users.name,
      isGhost: schema.roomMembers.isGhost,
    })
    .from(schema.roomMembers)
    .innerJoin(schema.users, eq(schema.roomMembers.userId, schema.users.id))
    .where(
      and(
        eq(schema.roomMembers.roomId, roomId),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .all();

  const predictions: RoomPrediction[] = [];

  for (const member of members) {
    if (member.isGhost) continue;

    const rows = getMemberMeasurements(member.userId, roomId, room, metricField);
    if (rows.length < 2) continue;

    const firstDate = new Date(rows[0]!.measuredAt!).getTime();
    const points = rows.map((r) => ({
      x: (new Date(r.measuredAt!).getTime() - firstDate) / (1000 * 60 * 60 * 24),
      y: r[metricField]!,
    }));

    const reg = linearRegression(points);
    if (!reg) continue;

    const endDays = (new Date(room.endDate).getTime() - firstDate) / (1000 * 60 * 60 * 24);
    const predictedValue = Math.round((reg.slope * endDays + reg.intercept) * 10) / 10;

    predictions.push({
      userId: member.userId,
      name: member.name,
      firstValue: rows[0]![metricField]!,
      currentValue: rows[rows.length - 1]![metricField]!,
      predictedValue,
      predictedChange: Math.round((predictedValue - rows[0]![metricField]!) * 10) / 10,
      metric: metricField,
      dataPoints: rows.length,
    });
  }

  if (room.mode === "bulk") {
    predictions.sort((a, b) => b.predictedChange - a.predictedChange);
  } else {
    predictions.sort((a, b) => a.predictedChange - b.predictedChange);
  }

  return predictions;
}
