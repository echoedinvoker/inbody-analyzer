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

console.log("Migration complete.");
sqlite.close();
