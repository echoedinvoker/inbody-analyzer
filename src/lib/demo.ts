/**
 * Demo mode: create/reset demo user with pre-seeded data
 */
import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { db, schema } from "../db/index.ts";
import { checkBadges } from "./badges.ts";

const DATA_DIR = process.env.DATABASE_PATH
  ? process.env.DATABASE_PATH.replace(/\/[^/]+$/, "")
  : "./data";

const DEMO_NAME = "Demo 訪客";
const DEMO_INVITE = "DEMO-GUEST";

// Realistic 2-month fat loss journey (5 data points)
const DEMO_MEASUREMENTS = [
  { dayOffset: 0,  weight: 75.3, skeletalMuscle: 31.8, bodyFatMass: 16.5, bodyFatPct: 21.9, bmi: 24.7, totalBodyWater: 40.5, visceralFatLevel: 8, basalMetabolicRate: 1585, inbodyScore: 73 },
  { dayOffset: 12, weight: 74.6, skeletalMuscle: 32.0, bodyFatMass: 15.6, bodyFatPct: 20.9, bmi: 24.5, totalBodyWater: 40.7, visceralFatLevel: 8, basalMetabolicRate: 1592, inbodyScore: 75 },
  { dayOffset: 25, weight: 73.8, skeletalMuscle: 32.2, bodyFatMass: 14.6, bodyFatPct: 19.8, bmi: 24.2, totalBodyWater: 40.9, visceralFatLevel: 7, basalMetabolicRate: 1600, inbodyScore: 77 },
  { dayOffset: 38, weight: 73.2, skeletalMuscle: 32.4, bodyFatMass: 13.9, bodyFatPct: 19.0, bmi: 24.0, totalBodyWater: 41.1, visceralFatLevel: 7, basalMetabolicRate: 1608, inbodyScore: 78 },
  { dayOffset: 48, weight: 72.5, skeletalMuscle: 32.5, bodyFatMass: 13.1, bodyFatPct: 18.1, bmi: 23.8, totalBodyWater: 41.3, visceralFatLevel: 7, basalMetabolicRate: 1615, inbodyScore: 80 },
];

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Delete all demo user data and recreate from scratch */
function resetDemoData(userId: number) {
  // Delete in FK order: measurements → reports → adviceCache → userGoals → badges → sessions
  const reportIds = db
    .select({ id: schema.reports.id })
    .from(schema.reports)
    .where(eq(schema.reports.userId, userId))
    .all()
    .map((r) => r.id);

  for (const rid of reportIds) {
    db.delete(schema.measurements).where(eq(schema.measurements.reportId, rid)).run();
  }
  db.delete(schema.reports).where(eq(schema.reports.userId, userId)).run();
  db.delete(schema.adviceCache).where(eq(schema.adviceCache.userId, userId)).run();
  db.delete(schema.userGoals).where(eq(schema.userGoals.userId, userId)).run();
  db.delete(schema.badges).where(eq(schema.badges.userId, userId)).run();
  // Don't delete sessions - we're about to create one

  // Competition starts ~50 days ago so there's still time left
  const compStart = new Date();
  compStart.setDate(compStart.getDate() - 50);
  const compEnd = new Date(compStart);
  compEnd.setDate(compEnd.getDate() + 60);

  db.update(schema.users)
    .set({
      goal: "cut",
      competitionStart: compStart.toISOString().slice(0, 10),
      competitionEnd: compEnd.toISOString().slice(0, 10),
    })
    .where(eq(schema.users.id, userId))
    .run();

  // Insert goal
  db.insert(schema.userGoals)
    .values({ userId, targetWeight: 70, targetBodyFatPct: 17, targetSkeletalMuscle: 33 })
    .run();

  // Insert pre-seeded measurements
  for (const m of DEMO_MEASUREMENTS) {
    const measuredAt = addDays(compStart, m.dayOffset);
    const report = db
      .insert(schema.reports)
      .values({
        userId,
        measuredAt,
        photoPath: null,
        rawJson: null,
        confirmed: true,
      })
      .returning()
      .get();

    db.insert(schema.measurements)
      .values({
        reportId: report.id,
        weight: m.weight,
        skeletalMuscle: m.skeletalMuscle,
        bodyFatMass: m.bodyFatMass,
        bodyFatPct: m.bodyFatPct,
        bmi: m.bmi,
        totalBodyWater: m.totalBodyWater,
        visceralFatLevel: m.visceralFatLevel,
        basalMetabolicRate: m.basalMetabolicRate,
        inbodyScore: m.inbodyScore,
        segmentalLeanJson: null,
        segmentalFatJson: null,
      })
      .run();
  }

  // Award badges
  checkBadges(userId);
}

/** Get or create demo user, reset data, return userId */
export function getOrCreateDemoUser(): number {
  let user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.inviteCode, DEMO_INVITE))
    .get();

  if (!user) {
    user = db
      .insert(schema.users)
      .values({
        name: DEMO_NAME,
        inviteCode: DEMO_INVITE,
        isAdmin: false,
        isDemo: true,
        goal: "cut",
      })
      .returning()
      .get();
  }

  resetDemoData(user.id);

  // Ensure sample photo is in data/samples/ (copy from bundled public/ if needed)
  const sampleDest = `${DATA_DIR}/samples/sample-inbody.jpg`;
  const sampleSrc = "./public/samples/sample-inbody.jpg";
  if (!existsSync(sampleDest) && existsSync(sampleSrc)) {
    mkdirSync(`${DATA_DIR}/samples`, { recursive: true });
    copyFileSync(sampleSrc, sampleDest);
  }

  return user.id;
}

/** Max uploads allowed for demo user (prevent API abuse) */
export const DEMO_MAX_UPLOADS = 3;

