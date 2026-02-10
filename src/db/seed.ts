import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { users } from "./schema.ts";

const dbPath = process.env.DATABASE_PATH || "./data/inbody.db";
const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

// Create admin user
db.insert(users)
  .values({ name: "Matt", isAdmin: true, goal: "cut" })
  .onConflictDoNothing()
  .run();

// Create test invite codes
const codes = ["INBODY-TEST-001", "INBODY-TEST-002", "INBODY-TEST-003"];
for (const code of codes) {
  db.insert(users)
    .values({ name: `待領取 (${code})`, inviteCode: code, goal: "maintain" })
    .onConflictDoNothing()
    .run();
}

console.log("Seed complete: admin + 3 invite codes.");
sqlite.close();
