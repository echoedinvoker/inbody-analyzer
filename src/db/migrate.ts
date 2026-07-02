import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "fs";

import { dirname } from "path";

const dbPath = process.env.DATABASE_PATH || "./data/inbody.db";
mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(dirname(dbPath) + "/photos", { recursive: true });

const sqlite = new Database(dbPath);
sqlite.run("PRAGMA journal_mode = WAL");
sqlite.run("PRAGMA foreign_keys = ON");
const db = drizzle(sqlite);

// Backfill migration tracker for migrations that were applied manually (schema drift fix).
// Drizzle tracks applied migrations by count — if the DB has 12 entries but the journal
// has 18, drizzle tries to run entries 13-18. We register the manually-applied ones
// so the migrator skips them.
const applied = (sqlite.query("SELECT count(*) as c FROM __drizzle_migrations").get() as { c: number })?.c ?? 0;
const journalEntries = 18; // 0000-0017 (16 original + 0016 is_ghost patch + 0017 rejections table)
if (applied < journalEntries) {
  const missing: [string, number][] = [
    // 0012-0015 were applied manually, 0016 is_ghost column already exists
    ["backfill-0012", 1775358909347],
    ["backfill-0013", 1775367908139],
    ["backfill-0014", 1777013894843],
    ["backfill-0015", 1777030471644],
    ["backfill-0016-is-ghost", 1777882800000],
  ];
  for (const [hash, ts] of missing) {
    sqlite.run(
      "INSERT OR IGNORE INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      [hash, ts]
    );
  }
  // Also ensure the is_ghost column exists (idempotent)
  try { sqlite.run("ALTER TABLE users ADD COLUMN is_ghost integer DEFAULT false"); } catch {}
  console.log(`Backfilled migration tracker (was ${applied}, added up to ${journalEntries - 1})`);
}

migrate(db, { migrationsFolder: "./drizzle" });

// Ensure admin user exists
import { users } from "./schema.ts";
const ddb = drizzle(sqlite);
const existing = sqlite.query("SELECT id FROM users WHERE is_admin = 1").get() as { id: number } | null;
const code = process.env.ADMIN_INVITE_CODE || "ADMIN-INIT";
if (!existing) {
  ddb.insert(users).values({ name: "Matt", isAdmin: true, goal: "cut", inviteCode: code }).run();
  console.log(`Admin user created with invite code: ${code}`);
} else {
  sqlite.run("UPDATE users SET invite_code = ? WHERE is_admin = 1", [code]);
  console.log(`Admin invite code updated.`);
}

// Seed system_config defaults (idempotent)
const configDefaults: [string, string][] = [
  ["competition_mode", "bulk"],
  ["measurement_interval_days", "14"],
  ["reminder_days_before", "2"],
  ["line_group_id", ""],
  ["cron_secret", crypto.randomUUID()],
  ["competition_start", ""],
  ["competition_end", ""],
];
for (const [key, value] of configDefaults) {
  sqlite.run(
    "INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)",
    [key, value]
  );
}

console.log("Migration complete.");
sqlite.close();
