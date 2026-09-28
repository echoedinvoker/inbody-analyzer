import { describe, test, expect, beforeEach } from "bun:test";
import apiLeaderboard from "./api-leaderboard.ts";
import rooms from "./rooms.ts";
import { makeTestApp, authHeader, makeUser, makeRoom, addMember, makeConfirmedReport, submitToRoom, resetDb } from "../lib/test-helpers.ts";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

const app = makeTestApp(apiLeaderboard);
const roomsApp = makeTestApp(rooms);
beforeEach(() => resetDb());

const markEdited = (reportId: number) =>
  db.update(schema.reports).set({ editedAt: "2026-09-28T10:00:00Z" }).where(eq(schema.reports.id, reportId)).run();

describe("edited marker is visible to other members", () => {
  test("leaderboard entry flags a member whose counted report was edited", async () => {
    const owner = makeUser("owner");
    const yin = makeUser("yin");
    const room = makeRoom(owner.id, { visibilityMode: "open", startDate: "2026-08-01", endDate: "2026-12-31" });
    addMember(room.id, yin.id);
    const y1 = makeConfirmedReport(yin.id, "2026-08-10", { bodyFatPct: 25 });
    makeConfirmedReport(yin.id, "2026-09-10", { bodyFatPct: 23 });
    makeConfirmedReport(owner.id, "2026-08-10", { bodyFatPct: 20 });
    makeConfirmedReport(owner.id, "2026-09-10", { bodyFatPct: 19 });
    markEdited(y1.id);

    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, { headers: await authHeader(owner.id) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const byName = Object.fromEntries(body.rankings.map((r: any) => [r.name, r]));
    expect(byName.yin.edited).toBe(true);
    expect(byName.owner.edited).toBe(false);
  });

  test("host review list carries editedAt per submission", async () => {
    const owner = makeUser("owner");
    const yin = makeUser("yin");
    const room = makeRoom(owner.id, { visibilityMode: "mirror", startDate: "2026-08-01", endDate: "2026-12-31" });
    addMember(room.id, yin.id);
    const r1 = makeConfirmedReport(yin.id, "2026-08-10");
    const r2 = makeConfirmedReport(yin.id, "2026-09-10");
    submitToRoom(room.id, yin.id, r1.id);
    submitToRoom(room.id, yin.id, r2.id);
    markEdited(r1.id);

    const res = await roomsApp.request(`/api/rooms/${room.slug}/submissions`, { headers: await authHeader(owner.id) });
    const { submissions } = await res.json();
    const byReport = Object.fromEntries(submissions.map((s: any) => [s.reportId, s]));
    expect(byReport[r1.id].editedAt).toBe("2026-09-28T10:00:00Z");
    expect(byReport[r2.id].editedAt).toBeNull();
  });
});
