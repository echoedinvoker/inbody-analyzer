import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

/** Read a system config value (returns undefined if not found) */
export function getConfig(key: string): string | undefined {
  const row = db
    .select()
    .from(schema.systemConfig)
    .where(eq(schema.systemConfig.key, key))
    .get();
  return row?.value;
}

/** Write a system config value (upsert) */
export function saveConfig(key: string, value: string): void {
  db.insert(schema.systemConfig)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.systemConfig.key,
      set: { value },
    })
    .run();
}

/** Get current competition mode */
export function getCompetitionMode(): "cut" | "bulk" {
  const mode = getConfig("competition_mode");
  return mode === "cut" ? "cut" : "bulk";
}

/** Get competition start date (empty string if not set) */
export function getCompetitionStart(): string {
  return getConfig("competition_start") || "";
}

/** Get competition end date (empty string if not set) */
export function getCompetitionEnd(): string {
  return getConfig("competition_end") || "";
}
