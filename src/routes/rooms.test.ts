import { describe, test, expect, beforeEach } from "bun:test";
import roomsRouter from "./rooms.ts";
import { makeTestApp, authHeader, makeUser, makeRoom, addMember, makeConfirmedReport, submitToRoom, resetDb } from "../lib/test-helpers.ts";
import { db, schema } from "../db/index.ts";
import { eq, and } from "drizzle-orm";

const app = makeTestApp(roomsRouter);

beforeEach(() => resetDb());

describe("harness smoke", () => {
  test("GET /api/rooms without auth → 401", async () => {
    const res = await app.request("/api/rooms");
    expect(res.status).toBe(401);
  });
  test("GET /api/rooms with auth → 200 and my room listed", async () => {
    const owner = makeUser("owner");
    makeRoom(owner.id, { visibilityMode: "mirror" });
    const res = await app.request("/api/rooms", { headers: await authHeader(owner.id) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });
});

describe("GET /api/rooms/:slug/submissions", () => {
  test("owner sees all members' submissions with values and photoUrl", async () => {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const room = makeRoom(owner.id, { visibilityMode: "mirror", startDate: "2026-06-01", endDate: "2026-08-31" });
    addMember(room.id, member.id);
    const rpt = makeConfirmedReport(member.id, "2026-07-01", { weight: 70, bodyFatPct: 20, photoPath: "m_1.jpg" });
    submitToRoom(room.id, member.id, rpt.id, "少吃多動");
    const res = await app.request(`/api/rooms/${room.slug}/submissions`, { headers: await authHeader(owner.id) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submissions).toHaveLength(1);
    const s = body.submissions[0];
    expect(s.userName).toBe("member");
    expect(s.weight).toBe(70);
    expect(s.photoUrl).toBe("/api/photos/m_1.jpg");
    expect(s.hint).toBe("少吃多動");
    expect(s.measuredAt).toContain("2026-07-01");
  });
  test("non-owner member → 403", async () => {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const room = makeRoom(owner.id, { visibilityMode: "mirror" });
    addMember(room.id, member.id);
    const res = await app.request(`/api/rooms/${room.slug}/submissions`, { headers: await authHeader(member.id) });
    expect(res.status).toBe(403);
  });
  test("open-mode room → 400", async () => {
    const owner = makeUser("owner");
    const room = makeRoom(owner.id, { visibilityMode: "open" });
    const res = await app.request(`/api/rooms/${room.slug}/submissions`, { headers: await authHeader(owner.id) });
    expect(res.status).toBe(400);
  });
  test("non-owner member of open room → 403 (owner check runs before mode check)", async () => {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const room = makeRoom(owner.id, { visibilityMode: "open" });
    addMember(room.id, member.id);
    const res = await app.request(`/api/rooms/${room.slug}/submissions`, { headers: await authHeader(member.id) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/rooms/:slug/submissions/:id/reject", () => {
  async function setup() {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const room = makeRoom(owner.id, { visibilityMode: "mirror", startDate: "2026-06-01", endDate: "2026-08-31" });
    addMember(room.id, member.id);
    const rpt = makeConfirmedReport(member.id, "2026-07-01", { weight: 70 });
    const sub = submitToRoom(room.id, member.id, rpt.id);
    return { owner, member, room, rpt, sub };
  }
  test("owner rejects → submission deleted, rejection recorded, member can resubmit", async () => {
    const { owner, member, room, rpt, sub } = await setup();
    const res = await app.request(`/api/rooms/${room.slug}/submissions/${sub.id}/reject`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "照片與數值不符" }),
    });
    expect(res.status).toBe(200);
    const gone = db.select().from(schema.roomSubmissions).where(eq(schema.roomSubmissions.id, sub.id)).get();
    expect(gone).toBeUndefined();
    const rej = db.select().from(schema.roomSubmissionRejections).where(eq(schema.roomSubmissionRejections.roomId, room.id)).get();
    expect(rej?.userId).toBe(member.id);
    expect(rej?.reportId).toBe(rpt.id);
    expect(rej?.reason).toBe("照片與數值不符");
    expect(rej?.rejectedBy).toBe(owner.id);
    expect(rej?.measuredAt).toContain("2026-07-01");
    const resubmit = await app.request(`/api/rooms/${room.slug}/submit`, {
      method: "POST",
      headers: { ...(await authHeader(member.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: rpt.id }),
    });
    expect(resubmit.status).toBe(200);
  });
  test("reject recalculates room streak", async () => {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const room = makeRoom(owner.id, { visibilityMode: "mirror", startDate: "2026-06-01", endDate: "2026-08-31" });
    addMember(room.id, member.id);
    const rpt1 = makeConfirmedReport(member.id, "2026-07-01");
    const rpt2 = makeConfirmedReport(member.id, "2026-07-10");
    submitToRoom(room.id, member.id, rpt1.id);
    const sub2 = submitToRoom(room.id, member.id, rpt2.id);
    const res = await app.request(`/api/rooms/${room.slug}/submissions/${sub2.id}/reject`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const streak = db.select().from(schema.roomStreaks)
      .where(and(eq(schema.roomStreaks.roomId, room.id), eq(schema.roomStreaks.userId, member.id)))
      .get();
    expect(streak).toBeDefined();
    expect(streak?.lastMeasuredAt).toBe("2026-07-01");
  });
  test("non-owner → 403", async () => {
    const { member, room, sub } = await setup();
    const res = await app.request(`/api/rooms/${room.slug}/submissions/${sub.id}/reject`, {
      method: "POST",
      headers: { ...(await authHeader(member.id)), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
  test("submission not in this room → 404", async () => {
    const { owner, room } = await setup();
    const res = await app.request(`/api/rooms/${room.slug}/submissions/99999/reject`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
  test("reason > 500 chars → 400", async () => {
    const { owner, room, sub } = await setup();
    const res = await app.request(`/api/rooms/${room.slug}/submissions/${sub.id}/reject`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "x".repeat(501) }),
    });
    expect(res.status).toBe(400);
  });
});
