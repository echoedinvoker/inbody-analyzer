/**
 * Dev seed script: populate DB with realistic test data for local UI testing.
 * Usage: bun run src/db/seed-dev.ts
 *
 * Creates:
 * - 8 users (Matt=admin + 7 participants)
 * - 1 open-mode room (減脂挑戰賽, 6 members, minSubmissions=3)
 *   - 3 qualified (≥3 reports): Matt(5), 小美(5), Jenny(4)
 *   - 3 unqualified (<3 reports): 小靜(2), 阿德(1), 小花(2)
 * - 1 mirror-mode room (增肌實驗室, 3 members)
 * - Streaks, badges, goals
 *
 * Idempotent: deletes existing data and re-seeds.
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

const dbPath = process.env.DATABASE_PATH || "./data/inbody.db";
const sqlite = new Database(dbPath);
sqlite.run("PRAGMA journal_mode = WAL");
sqlite.run("PRAGMA foreign_keys = OFF");
const db = drizzle(sqlite);

// --- Clean slate ---
const tables = [
  "room_submissions", "room_members", "rooms",
  "badges", "streaks", "narrative_cache", "advice_cache",
  "measurements", "reports", "user_goals",
  "competition_history", "sessions", "users",
];
for (const t of tables) {
  sqlite.run(`DELETE FROM ${t}`);
}
sqlite.run("DELETE FROM sqlite_sequence");
sqlite.run("PRAGMA foreign_keys = ON");

// --- Users ---
const userDefs = [
  { name: "Matt", isAdmin: true, goal: "cut" as const },   // 0: open(5) + mirror
  { name: "小美", isAdmin: false, goal: "cut" as const },   // 1: open(5)
  { name: "阿凱", isAdmin: false, goal: "bulk" as const },  // 2: mirror(4)
  { name: "Jenny", isAdmin: false, goal: "cut" as const },  // 3: open(4)
  { name: "大雄", isAdmin: false, goal: "bulk" as const },  // 4: mirror(4)
  { name: "小靜", isAdmin: false, goal: "cut" as const },   // 5: open(2) — unqualified
  { name: "阿德", isAdmin: false, goal: "cut" as const },   // 6: open(1) — unqualified
  { name: "小花", isAdmin: false, goal: "cut" as const },   // 7: open(2) — unqualified
  { name: "威廉", isAdmin: false, goal: "bulk" as const },  // 8: mirror(0) — unqualified
  { name: "小萱", isAdmin: false, goal: "bulk" as const },  // 9: mirror(0) — unqualified
];

const userIds: number[] = [];
for (const u of userDefs) {
  const result = db.insert(schema.users).values(u).returning().get();
  userIds.push(result.id);
}
console.log(`Created ${userIds.length} users (IDs: ${userIds.join(", ")})`);

// --- Measurement profiles ---
type Profile = {
  weight: number[];
  skeletalMuscle: number[];
  bodyFatPct: number[];
  bodyFatMass: number[];
  bmi: number[];
  totalBodyWater: number[];
  visceralFatLevel: number[];
  basalMetabolicRate: number[];
  inbodyScore: number[];
};

const profiles: Profile[] = [
  // [0] Matt (cut, 5 reports): good fat loss
  {
    weight:            [78.5, 77.2, 76.1, 75.3, 74.8],
    skeletalMuscle:    [33.2, 33.1, 33.3, 33.2, 33.4],
    bodyFatPct:        [22.1, 20.8, 19.5, 18.6, 17.9],
    bodyFatMass:       [17.3, 16.1, 14.8, 14.0, 13.4],
    bmi:               [25.8, 25.4, 25.0, 24.7, 24.6],
    totalBodyWater:    [44.8, 45.1, 45.3, 45.2, 45.4],
    visceralFatLevel:  [9, 8, 8, 7, 7],
    basalMetabolicRate:[1680, 1675, 1672, 1668, 1670],
    inbodyScore:       [72, 74, 76, 78, 79],
  },
  // [1] 小美 (cut, 5 reports): significant fat loss
  {
    weight:            [62.0, 61.2, 60.1, 59.5, 58.8],
    skeletalMuscle:    [23.5, 23.4, 23.6, 23.5, 23.7],
    bodyFatPct:        [30.2, 28.9, 27.5, 26.8, 25.6],
    bodyFatMass:       [18.7, 17.7, 16.5, 15.9, 15.1],
    bmi:               [24.2, 23.9, 23.5, 23.2, 23.0],
    totalBodyWater:    [31.5, 31.8, 32.0, 32.1, 32.3],
    visceralFatLevel:  [6, 6, 5, 5, 5],
    basalMetabolicRate:[1320, 1315, 1318, 1312, 1316],
    inbodyScore:       [65, 68, 71, 73, 75],
  },
  // [2] 阿凱 (bulk, 4 reports): gaining muscle
  {
    weight:            [72.0, 73.1, 74.0, 74.8],
    skeletalMuscle:    [32.5, 33.2, 33.8, 34.5],
    bodyFatPct:        [16.2, 16.5, 16.3, 16.1],
    bodyFatMass:       [11.7, 12.1, 12.1, 12.0],
    bmi:               [23.1, 23.4, 23.7, 24.0],
    totalBodyWater:    [44.2, 44.8, 45.3, 45.9],
    visceralFatLevel:  [5, 5, 5, 5],
    basalMetabolicRate:[1620, 1640, 1655, 1672],
    inbodyScore:       [78, 80, 82, 83],
  },
  // [3] Jenny (cut, 4 reports): slow progress
  {
    weight:            [58.0, 57.8, 57.5, 57.2],
    skeletalMuscle:    [22.0, 22.0, 22.1, 22.1],
    bodyFatPct:        [28.5, 28.2, 27.8, 27.5],
    bodyFatMass:       [16.5, 16.3, 16.0, 15.7],
    bmi:               [22.6, 22.5, 22.4, 22.3],
    totalBodyWater:    [30.2, 30.3, 30.4, 30.5],
    visceralFatLevel:  [4, 4, 4, 4],
    basalMetabolicRate:[1280, 1278, 1282, 1280],
    inbodyScore:       [68, 69, 70, 71],
  },
  // [4] 大雄 (bulk, 4 reports): gaining muscle + some fat
  {
    weight:            [80.0, 81.5, 82.3, 83.0],
    skeletalMuscle:    [35.0, 35.8, 36.2, 36.8],
    bodyFatPct:        [18.0, 18.3, 18.5, 18.2],
    bodyFatMass:       [14.4, 14.9, 15.2, 15.1],
    bmi:               [25.6, 26.1, 26.4, 26.6],
    totalBodyWater:    [48.0, 48.8, 49.2, 49.7],
    visceralFatLevel:  [7, 7, 7, 7],
    basalMetabolicRate:[1750, 1768, 1780, 1795],
    inbodyScore:       [75, 76, 77, 78],
  },
  // [5] 小靜 (cut, 2 reports — UNQUALIFIED): just started
  {
    weight:            [55.0, 55.2],
    skeletalMuscle:    [21.5, 21.6],
    bodyFatPct:        [25.0, 24.8],
    bodyFatMass:       [13.8, 13.7],
    bmi:               [21.5, 21.6],
    totalBodyWater:    [30.0, 30.1],
    visceralFatLevel:  [3, 3],
    basalMetabolicRate:[1250, 1252],
    inbodyScore:       [72, 72],
  },
  // [6] 阿德 (cut, 1 report — UNQUALIFIED): barely joined
  {
    weight:            [85.0],
    skeletalMuscle:    [30.5],
    bodyFatPct:        [26.0],
    bodyFatMass:       [22.1],
    bmi:               [27.8],
    totalBodyWater:    [46.0],
    visceralFatLevel:  [10],
    basalMetabolicRate:[1700],
    inbodyScore:       [66],
  },
  // [7] 小花 (cut, 2 reports — UNQUALIFIED): just started
  {
    weight:            [50.0, 49.8],
    skeletalMuscle:    [20.0, 20.1],
    bodyFatPct:        [27.0, 26.5],
    bodyFatMass:       [13.5, 13.2],
    bmi:               [20.8, 20.7],
    totalBodyWater:    [26.5, 26.6],
    visceralFatLevel:  [2, 2],
    basalMetabolicRate:[1180, 1182],
    inbodyScore:       [70, 71],
  },
  // [8] 威廉 (bulk, 0 reports — UNQUALIFIED): joined but never uploaded
  {
    weight: [], skeletalMuscle: [], bodyFatPct: [], bodyFatMass: [],
    bmi: [], totalBodyWater: [], visceralFatLevel: [], basalMetabolicRate: [], inbodyScore: [],
  },
  // [9] 小萱 (bulk, 0 reports — UNQUALIFIED): joined but never uploaded
  {
    weight: [], skeletalMuscle: [], bodyFatPct: [], bodyFatMass: [],
    bmi: [], totalBodyWater: [], visceralFatLevel: [], basalMetabolicRate: [], inbodyScore: [],
  },
];

// Generate dates: bi-weekly starting 8 weeks ago
const now = new Date();
const startDate = new Date(now);
startDate.setDate(startDate.getDate() - 56); // 8 weeks ago

function dateStr(base: Date, weeksOffset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + weeksOffset * 14);
  return d.toISOString(); // full ISO timestamp for proper relative time display
}

// --- Insert reports + measurements ---
const reportIds: number[][] = [];

for (let ui = 0; ui < userIds.length; ui++) {
  const profile = profiles[ui];
  const count = profile.weight.length;
  const ids: number[] = [];

  for (let mi = 0; mi < count; mi++) {
    const measuredAt = dateStr(startDate, mi);

    const report = db.insert(schema.reports).values({
      userId: userIds[ui],
      measuredAt,
      confirmed: true,
      isInbody: true,
      deviceType: "InBody 770",
    }).returning().get();

    db.insert(schema.measurements).values({
      reportId: report.id,
      weight: profile.weight[mi],
      skeletalMuscle: profile.skeletalMuscle[mi],
      bodyFatMass: profile.bodyFatMass[mi],
      bodyFatPct: profile.bodyFatPct[mi],
      bmi: profile.bmi[mi],
      totalBodyWater: profile.totalBodyWater[mi],
      visceralFatLevel: profile.visceralFatLevel[mi],
      basalMetabolicRate: profile.basalMetabolicRate[mi],
      inbodyScore: profile.inbodyScore[mi],
    }).run();

    ids.push(report.id);
  }
  reportIds.push(ids);
}
console.log("Created reports + measurements for all users");

// --- Rooms ---
const roomStartDate = dateStr(startDate, 0);
const roomEndDate = dateStr(now, 2);

// Room 1: open mode (減脂挑戰賽) — 6 members, minSubmissions=3
const openRoom = db.insert(schema.rooms).values({
  name: "減脂挑戰賽",
  slug: "cut-challenge",
  ownerId: userIds[0],
  mode: "cut",
  startDate: roomStartDate,
  endDate: roomEndDate,
  measurementInterval: 14,
  maxMembers: 20,
  inviteCode: "CUT-2026",
  visibilityMode: "open",
  minSubmissions: 3,
  isActive: true,
}).returning().get();

// Room 2: mirror mode (增肌實驗室)
const mirrorRoom = db.insert(schema.rooms).values({
  name: "增肌實驗室",
  slug: "bulk-lab",
  ownerId: userIds[2],
  mode: "bulk",
  startDate: roomStartDate,
  endDate: roomEndDate,
  measurementInterval: 14,
  maxMembers: 10,
  inviteCode: "BULK-2026",
  visibilityMode: "mirror",
  minSubmissions: 3,
  isActive: true,
}).returning().get();

console.log(`Created rooms: "${openRoom.name}" (open, min=${openRoom.minSubmissions}), "${mirrorRoom.name}" (mirror)`);

// --- Room members ---
// Open room: Matt(5), 小美(5), Jenny(4), 小靜(2), 阿德(1), 小花(2)
const openMembers = [0, 1, 3, 5, 6, 7];
for (const ui of openMembers) {
  db.insert(schema.roomMembers).values({
    roomId: openRoom.id,
    userId: userIds[ui],
    role: ui === 0 ? "owner" : "member",
  }).run();
}

// Mirror room: 阿凱(4), 大雄(4), Matt(5), 威廉(0), 小萱(0)
const mirrorMembers = [2, 4, 0, 8, 9];
for (const ui of mirrorMembers) {
  db.insert(schema.roomMembers).values({
    roomId: mirrorRoom.id,
    userId: userIds[ui],
    role: ui === 2 ? "owner" : "member",
  }).run();
}
console.log("Created room memberships");

// --- Mirror mode submissions ---
// Helper: generate ISO timestamp a few days after measurement
function submittedAtStr(measurementIndex: number): string {
  const d = new Date(startDate);
  d.setDate(d.getDate() + measurementIndex * 14 + 1); // 1 day after measurement
  return d.toISOString();
}

// 阿凱: submit all 4
for (let i = 0; i < reportIds[2].length; i++) {
  db.insert(schema.roomSubmissions).values({
    roomId: mirrorRoom.id, userId: userIds[2], reportId: reportIds[2][i],
    submittedAt: submittedAtStr(i),
  }).run();
}
// 大雄: submit first 3
for (let i = 0; i < Math.min(3, reportIds[4].length); i++) {
  db.insert(schema.roomSubmissions).values({
    roomId: mirrorRoom.id, userId: userIds[4], reportId: reportIds[4][i],
    submittedAt: submittedAtStr(i),
  }).run();
}
// Matt: submit first 2
for (let i = 0; i < Math.min(2, reportIds[0].length); i++) {
  db.insert(schema.roomSubmissions).values({
    roomId: mirrorRoom.id, userId: userIds[0], reportId: reportIds[0][i],
    submittedAt: submittedAtStr(i),
  }).run();
}
console.log("Created mirror-mode submissions");

// --- Streaks ---
for (let ui = 0; ui < userIds.length; ui++) {
  const count = profiles[ui].weight.length;
  if (count === 0) continue; // skip users with no reports
  const lastDate = dateStr(startDate, count - 1);
  const deadlineDate = dateStr(startDate, count);
  db.insert(schema.streaks).values({
    userId: userIds[ui],
    currentStreak: count,
    bestStreak: count,
    lastMeasuredAt: lastDate,
    streakDeadline: deadlineDate,
  }).run();
}
console.log("Created streaks");

// --- Badges ---
const badgeDefs = [
  { userId: userIds[0], badgeType: "first_measure", badgeLabel: "初心者" },
  { userId: userIds[0], badgeType: "streak_3", badgeLabel: "三連勝" },
  { userId: userIds[0], badgeType: "fat_down_3", badgeLabel: "燃脂達人" },
  { userId: userIds[1], badgeType: "first_measure", badgeLabel: "初心者" },
  { userId: userIds[1], badgeType: "streak_3", badgeLabel: "三連勝" },
  { userId: userIds[1], badgeType: "fat_down_5", badgeLabel: "鐵人減脂" },
  { userId: userIds[2], badgeType: "first_measure", badgeLabel: "初心者" },
  { userId: userIds[2], badgeType: "muscle_up_1", badgeLabel: "增肌新秀" },
  { userId: userIds[3], badgeType: "first_measure", badgeLabel: "初心者" },
  { userId: userIds[4], badgeType: "first_measure", badgeLabel: "初心者" },
  { userId: userIds[4], badgeType: "muscle_up_1", badgeLabel: "增肌新秀" },
  { userId: userIds[5], badgeType: "first_measure", badgeLabel: "初心者" },
  { userId: userIds[6], badgeType: "first_measure", badgeLabel: "初心者" },
  { userId: userIds[7], badgeType: "first_measure", badgeLabel: "初心者" },
];
for (const b of badgeDefs) {
  db.insert(schema.badges).values(b).run();
}

sqlite.run("UPDATE users SET active_title = '燃脂達人' WHERE id = ?", [userIds[0]]);
sqlite.run("UPDATE users SET active_title = '鐵人減脂' WHERE id = ?", [userIds[1]]);
sqlite.run("UPDATE users SET active_title = '增肌新秀' WHERE id = ?", [userIds[2]]);
console.log("Created badges + active titles");

// --- User goals ---
db.insert(schema.userGoals).values({ userId: userIds[0], targetWeight: 73, targetBodyFatPct: 15, targetSkeletalMuscle: 34 }).run();
db.insert(schema.userGoals).values({ userId: userIds[1], targetWeight: 56, targetBodyFatPct: 22, targetSkeletalMuscle: 24 }).run();
db.insert(schema.userGoals).values({ userId: userIds[2], targetWeight: 76, targetBodyFatPct: 15, targetSkeletalMuscle: 36 }).run();
console.log("Created user goals");

// --- Done ---
console.log("\n=== Dev seed complete ===");
console.log(`Users: ${userIds.length}`);
console.log(`\nOpen room "${openRoom.name}" (slug: ${openRoom.slug}, minSubmissions: ${openRoom.minSubmissions}):`);
console.log(`  Qualified (≥3): Matt(5筆), 小美(5筆), Jenny(4筆)`);
console.log(`  Unqualified (<3): 小靜(2筆), 阿德(1筆), 小花(2筆) → 要請乳清`);
console.log(`\nMirror room "${mirrorRoom.name}" (slug: ${mirrorRoom.slug}, minSubmissions: ${mirrorRoom.minSubmissions}):`);
console.log(`  Qualified: 阿凱(4筆), 大雄(3筆submitted)`);
console.log(`  Unqualified: Matt(2筆submitted), 威廉(0筆), 小萱(0筆) → 要請乳清`);
console.log(`\nDev login with User ID 1 (Matt) at http://localhost:3000/login`);

sqlite.close();
