import { rmSync, mkdirSync } from "fs";

// Must run before any test file imports src/db/index.ts (singleton reads env at import)
const TEST_DB = "./data/test/inbody-test.db";
rmSync("./data/test", { recursive: true, force: true });
mkdirSync("./data/test/photos", { recursive: true });
process.env.DATABASE_PATH = TEST_DB;

// Dynamic import AFTER env is set, then migrate
const { db } = await import("./db/index.ts");
const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
migrate(db, { migrationsFolder: "./drizzle" });
