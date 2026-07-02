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
