import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  inviteCode: text("invite_code").unique(),
  isAdmin: integer("is_admin", { mode: "boolean" }).default(false),
  goal: text("goal", { enum: ["cut", "bulk", "maintain"] }).default("maintain"),
  competitionStart: text("competition_start"),
  competitionEnd: text("competition_end"),
  createdAt: text("created_at").default("(datetime('now'))"),
});

export const reports = sqliteTable("reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  measuredAt: text("measured_at").notNull(),
  photoPath: text("photo_path"),
  rawJson: text("raw_json"),
  confirmed: integer("confirmed", { mode: "boolean" }).default(false),
  createdAt: text("created_at").default("(datetime('now'))"),
});

export const measurements = sqliteTable("measurements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportId: integer("report_id")
    .notNull()
    .references(() => reports.id),
  weight: real("weight"),
  skeletalMuscle: real("skeletal_muscle"),
  bodyFatMass: real("body_fat_mass"),
  bodyFatPct: real("body_fat_pct"),
  bmi: real("bmi"),
  totalBodyWater: real("total_body_water"),
  visceralFatLevel: integer("visceral_fat_level"),
  basalMetabolicRate: integer("basal_metabolic_rate"),
  inbodyScore: integer("inbody_score"),
  segmentalLeanJson: text("segmental_lean_json"),
  segmentalFatJson: text("segmental_fat_json"),
});

// AI advice cache: one per user, regenerated when latest report changes
export const adviceCache = sqliteTable("advice_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  latestReportId: integer("latest_report_id").notNull(), // invalidate when this changes
  advice: text("advice").notNull(), // markdown text
  createdAt: text("created_at").default("(datetime('now'))"),
});

// User goal targets (optional numeric goals)
export const userGoals = sqliteTable("user_goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  targetWeight: real("target_weight"),
  targetBodyFatPct: real("target_body_fat_pct"),
  targetSkeletalMuscle: real("target_skeletal_muscle"),
});

export const badges = sqliteTable("badges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  badgeType: text("badge_type").notNull(),
  badgeLabel: text("badge_label").notNull(),
  earnedAt: text("earned_at").default("(datetime('now'))"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: text("expires_at").notNull(),
});
