import { describe, test, expect, beforeEach } from "bun:test";
import roomsRouter from "./rooms.ts";
import { makeTestApp, authHeader, makeUser, makeRoom, resetDb } from "../lib/test-helpers.ts";

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
