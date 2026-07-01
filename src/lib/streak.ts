import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { getConfig } from "./config.ts";

export type StreakResult = {
  currentStreak: number;
  bestStreak: number;
  deadline: string | null;
  isNew: boolean;
};

export type StreakInfo = {
  currentStreak: number;
  bestStreak: number;
  deadline: string | null;
  isExpired: boolean;
  daysRemaining: number | null;
};

/** Get today's date in UTC+8 as "YYYY-MM-DD" */
function getTodayUTC8(): string {
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return utc8.toISOString().slice(0, 10);
}

/** Add days to a "YYYY-MM-DD" date string */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days between two "YYYY-MM-DD" strings (b - a) */
function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / (1000 * 60 * 60 * 24));
}

/**
 * Update streak when a user confirms a new measurement.
 * - First measurement: streak = 0 (not yet a streak)
 * - On time (within deadline): streak +1
 * - Late (past deadline): streak resets to 0
 */
export function updateStreak(userId: number): StreakResult {
  const interval = Number(getConfig("measurement_interval_days") || "14");
  const grace = 3;
  const todayDate = getTodayUTC8();

  const row = db
    .select()
    .from(schema.streaks)
    .where(eq(schema.streaks.userId, userId))
    .get();

  if (!row) {
    // First measurement: create row, streak = 0
    const deadline = addDays(todayDate, interval + grace);
    db.insert(schema.streaks)
      .values({
        userId,
        currentStreak: 0,
        bestStreak: 0,
        lastMeasuredAt: todayDate,
        streakDeadline: deadline,
        updatedAt: new Date().toISOString(),
      })
      .run();
    return { currentStreak: 0, bestStreak: 0, deadline, isNew: true };
  }

  // Existing row: check if within deadline
  const deadline = addDays(todayDate, interval + grace);

  if (row.streakDeadline && todayDate <= row.streakDeadline) {
    // On time → streak +1
    const newStreak = (row.currentStreak ?? 0) + 1;
    const newBest = Math.max(newStreak, row.bestStreak ?? 0);
    db.update(schema.streaks)
      .set({
        currentStreak: newStreak,
        bestStreak: newBest,
        lastMeasuredAt: todayDate,
        streakDeadline: deadline,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.streaks.userId, userId))
      .run();
    return { currentStreak: newStreak, bestStreak: newBest, deadline, isNew: false };
  } else {
    // Late → streak resets to 0
    db.update(schema.streaks)
      .set({
        currentStreak: 0,
        lastMeasuredAt: todayDate,
        streakDeadline: deadline,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.streaks.userId, userId))
      .run();
    return { currentStreak: 0, bestStreak: row.bestStreak ?? 0, deadline, isNew: false };
  }
}

/**
 * Get current streak info for display.
 * If deadline has passed, currentStreak shows 0.
 */
export function getStreak(userId: number): StreakInfo {
  const row = db
    .select()
    .from(schema.streaks)
    .where(eq(schema.streaks.userId, userId))
    .get();

  if (!row) {
    return { currentStreak: 0, bestStreak: 0, deadline: null, isExpired: false, daysRemaining: null };
  }

  const todayDate = getTodayUTC8();
  const isExpired = row.streakDeadline ? todayDate > row.streakDeadline : false;
  const daysRemaining = row.streakDeadline ? daysBetween(todayDate, row.streakDeadline) : null;

  return {
    currentStreak: isExpired ? 0 : (row.currentStreak ?? 0),
    bestStreak: row.bestStreak ?? 0,
    deadline: row.streakDeadline,
    isExpired,
    daysRemaining: isExpired ? 0 : daysRemaining,
  };
}

// ─── Room-level streak ───

/**
 * Update room streak when a user submits to a room.
 * Uses the room's streakInterval instead of global config.
 */
export function updateRoomStreak(
  userId: number,
  roomId: number,
  streakInterval: number
): StreakResult {
  const grace = 3;
  const todayDate = getTodayUTC8();

  const row = db
    .select()
    .from(schema.roomStreaks)
    .where(
      and(
        eq(schema.roomStreaks.roomId, roomId),
        eq(schema.roomStreaks.userId, userId)
      )
    )
    .get();

  const deadline = addDays(todayDate, streakInterval + grace);

  if (!row) {
    db.insert(schema.roomStreaks)
      .values({
        roomId,
        userId,
        currentStreak: 0,
        bestStreak: 0,
        lastMeasuredAt: todayDate,
        streakDeadline: deadline,
        updatedAt: new Date().toISOString(),
      })
      .run();
    return { currentStreak: 0, bestStreak: 0, deadline, isNew: true };
  }

  if (row.streakDeadline && todayDate <= row.streakDeadline) {
    const newStreak = (row.currentStreak ?? 0) + 1;
    const newBest = Math.max(newStreak, row.bestStreak ?? 0);
    db.update(schema.roomStreaks)
      .set({
        currentStreak: newStreak,
        bestStreak: newBest,
        lastMeasuredAt: todayDate,
        streakDeadline: deadline,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.roomStreaks.id, row.id))
      .run();
    return { currentStreak: newStreak, bestStreak: newBest, deadline, isNew: false };
  } else {
    db.update(schema.roomStreaks)
      .set({
        currentStreak: 0,
        lastMeasuredAt: todayDate,
        streakDeadline: deadline,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.roomStreaks.id, row.id))
      .run();
    return { currentStreak: 0, bestStreak: row.bestStreak ?? 0, deadline, isNew: false };
  }
}

/**
 * Get room-level streak info for display.
 */
export function getRoomStreak(userId: number, roomId: number): StreakInfo {
  const row = db
    .select()
    .from(schema.roomStreaks)
    .where(
      and(
        eq(schema.roomStreaks.roomId, roomId),
        eq(schema.roomStreaks.userId, userId)
      )
    )
    .get();

  if (!row) {
    return { currentStreak: 0, bestStreak: 0, deadline: null, isExpired: false, daysRemaining: null };
  }

  const todayDate = getTodayUTC8();
  const isExpired = row.streakDeadline ? todayDate > row.streakDeadline : false;
  const daysRem = row.streakDeadline ? daysBetween(todayDate, row.streakDeadline) : null;

  return {
    currentStreak: isExpired ? 0 : (row.currentStreak ?? 0),
    bestStreak: row.bestStreak ?? 0,
    deadline: row.streakDeadline,
    isExpired,
    daysRemaining: isExpired ? 0 : daysRem,
  };
}

/**
 * Recalculate room streak from scratch based on remaining submissions.
 * Used after withdraw to ensure streak accuracy.
 */
export function recalcRoomStreak(
  userId: number,
  roomId: number,
  streakInterval: number
): void {
  const grace = 3;
  const todayDate = getTodayUTC8();

  // Get all submissions for this user in this room, ordered by measuredAt DESC
  const submissions = db
    .select({ measuredAt: schema.reports.measuredAt })
    .from(schema.roomSubmissions)
    .innerJoin(schema.reports, eq(schema.roomSubmissions.reportId, schema.reports.id))
    .where(
      and(
        eq(schema.roomSubmissions.roomId, roomId),
        eq(schema.roomSubmissions.userId, userId)
      )
    )
    .orderBy(desc(schema.reports.measuredAt))
    .all();

  if (submissions.length === 0) {
    // No submissions left — delete streak record
    db.delete(schema.roomStreaks)
      .where(
        and(
          eq(schema.roomStreaks.roomId, roomId),
          eq(schema.roomStreaks.userId, userId)
        )
      )
      .run();
    return;
  }

  // Count consecutive submissions within streakInterval + grace
  let currentStreak = 0;
  for (let i = 0; i < submissions.length - 1; i++) {
    const newer = submissions[i]!.measuredAt?.slice(0, 10) || "";
    const older = submissions[i + 1]!.measuredAt?.slice(0, 10) || "";
    const gap = daysBetween(older, newer);
    if (gap <= streakInterval + grace) {
      currentStreak++;
    } else {
      break;
    }
  }

  const latestDate = submissions[0]!.measuredAt?.slice(0, 10) || "";
  const newDeadline = addDays(latestDate, streakInterval + grace);

  // If deadline has passed, streak = 0
  if (todayDate > newDeadline) {
    currentStreak = 0;
  }

  const existing = db
    .select()
    .from(schema.roomStreaks)
    .where(
      and(
        eq(schema.roomStreaks.roomId, roomId),
        eq(schema.roomStreaks.userId, userId)
      )
    )
    .get();

  if (existing) {
    db.update(schema.roomStreaks)
      .set({
        currentStreak,
        bestStreak: Math.max(currentStreak, existing.bestStreak ?? 0),
        lastMeasuredAt: latestDate,
        streakDeadline: newDeadline,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.roomStreaks.id, existing.id))
      .run();
  }
  // If no existing record and there are submissions, create one
  else {
    db.insert(schema.roomStreaks)
      .values({
        roomId,
        userId,
        currentStreak,
        bestStreak: currentStreak,
        lastMeasuredAt: latestDate,
        streakDeadline: newDeadline,
        updatedAt: new Date().toISOString(),
      })
      .run();
  }
}
