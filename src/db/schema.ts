import { sqliteTable, text, integer, real, unique } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  inviteCode: text("invite_code").unique(),
  isAdmin: integer("is_admin", { mode: "boolean" }).default(false),
  goal: text("goal", { enum: ["cut", "bulk", "maintain"] }).default("maintain"),
  isDemo: integer("is_demo", { mode: "boolean" }).default(false),
  isGhost: integer("is_ghost", { mode: "boolean" }).default(false),
  lineUserId: text("line_user_id").unique(),
  activeTitle: text("active_title"), // selected badge type to display as title
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
  isInbody: integer("is_inbody", { mode: "boolean" }),
  deviceType: text("device_type"),
  editedAt: text("edited_at"), // set when uploader edits a confirmed report
  createdAt: text("created_at").default("(datetime('now'))"),
});

// Audit log: one row per edit of a confirmed report (only changed fields)
export const reportEdits = sqliteTable("report_edits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportId: integer("report_id")
    .notNull()
    .references(() => reports.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  beforeJson: text("before_json").notNull(),
  afterJson: text("after_json").notNull(),
  editedAt: text("edited_at").$defaultFn(() => new Date().toISOString()),
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

// AI narrative cache: one-liner journey summary per user
export const narrativeCache = sqliteTable("narrative_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  latestReportId: integer("latest_report_id").notNull(),
  narrative: text("narrative").notNull(),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

// Streak tracking for measurement consistency
export const streaks = sqliteTable("streaks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  currentStreak: integer("current_streak").default(0),
  bestStreak: integer("best_streak").default(0),
  lastMeasuredAt: text("last_measured_at"), // "YYYY-MM-DD" UTC+8
  streakDeadline: text("streak_deadline"),  // "YYYY-MM-DD" UTC+8
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

// Competition history: snapshot of final standings when a competition ends
export const competitionHistory = sqliteTable("competition_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  mode: text("mode").notNull(), // "cut" | "bulk"
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  resultsJson: text("results_json").notNull(), // JSON array of {userId, name, rank, metric, change}
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

// System-wide configuration (competition mode, intervals, etc.)
export const systemConfig = sqliteTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Competition rooms
export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => users.id),
  mode: text("mode", { enum: ["cut", "bulk"] }).notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  measurementInterval: integer("measurement_interval").default(14),
  streakInterval: integer("streak_interval").default(21),
  maxMembers: integer("max_members").default(50),
  inviteCode: text("invite_code").notNull().unique(),
  lineGroupId: text("line_group_id"),
  visibilityMode: text("visibility_mode", { enum: ["open", "mirror"] }).default("open"),
  minSubmissions: integer("min_submissions").default(3),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: text("created_at").default("(datetime('now'))"),
});

// Room submissions (mirror mode: manual data submission to rooms)
export const roomSubmissions = sqliteTable(
  "room_submissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    reportId: integer("report_id")
      .notNull()
      .references(() => reports.id),
    submittedAt: text("submitted_at").default("(datetime('now'))"),
    hint: text("hint"),
  },
  (table) => ({
    roomReportUnique: unique().on(table.roomId, table.reportId),
  })
);

// Room streaks (room-level streak tracking)
export const roomStreaks = sqliteTable(
  "room_streaks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    currentStreak: integer("current_streak").default(0),
    bestStreak: integer("best_streak").default(0),
    lastMeasuredAt: text("last_measured_at"),
    streakDeadline: text("streak_deadline"),
    updatedAt: text("updated_at"),
  },
  (table) => ({
    roomUserUnique: unique().on(table.roomId, table.userId),
  })
);

// Rejection audit: host returned a submission (submission row itself is hard-deleted)
export const roomSubmissionRejections = sqliteTable("room_submission_rejections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull().references(() => rooms.id),
  userId: integer("user_id").notNull().references(() => users.id),
  reportId: integer("report_id").notNull().references(() => reports.id),
  measuredAt: text("measured_at").notNull(),
  reason: text("reason"),
  rejectedBy: integer("rejected_by").notNull().references(() => users.id),
  rejectedAt: text("rejected_at").$defaultFn(() => new Date().toISOString()),
});

// Room members (roomId + userId composite unique)
export const roomMembers = sqliteTable(
  "room_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["owner", "member"] }).default("member"),
    isGhost: integer("is_ghost", { mode: "boolean" }).default(false),
    weightMultiplier: real("weight_multiplier").default(1.0),
    joinedAt: text("joined_at").default("(datetime('now'))"),
    leftAt: text("left_at"),
  },
  (table) => ({
    roomUserUnique: unique().on(table.roomId, table.userId),
  })
);

// AI advice cache per room: one per (room, user), regenerated when latest submission changes
export const roomAdviceCache = sqliteTable(
  "room_advice_cache",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: integer("room_id").notNull().references(() => rooms.id),
    userId: integer("user_id").notNull().references(() => users.id),
    latestSubmissionId: integer("latest_submission_id").notNull(),
    advice: text("advice").notNull(),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    roomUserUnique: unique().on(table.roomId, table.userId),
  })
);

export const roomForfeits = sqliteTable(
  "room_forfeits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id),
    userId: integer("user_id").references(() => users.id),
    name: text("name"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    roomUserUnique: unique().on(table.roomId, table.userId),
  })
);

export const roomRewardSettlements = sqliteTable(
  "room_reward_settlements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id),
    userId: integer("user_id").references(() => users.id),
    forfeitId: integer("forfeit_id").references(() => roomForfeits.id),
    zoneAtMark: text("zone_at_mark").notNull(),
    markedBy: integer("marked_by")
      .notNull()
      .references(() => users.id),
    markedAt: text("marked_at").notNull(),
  },
  (table) => ({
    roomUserUnique: unique().on(table.roomId, table.userId),
    roomForfeitUnique: unique().on(table.roomId, table.forfeitId),
  })
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: text("expires_at").notNull(),
});
