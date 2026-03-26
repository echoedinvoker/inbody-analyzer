/**
 * Demo mode: create/reset demo user with clean slate (0 reports)
 * User experiences the full 0→1→2→3→4→5 upload progression.
 */
import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { db, schema } from "../db/index.ts";

const DATA_DIR = process.env.DATABASE_PATH
  ? process.env.DATABASE_PATH.replace(/\/[^/]+$/, "")
  : "./data";

const DEMO_NAME = "Demo 訪客";
const DEMO_INVITE = "DEMO-GUEST";

/** Demo sample photos: provided sequentially based on upload count */
const DEMO_PHOTOS = [
  "demo-1.jpg", // 0 uploads → show this
  "demo-2.jpg", // 1 upload  → show this
  "demo-3.jpg", // 2 uploads → show this
  "demo-4.jpg", // 3 uploads → show this
  "demo-5.jpg", // 4 uploads → show this
];

/** Max uploads allowed for demo user */
export const DEMO_MAX_UPLOADS = 5;

/** Get the sample photo filename for the current upload count, or null if all used */
export function getDemoSamplePhoto(uploadCount: number): string | null {
  if (uploadCount < 0 || uploadCount >= DEMO_PHOTOS.length) return null;
  return DEMO_PHOTOS[uploadCount]!;
}

/** Delete all demo user data and recreate with clean slate */
function resetDemoData(userId: number) {
  // Delete in FK order: measurements → reports → adviceCache → userGoals → badges
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

  // Reset user: clear competition dates so they get set on first upload
  db.update(schema.users)
    .set({
      goal: "cut",
      competitionStart: null,
      competitionEnd: null,
    })
    .where(eq(schema.users.id, userId))
    .run();

  // Insert goal so the target lines show up after first upload
  db.insert(schema.userGoals)
    .values({ userId, targetWeight: 70, targetBodyFatPct: 17, targetSkeletalMuscle: 33 })
    .run();
}

/** Ensure all demo sample photos are in data/samples/ */
function ensureSamplePhotos() {
  const destDir = `${DATA_DIR}/samples`;
  mkdirSync(destDir, { recursive: true });

  for (const photo of DEMO_PHOTOS) {
    const dest = `${destDir}/${photo}`;
    const src = `./public/samples/${photo}`;
    if (!existsSync(dest) && existsSync(src)) {
      copyFileSync(src, dest);
    }
  }
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
  ensureSamplePhotos();

  return user.id;
}
