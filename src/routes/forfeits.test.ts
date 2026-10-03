import { describe, test, expect, beforeEach } from "bun:test";
import roomsRouter from "./rooms.ts";
import { makeTestApp, authHeader, makeUser, makeRoom, addMember, resetDb } from "../lib/test-helpers.ts";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

const app = makeTestApp(roomsRouter);

beforeEach(() => resetDb());

describe("forfeit API", () => {
  test("F1: owner POST name-only forfeit → 201", async () => {
    const owner = makeUser("owner");
    const room = makeRoom(owner.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "一芳" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.userId).toBeNull();
    expect(body.name).toBe("一芳");
  });

  test("F2: owner POST member forfeit → 201", async () => {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const room = makeRoom(owner.id);
    addMember(room.id, member.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.id }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.userId).toBe(member.id);
  });

  test("F3: permissions — member POST → 403", async () => {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const room = makeRoom(owner.id);
    addMember(room.id, member.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(member.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(403);
  });

  test("F3: permissions — non-member POST → 403", async () => {
    const owner = makeUser("owner");
    const outsider = makeUser("outsider");
    const room = makeRoom(owner.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(outsider.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(403);
  });

  test("F3: permissions — unauthenticated → 401", async () => {
    const owner = makeUser("owner");
    const room = makeRoom(owner.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(401);
  });

  test("F3: permissions — member DELETE → 403", async () => {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const room = makeRoom(owner.id);
    addMember(room.id, member.id);
    // Owner creates forfeit
    const createRes = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "一芳" }),
    });
    const { id } = await createRes.json();
    // Member tries to delete
    const res = await app.request(`/api/rooms/${room.slug}/forfeits/${id}`, {
      method: "DELETE",
      headers: await authHeader(member.id),
    });
    expect(res.status).toBe(403);
  });

  test("F3: permissions — member GET → 403", async () => {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const room = makeRoom(owner.id);
    addMember(room.id, member.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      headers: await authHeader(member.id),
    });
    expect(res.status).toBe(403);
  });

  test("F4: validation — both userId and name → 400", async () => {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const room = makeRoom(owner.id);
    addMember(room.id, member.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.id, name: "一芳" }),
    });
    expect(res.status).toBe(400);
  });

  test("F4: validation — neither userId nor name → 400", async () => {
    const owner = makeUser("owner");
    const room = makeRoom(owner.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("F4: validation — blank name → 400", async () => {
    const owner = makeUser("owner");
    const room = makeRoom(owner.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    expect(res.status).toBe(400);
  });

  test("F4: validation — name > 30 chars → 400", async () => {
    const owner = makeUser("owner");
    const room = makeRoom(owner.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "a".repeat(31) }),
    });
    expect(res.status).toBe(400);
  });

  test("F4: validation — userId not active member → 404", async () => {
    const owner = makeUser("owner");
    const room = makeRoom(owner.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ userId: 99999 }),
    });
    expect(res.status).toBe(404);
  });

  test("F4: validation — ghost member → 400", async () => {
    const owner = makeUser("owner");
    const ghost = makeUser("ghost");
    const room = makeRoom(owner.id);
    const membership = addMember(room.id, ghost.id);
    db.update(schema.roomMembers)
      .set({ isGhost: true })
      .where(eq(schema.roomMembers.id, membership.id))
      .run();
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ userId: ghost.id }),
    });
    expect(res.status).toBe(400);
  });

  test("F4: validation — duplicate member forfeit → 409", async () => {
    const owner = makeUser("owner");
    const member = makeUser("member");
    const room = makeRoom(owner.id);
    addMember(room.id, member.id);
    await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.id }),
    });
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.id }),
    });
    expect(res.status).toBe(409);
  });

  test("F4: validation — duplicate name-only forfeit → 409", async () => {
    const owner = makeUser("owner");
    const room = makeRoom(owner.id);
    await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "一芳" }),
    });
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "一芳" }),
    });
    expect(res.status).toBe(409);
  });

  test("F4: validation — name same as active member → 409", async () => {
    const owner = makeUser("owner");
    const member = makeUser("一芳");
    const room = makeRoom(owner.id);
    addMember(room.id, member.id);
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "一芳" }),
    });
    expect(res.status).toBe(409);
  });

  test("F5: revoke — owner DELETE → 200", async () => {
    const owner = makeUser("owner");
    const room = makeRoom(owner.id);
    const createRes = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "一芳" }),
    });
    const { id } = await createRes.json();
    const res = await app.request(`/api/rooms/${room.slug}/forfeits/${id}`, {
      method: "DELETE",
      headers: await authHeader(owner.id),
    });
    expect(res.status).toBe(200);
    // Verify deleted from DB
    const row = db.select().from(schema.roomForfeits).where(eq(schema.roomForfeits.id, id)).get();
    expect(row).toBeUndefined();
  });

  test("F6: cross-room — owner A delete room B forfeit → 404", async () => {
    const ownerA = makeUser("ownerA");
    const ownerB = makeUser("ownerB");
    const roomA = makeRoom(ownerA.id);
    const roomB = makeRoom(ownerB.id);
    const createRes = await app.request(`/api/rooms/${roomB.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(ownerB.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    const { id } = await createRes.json();
    // Owner A tries to delete using A's slug
    const res = await app.request(`/api/rooms/${roomA.slug}/forfeits/${id}`, {
      method: "DELETE",
      headers: await authHeader(ownerA.id),
    });
    expect(res.status).toBe(404);
  });

  test("F7: GET list — owner gets forfeits with member name resolved", async () => {
    const owner = makeUser("owner");
    const member = makeUser("小明");
    const room = makeRoom(owner.id);
    addMember(room.id, member.id);
    // Add member forfeit
    await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.id }),
    });
    // Add name-only forfeit
    await app.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(owner.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "一芳" }),
    });
    const res = await app.request(`/api/rooms/${room.slug}/forfeits`, {
      headers: await authHeader(owner.id),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    const memberForfeit = body.find((f: any) => f.userId === member.id);
    expect(memberForfeit.name).toBe("小明");
    const nameForfeit = body.find((f: any) => f.userId === null);
    expect(nameForfeit.name).toBe("一芳");
  });

  test("F8: migration shape — user_id is nullable", () => {
    const client = (db as any).session.client;
    const rows = client.query("PRAGMA table_info(room_forfeits)").all();
    const userIdCol = rows.find((r: any) => r.name === "user_id");
    expect(userIdCol).toBeDefined();
    expect(userIdCol.notnull).toBe(0);
  });
});
