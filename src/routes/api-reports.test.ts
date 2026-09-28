import { describe, test, expect, beforeEach } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import apiReports from "./api-reports.ts";
import { makeTestApp, authHeader, makeUser, makeRoom, addMember, makeConfirmedReport, submitToRoom, resetDb } from "../lib/test-helpers.ts";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

const app = makeTestApp(apiReports);
beforeEach(() => resetDb());

function writeTestPhoto(filename: string) {
  mkdirSync("./data/test/photos", { recursive: true });
  writeFileSync(`./data/test/photos/${filename}`, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
}

describe("photo authorization for room owner", () => {
  async function setup() {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const stranger = makeUser("stranger");
    const room = makeRoom(owner.id, { visibilityMode: "mirror", startDate: "2026-06-01", endDate: "2026-08-31" });
    addMember(room.id, member.id);
    writeTestPhoto("member_photo.jpg");
    const rpt = makeConfirmedReport(member.id, "2026-07-01", { photoPath: "member_photo.jpg" });
    const sub = submitToRoom(room.id, member.id, rpt.id);
    return { owner, member, stranger, room, rpt, sub };
  }
  test("room owner can fetch member photo after submission", async () => {
    const { owner } = await setup();
    const res = await app.request("/api/photos/member_photo.jpg", { headers: await authHeader(owner.id) });
    expect(res.status).toBe(200);
  });
  test("stranger → 404", async () => {
    const { stranger } = await setup();
    const res = await app.request("/api/photos/member_photo.jpg", { headers: await authHeader(stranger.id) });
    expect(res.status).toBe(404);
  });
  test("after submission deleted (rejected) owner loses access", async () => {
    const { owner, sub } = await setup();
    db.delete(schema.roomSubmissions).where(eq(schema.roomSubmissions.id, sub.id)).run();
    const res = await app.request("/api/photos/member_photo.jpg", { headers: await authHeader(owner.id) });
    expect(res.status).toBe(404);
  });
  test("report owner always 200", async () => {
    const { member } = await setup();
    const res = await app.request("/api/photos/member_photo.jpg", { headers: await authHeader(member.id) });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/reports/:id — uploader edits a confirmed report", () => {
  async function patch(userId: number, reportId: number, body: Record<string, unknown>) {
    return app.request(`/api/reports/${reportId}`, {
      method: "PATCH",
      headers: { ...(await authHeader(userId)), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const measurementOf = (reportId: number) =>
    db.select().from(schema.measurements).where(eq(schema.measurements.reportId, reportId)).get()!;
  const reportOf = (reportId: number) =>
    db.select().from(schema.reports).where(eq(schema.reports.id, reportId)).get()!;
  const editsOf = (reportId: number) =>
    db.select().from(schema.reportEdits).where(eq(schema.reportEdits.reportId, reportId)).all();

  test("owner fixes weight → value updated, edited_at set, audit row keeps before/after of changed fields only", async () => {
    const u = makeUser("yin");
    const rpt = makeConfirmedReport(u.id, "2026-09-01", { weight: 65, bodyFatPct: 18 });
    const res = await patch(u.id, rpt.id, { weight: 56.5, body_fat_pct: 18 });
    expect(res.status).toBe(200);
    expect(measurementOf(rpt.id).weight).toBe(56.5);
    expect(measurementOf(rpt.id).bodyFatPct).toBe(18);
    expect(reportOf(rpt.id).editedAt).toBeTruthy();
    const edits = editsOf(rpt.id);
    expect(edits.length).toBe(1);
    expect(JSON.parse(edits[0]!.beforeJson)).toEqual({ weight: 65 });
    expect(JSON.parse(edits[0]!.afterJson)).toEqual({ weight: 56.5 });
  });

  test("fields absent from body are left untouched; empty string clears to null", async () => {
    const u = makeUser("yin");
    const rpt = makeConfirmedReport(u.id, "2026-09-01", { weight: 65, bodyFatPct: 18 });
    const res = await patch(u.id, rpt.id, { body_fat_pct: "" });
    expect(res.status).toBe(200);
    expect(measurementOf(rpt.id).weight).toBe(65);
    expect(measurementOf(rpt.id).bodyFatPct).toBeNull();
  });

  test("no actual change → 200 but no audit row and not marked edited", async () => {
    const u = makeUser("yin");
    const rpt = makeConfirmedReport(u.id, "2026-09-01", { weight: 65 });
    const res = await patch(u.id, rpt.id, { weight: 65, measured_at: "2026-09-01" });
    expect(res.status).toBe(200);
    expect(editsOf(rpt.id).length).toBe(0);
    expect(reportOf(rpt.id).editedAt).toBeNull();
  });

  test("someone else's report → 404, untouched", async () => {
    const u = makeUser("yin");
    const other = makeUser("other");
    const rpt = makeConfirmedReport(u.id, "2026-09-01", { weight: 65 });
    const res = await patch(other.id, rpt.id, { weight: 50 });
    expect(res.status).toBe(404);
    expect(measurementOf(rpt.id).weight).toBe(65);
  });

  test("unconfirmed report → 400 (use confirm instead)", async () => {
    const u = makeUser("yin");
    const rpt = db.insert(schema.reports).values({ userId: u.id, measuredAt: "2026-09-01", confirmed: false }).returning().get();
    const res = await patch(u.id, rpt.id, { weight: 50 });
    expect(res.status).toBe(400);
  });

  test("malformed or future date → 400", async () => {
    const u = makeUser("yin");
    const rpt = makeConfirmedReport(u.id, "2026-09-01");
    expect((await patch(u.id, rpt.id, { measured_at: "9/1" })).status).toBe(400);
    expect((await patch(u.id, rpt.id, { measured_at: "2999-01-01" })).status).toBe(400);
    expect(reportOf(rpt.id).measuredAt).toBe("2026-09-01");
  });

  test("date change on an unsubmitted report → 200", async () => {
    const u = makeUser("yin");
    const rpt = makeConfirmedReport(u.id, "2026-09-01");
    const res = await patch(u.id, rpt.id, { measured_at: "2026-08-30" });
    expect(res.status).toBe(200);
    expect(reportOf(rpt.id).measuredAt).toBe("2026-08-30");
    expect(JSON.parse(editsOf(rpt.id)[0]!.beforeJson)).toEqual({ measured_at: "2026-09-01" });
  });

  describe("date change on a submitted report must still pass the room's submission rules", () => {
    function setup() {
      const owner = makeUser("owner");
      const u = makeUser("yin");
      const room = makeRoom(owner.id, { startDate: "2026-08-01", endDate: "2026-12-31", measurementInterval: 14 });
      addMember(room.id, u.id);
      const a = makeConfirmedReport(u.id, "2026-08-10");
      const b = makeConfirmedReport(u.id, "2026-09-01");
      const c = makeConfirmedReport(u.id, "2026-09-20");
      for (const r of [a, b, c]) submitToRoom(room.id, u.id, r.id);
      return { u, a, b, c };
    }
    test("outside the room period → 400", async () => {
      const { u, a } = setup();
      const res = await patch(u.id, a.id, { measured_at: "2026-07-25" });
      expect(res.status).toBe(400);
      expect(reportOf(a.id).measuredAt).toBe("2026-08-10");
    });
    test("too close to the previous submission → 400", async () => {
      const { u, b } = setup();
      const res = await patch(u.id, b.id, { measured_at: "2026-08-20" });
      expect(res.status).toBe(400);
    });
    test("too close to the next submission → 400", async () => {
      const { u, b } = setup();
      const res = await patch(u.id, b.id, { measured_at: "2026-09-10" });
      expect(res.status).toBe(400);
    });
    test("jumping past another submission → 400", async () => {
      const { u, a } = setup();
      const res = await patch(u.id, a.id, { measured_at: "2026-10-10" });
      expect(res.status).toBe(400);
    });
    test("within the gaps → 200", async () => {
      const { u, b } = setup();
      const res = await patch(u.id, b.id, { measured_at: "2026-09-04" });
      expect(res.status).toBe(200);
      expect(reportOf(b.id).measuredAt).toBe("2026-09-04");
    });
    test("numbers-only edit on a submitted report is always allowed", async () => {
      const { u, b } = setup();
      const res = await patch(u.id, b.id, { weight: 60 });
      expect(res.status).toBe(200);
    });
  });

  test("edit clears the uploader's AI caches (keyed on report id, so they would go stale)", async () => {
    const u = makeUser("yin");
    const other = makeUser("other");
    const rpt = makeConfirmedReport(u.id, "2026-09-01");
    const otherRpt = makeConfirmedReport(other.id, "2026-09-01");
    db.insert(schema.adviceCache).values({ userId: u.id, latestReportId: rpt.id, advice: "x" }).run();
    db.insert(schema.narrativeCache).values({ userId: u.id, latestReportId: rpt.id, narrative: "x" }).run();
    db.insert(schema.adviceCache).values({ userId: other.id, latestReportId: otherRpt.id, advice: "y" }).run();
    await patch(u.id, rpt.id, { weight: 50 });
    expect(db.select().from(schema.adviceCache).where(eq(schema.adviceCache.userId, u.id)).all().length).toBe(0);
    expect(db.select().from(schema.narrativeCache).where(eq(schema.narrativeCache.userId, u.id)).all().length).toBe(0);
    expect(db.select().from(schema.adviceCache).where(eq(schema.adviceCache.userId, other.id)).all().length).toBe(1);
  });

  test("edited report can still be deleted (audit rows don't block the FK)", async () => {
    const u = makeUser("yin");
    const rpt = makeConfirmedReport(u.id, "2026-09-01");
    await patch(u.id, rpt.id, { weight: 50 });
    const res = await app.request(`/api/reports/${rpt.id}`, { method: "DELETE", headers: await authHeader(u.id) });
    expect(res.status).toBe(200);
    expect(reportOf(rpt.id)).toBeUndefined();
  });

  test("list and detail expose editedAt", async () => {
    const u = makeUser("yin");
    const rpt = makeConfirmedReport(u.id, "2026-09-01");
    await patch(u.id, rpt.id, { weight: 50 });
    const list = await (await app.request("/api/reports", { headers: await authHeader(u.id) })).json();
    expect(list[0].editedAt).toBeTruthy();
    const detail = await (await app.request(`/api/reports/${rpt.id}`, { headers: await authHeader(u.id) })).json();
    expect(detail.editedAt).toBeTruthy();
    expect(detail.measurement.weight).toBe(50);
  });
});

describe("PATCH refreshes the room AI coach only for rooms that use the edited report", () => {
  function setup() {
    const owner = makeUser("owner");
    const u = makeUser("yin");
    const roomA = makeRoom(owner.id, { startDate: "2026-08-01", endDate: "2026-12-31" });
    const roomB = makeRoom(owner.id, { startDate: "2026-08-01", endDate: "2026-12-31" });
    addMember(roomA.id, u.id);
    addMember(roomB.id, u.id);
    const submitted = makeConfirmedReport(u.id, "2026-08-10");
    const unsubmitted = makeConfirmedReport(u.id, "2026-09-01");
    const other = makeConfirmedReport(u.id, "2026-08-12");
    const subA = submitToRoom(roomA.id, u.id, submitted.id);
    const subB = submitToRoom(roomB.id, u.id, other.id);
    db.insert(schema.roomAdviceCache).values({ roomId: roomA.id, userId: u.id, latestSubmissionId: subA.id, advice: "A" }).run();
    db.insert(schema.roomAdviceCache).values({ roomId: roomB.id, userId: u.id, latestSubmissionId: subB.id, advice: "B" }).run();
    return { u, roomA, roomB, submitted, unsubmitted };
  }
  const coachRooms = (userId: number) =>
    db.select().from(schema.roomAdviceCache).where(eq(schema.roomAdviceCache.userId, userId)).all().map((r) => r.roomId).sort();
  async function patch(userId: number, reportId: number, body: Record<string, unknown>) {
    return app.request(`/api/reports/${reportId}`, {
      method: "PATCH",
      headers: { ...(await authHeader(userId)), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("editing a submitted report clears that room's coach, keeps the other room's", async () => {
    const { u, roomB, submitted } = setup();
    expect((await patch(u.id, submitted.id, { weight: 50 })).status).toBe(200);
    expect(coachRooms(u.id)).toEqual([roomB.id]);
  });

  test("editing a report no room uses leaves every room coach alone", async () => {
    const { u, roomA, roomB, unsubmitted } = setup();
    expect((await patch(u.id, unsubmitted.id, { weight: 50 })).status).toBe(200);
    expect(coachRooms(u.id)).toEqual([roomA.id, roomB.id].sort());
  });
});
