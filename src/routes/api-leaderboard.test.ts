import { describe, test, expect, beforeEach } from "bun:test";
import apiLeaderboard from "./api-leaderboard.ts";
import rooms from "./rooms.ts";
import { makeTestApp, authHeader, makeUser, makeRoom, addMember, makeConfirmedReport, submitToRoom, resetDb } from "../lib/test-helpers.ts";
import { db, schema } from "../db/index.ts";
import { eq, and } from "drizzle-orm";

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

describe("body fat score is relative decrease", () => {
  function setupRoom8() {
    // Create users in specific order: Chang first (owner), then others
    // makeUser order = userId order = SQLite default read order for ties
    const chang = makeUser("Chang");
    const xuanyu = makeUser("宣羽");
    const yinyin = makeUser("茵茵");
    const jiwei = makeUser("紀維");   // before chia → old algo puts 紀維 before chia when tied
    const yuqing = makeUser("邱郁晴"); // before chia
    const chia = makeUser("chia");
    const zhiwei = makeUser("張志瑋");
    const kevin = makeUser("kevin");
    const jeffrey = makeUser("Jeffrey");

    const room = makeRoom(chang.id, {
      visibilityMode: "mirror",
      startDate: "2026-07-01",
      endDate: "2026-09-30",
    });

    const members = [xuanyu, yinyin, jiwei, yuqing, chia, zhiwei, kevin, jeffrey];
    for (const m of members) addMember(room.id, m.id);

    // bodyFatPct data: [initial, latest]
    const data: [typeof chang, number, number][] = [
      [xuanyu, 37.5, 33.4],
      [yinyin, 24.9, 23.3],
      [chang, 27.4, 26.3],
      [chia, 33.2, 32.7],
      [yuqing, 34.2, 33.7],
      [jiwei, 42.5, 41.9],
      [zhiwei, 28.8, 28.4],
      [kevin, 26.9, 26.6],
      [jeffrey, 30.4, 32.2],
    ];

    for (const [u, first, last] of data) {
      const r1 = makeConfirmedReport(u.id, "2026-07-01", { bodyFatPct: first });
      submitToRoom(room.id, u.id, r1.id);
      const r2 = makeConfirmedReport(u.id, "2026-09-30", { bodyFatPct: last });
      submitToRoom(room.id, u.id, r2.id);
    }

    return { room, chang, xuanyu, yinyin, jiwei, yuqing, chia, zhiwei, kevin, jeffrey };
  }

  test("A: ranking order matches relative decrease", async () => {
    const { room, chang } = setupRoom8();
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rankings.map((r: any) => r.name)).toEqual([
      "宣羽", "茵茵", "Chang", "chia", "邱郁晴", "紀維", "張志瑋", "kevin", "Jeffrey",
    ]);
  });

  test("B: diff values are relative percentages with 2 decimals", async () => {
    const { room, chang } = setupRoom8();
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    const diffs = body.rankings.map((r: any) => r.diff);
    expect(diffs).toEqual([-10.93, -6.43, -4.01, -1.51, -1.46, -1.41, -1.39, -1.12, 5.92]);

    const rawDiffs = body.rankings.map((r: any) => r.rawDiff);
    expect(rawDiffs).toEqual([-10.93, -6.43, -4.01, -1.51, -1.46, -1.41, -1.39, -1.12, 5.92]);

    expect(body.mvp.gain).toBe(-10.93);
    expect(body.scoring).toBe("relative");
    expect(body.diffDecimals).toBe(2);

    // Predictions carry metric field
    if (body.predictions?.length > 0) {
      expect(body.predictions[0].metric).toBe("bodyFatPct");
    }
  });

  test("C: weight multiplier applies to relative diff", async () => {
    const { room, chang, xuanyu, jeffrey } = setupRoom8();
    // Set multipliers
    db.update(schema.roomMembers)
      .set({ weightMultiplier: 1.5 })
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, xuanyu.id)))
      .run();
    db.update(schema.roomMembers)
      .set({ weightMultiplier: 1.5 })
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, jeffrey.id)))
      .run();

    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    const byName = Object.fromEntries(body.rankings.map((r: any) => [r.name, r]));

    expect(byName["宣羽"].rawDiff).toBe(-10.93);
    expect(byName["宣羽"].weightedDiff).toBe(-16.4);
    expect(byName["宣羽"].isImprovement).toBe(true);

    expect(byName["Jeffrey"].rawDiff).toBe(5.92);
    expect(byName["Jeffrey"].weightedDiff).toBe(3.95);
    expect(byName["Jeffrey"].isImprovement).toBe(false);
  });

  test("D: skeletalMuscle uses absolute diff with 1 decimal", async () => {
    const { room, chang } = setupRoom8();
    // Add skeletal muscle data for Chang
    const changReports = db
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(eq(schema.reports.userId, chang.id))
      .orderBy(schema.reports.measuredAt)
      .all();
    db.update(schema.measurements)
      .set({ skeletalMuscle: 30.0 })
      .where(eq(schema.measurements.reportId, changReports[0]!.id))
      .run();
    db.update(schema.measurements)
      .set({ skeletalMuscle: 31.2 })
      .where(eq(schema.measurements.reportId, changReports[1]!.id))
      .run();

    const res = await app.request(`/api/rooms/${room.slug}/leaderboard?metric=skeletalMuscle`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    const changEntry = body.rankings.find((r: any) => r.name === "Chang");
    expect(changEntry.diff).toBe(1.2);
    expect(body.scoring).toBe("absolute");
    expect(body.diffDecimals).toBe(1);
  });

  test("E: mirror not ended uses visible data only", async () => {
    const owner = makeUser("owner-e");
    const xuanyu = makeUser("宣羽E");
    const room = makeRoom(owner.id, {
      visibilityMode: "mirror",
      startDate: "2026-07-01",
      endDate: "2099-12-31",
    });
    addMember(room.id, xuanyu.id);

    // Owner: 2 reports
    const o1 = makeConfirmedReport(owner.id, "2026-07-01", { bodyFatPct: 25 });
    submitToRoom(room.id, owner.id, o1.id);
    const o2 = makeConfirmedReport(owner.id, "2026-08-15", { bodyFatPct: 24 });
    submitToRoom(room.id, owner.id, o2.id);

    // 宣羽: 3 reports, owner can only see up to 08-15 (their latest)
    const x1 = makeConfirmedReport(xuanyu.id, "2026-07-01", { bodyFatPct: 37.5 });
    submitToRoom(room.id, xuanyu.id, x1.id);
    const x2 = makeConfirmedReport(xuanyu.id, "2026-08-01", { bodyFatPct: 35.0 });
    submitToRoom(room.id, xuanyu.id, x2.id);
    const x3 = makeConfirmedReport(xuanyu.id, "2026-09-20", { bodyFatPct: 33.4 });
    submitToRoom(room.id, xuanyu.id, x3.id);

    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(owner.id),
    });
    const body = await res.json();
    const xuanyuEntry = body.rankings.find((r: any) => r.name === "宣羽E");
    // (35.0 - 37.5) / 37.5 * 100 = -6.6667 → toFixed(2) → -6.67
    expect(xuanyuEntry.diff).toBe(-6.67);
  });

  test("F: initial bodyFatPct 0 excluded from rankings", async () => {
    const owner = makeUser("owner-f");
    const zero = makeUser("zero-bf");
    const room = makeRoom(owner.id, {
      visibilityMode: "open",
      startDate: "2026-07-01",
      endDate: "2026-12-31",
    });
    addMember(room.id, zero.id);

    makeConfirmedReport(owner.id, "2026-07-01", { bodyFatPct: 25 });
    makeConfirmedReport(owner.id, "2026-09-01", { bodyFatPct: 24 });
    makeConfirmedReport(zero.id, "2026-07-01", { bodyFatPct: 0 });
    makeConfirmedReport(zero.id, "2026-09-01", { bodyFatPct: 20 });

    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(owner.id),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.rankings.map((r: any) => r.name);
    expect(names).not.toContain("zero-bf");
  });
});
