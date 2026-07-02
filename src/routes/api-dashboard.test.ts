import { describe, test, expect, beforeEach } from "bun:test";
import apiDashboard from "./api-dashboard.ts";
import { makeTestApp, authHeader, makeUser, makeRoom, addMember, makeConfirmedReport, resetDb } from "../lib/test-helpers.ts";
import { db, schema } from "../db/index.ts";

const app = makeTestApp(apiDashboard);
beforeEach(() => resetDb());

describe("dashboard myRejections", () => {
  test("member with a rejection sees it; other member does not", async () => {
    const owner = makeUser("owner");
    const memberA = makeUser("memberA");
    const memberB = makeUser("memberB");
    const room = makeRoom(owner.id, { visibilityMode: "mirror", startDate: "2026-06-01", endDate: "2026-08-31" });
    addMember(room.id, memberA.id);
    addMember(room.id, memberB.id);
    const rpt = makeConfirmedReport(memberA.id, "2026-07-01");
    db.insert(schema.roomSubmissionRejections).values({
      roomId: room.id, userId: memberA.id, reportId: rpt.id,
      measuredAt: "2026-07-01", reason: "照片模糊", rejectedBy: owner.id,
    }).run();
    const resA = await app.request(`/api/rooms/${room.slug}/dashboard`, { headers: await authHeader(memberA.id) });
    expect(resA.status).toBe(200);
    const bodyA = await resA.json();
    expect(bodyA.myRejections).toHaveLength(1);
    expect(bodyA.myRejections[0].reason).toBe("照片模糊");
    expect(bodyA.myRejections[0].measuredAt).toBe("2026-07-01");
    const resB = await app.request(`/api/rooms/${room.slug}/dashboard`, { headers: await authHeader(memberB.id) });
    const bodyB = await resB.json();
    expect(bodyB.myRejections).toHaveLength(0);
  });
});
