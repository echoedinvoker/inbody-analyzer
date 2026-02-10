/**
 * Seed demo data: 5 test users with realistic InBody measurements
 * Run: bun run scripts/seed-demo.ts
 */
import { db, schema } from "../src/db/index.ts";
import { eq } from "drizzle-orm";
import { checkBadges } from "../src/lib/badges.ts";

// Competition base date: 2026-01-15 (everyone starts around this time)
const BASE = new Date("2026-01-15");

function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type UserSeed = {
  name: string;
  goal: "cut" | "bulk" | "maintain";
  startOffset: number; // days after BASE
  measurements: {
    dayOffset: number;
    weight: number;
    skeletalMuscle: number;
    bodyFatMass: number;
    bodyFatPct: number;
    bmi: number;
    totalBodyWater: number;
    visceralFatLevel: number;
    basalMetabolicRate: number;
    inbodyScore: number;
  }[];
};

const USERS: UserSeed[] = [
  {
    // 小明：穩定減脂高手，體脂從 22% 降到 17.5%
    name: "小明",
    goal: "cut",
    startOffset: 0,
    measurements: [
      { dayOffset: 0,  weight: 78.5, skeletalMuscle: 33.2, bodyFatMass: 17.3, bodyFatPct: 22.0, bmi: 25.8, totalBodyWater: 42.1, visceralFatLevel: 9, basalMetabolicRate: 1620, inbodyScore: 72 },
      { dayOffset: 10, weight: 77.8, skeletalMuscle: 33.4, bodyFatMass: 16.2, bodyFatPct: 20.8, bmi: 25.5, totalBodyWater: 42.3, visceralFatLevel: 9, basalMetabolicRate: 1625, inbodyScore: 74 },
      { dayOffset: 21, weight: 76.5, skeletalMuscle: 33.5, bodyFatMass: 14.9, bodyFatPct: 19.5, bmi: 25.1, totalBodyWater: 42.4, visceralFatLevel: 8, basalMetabolicRate: 1630, inbodyScore: 76 },
      { dayOffset: 32, weight: 75.8, skeletalMuscle: 33.7, bodyFatMass: 14.0, bodyFatPct: 18.5, bmi: 24.9, totalBodyWater: 42.5, visceralFatLevel: 8, basalMetabolicRate: 1635, inbodyScore: 78 },
      { dayOffset: 45, weight: 75.2, skeletalMuscle: 33.8, bodyFatMass: 13.2, bodyFatPct: 17.5, bmi: 24.7, totalBodyWater: 42.7, visceralFatLevel: 7, basalMetabolicRate: 1640, inbodyScore: 80 },
    ],
  },
  {
    // 小華：中等進度，體脂從 28% 到 25.5%
    name: "小華",
    goal: "cut",
    startOffset: 3,
    measurements: [
      { dayOffset: 0,  weight: 82.0, skeletalMuscle: 30.1, bodyFatMass: 23.0, bodyFatPct: 28.0, bmi: 27.5, totalBodyWater: 39.8, visceralFatLevel: 11, basalMetabolicRate: 1550, inbodyScore: 65 },
      { dayOffset: 14, weight: 81.2, skeletalMuscle: 30.3, bodyFatMass: 22.0, bodyFatPct: 27.1, bmi: 27.2, totalBodyWater: 40.0, visceralFatLevel: 11, basalMetabolicRate: 1555, inbodyScore: 66 },
      { dayOffset: 30, weight: 80.5, skeletalMuscle: 30.5, bodyFatMass: 21.0, bodyFatPct: 26.1, bmi: 27.0, totalBodyWater: 40.2, visceralFatLevel: 10, basalMetabolicRate: 1560, inbodyScore: 68 },
      { dayOffset: 42, weight: 80.0, skeletalMuscle: 30.6, bodyFatMass: 20.4, bodyFatPct: 25.5, bmi: 26.8, totalBodyWater: 40.3, visceralFatLevel: 10, basalMetabolicRate: 1565, inbodyScore: 69 },
    ],
  },
  {
    // 阿偉：慢熱型，前期沒變化，後期開始下降
    name: "阿偉",
    goal: "cut",
    startOffset: 5,
    measurements: [
      { dayOffset: 0,  weight: 85.0, skeletalMuscle: 34.5, bodyFatMass: 20.4, bodyFatPct: 24.0, bmi: 26.9, totalBodyWater: 43.0, visceralFatLevel: 10, basalMetabolicRate: 1680, inbodyScore: 70 },
      { dayOffset: 15, weight: 85.2, skeletalMuscle: 34.4, bodyFatMass: 20.6, bodyFatPct: 24.2, bmi: 27.0, totalBodyWater: 43.0, visceralFatLevel: 10, basalMetabolicRate: 1678, inbodyScore: 70 },
      { dayOffset: 28, weight: 84.0, skeletalMuscle: 34.8, bodyFatMass: 19.3, bodyFatPct: 23.0, bmi: 26.6, totalBodyWater: 43.3, visceralFatLevel: 10, basalMetabolicRate: 1690, inbodyScore: 72 },
      { dayOffset: 40, weight: 83.2, skeletalMuscle: 35.0, bodyFatMass: 18.3, bodyFatPct: 22.0, bmi: 26.3, totalBodyWater: 43.5, visceralFatLevel: 9, basalMetabolicRate: 1700, inbodyScore: 74 },
      { dayOffset: 50, weight: 82.5, skeletalMuscle: 35.2, bodyFatMass: 17.3, bodyFatPct: 21.0, bmi: 26.1, totalBodyWater: 43.7, visceralFatLevel: 9, basalMetabolicRate: 1710, inbodyScore: 75 },
    ],
  },
  {
    // 小美：增肌型，骨骼肌漲很多，體脂小降
    name: "小美",
    goal: "bulk",
    startOffset: 2,
    measurements: [
      { dayOffset: 0,  weight: 58.0, skeletalMuscle: 22.5, bodyFatMass: 14.5, bodyFatPct: 25.0, bmi: 21.5, totalBodyWater: 31.0, visceralFatLevel: 4, basalMetabolicRate: 1280, inbodyScore: 68 },
      { dayOffset: 12, weight: 58.5, skeletalMuscle: 23.0, bodyFatMass: 14.2, bodyFatPct: 24.3, bmi: 21.7, totalBodyWater: 31.4, visceralFatLevel: 4, basalMetabolicRate: 1295, inbodyScore: 70 },
      { dayOffset: 25, weight: 59.0, skeletalMuscle: 23.5, bodyFatMass: 14.0, bodyFatPct: 23.7, bmi: 21.9, totalBodyWater: 31.8, visceralFatLevel: 4, basalMetabolicRate: 1310, inbodyScore: 72 },
    ],
  },
  {
    // 阿強：倒退型，體脂不降反升（要買乳清的那位）
    name: "阿強",
    goal: "cut",
    startOffset: 1,
    measurements: [
      { dayOffset: 0,  weight: 90.0, skeletalMuscle: 35.0, bodyFatMass: 23.4, bodyFatPct: 26.0, bmi: 28.5, totalBodyWater: 44.0, visceralFatLevel: 12, basalMetabolicRate: 1700, inbodyScore: 66 },
      { dayOffset: 18, weight: 90.5, skeletalMuscle: 34.8, bodyFatMass: 24.2, bodyFatPct: 26.7, bmi: 28.7, totalBodyWater: 43.8, visceralFatLevel: 12, basalMetabolicRate: 1695, inbodyScore: 65 },
      { dayOffset: 35, weight: 91.2, skeletalMuscle: 34.5, bodyFatMass: 25.5, bodyFatPct: 28.0, bmi: 28.9, totalBodyWater: 43.5, visceralFatLevel: 13, basalMetabolicRate: 1688, inbodyScore: 63 },
    ],
  },
];

console.log("Seeding demo data...\n");

for (const u of USERS) {
  // Check if user already exists
  const existing = db.select().from(schema.users).where(eq(schema.users.name, u.name)).get();
  if (existing) {
    console.log(`⏭  ${u.name} already exists, skipping`);
    continue;
  }

  const compStart = addDays(BASE, u.startOffset);
  const compEnd = addDays(BASE, u.startOffset + 60);
  const inviteCode = `DEMO-${u.name}-${Date.now()}`;

  // Create user
  const user = db
    .insert(schema.users)
    .values({
      name: u.name,
      inviteCode,
      isAdmin: false,
      goal: u.goal,
      competitionStart: compStart,
      competitionEnd: compEnd,
    })
    .returning()
    .get();

  console.log(`✅ Created user: ${u.name} (id=${user.id}, ${compStart} ~ ${compEnd})`);

  // Create reports + measurements
  for (const m of u.measurements) {
    const measuredAt = addDays(BASE, u.startOffset + m.dayOffset);

    const report = db
      .insert(schema.reports)
      .values({
        userId: user.id,
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

    console.log(`   📊 ${measuredAt}: ${m.weight}kg / ${m.bodyFatPct}% fat / ${m.skeletalMuscle}kg muscle`);
  }

  // Award badges
  const newBadges = checkBadges(user.id);
  if (newBadges.length > 0) {
    console.log(`   🏅 Badges: ${newBadges.map((b) => b.label).join(", ")}`);
  }
}

console.log("\nDone! Demo data seeded.");
