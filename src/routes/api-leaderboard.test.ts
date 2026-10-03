import { describe, test, expect, beforeEach } from "bun:test";
import apiLeaderboard from "./api-leaderboard.ts";
import rooms from "./rooms.ts";
import { makeTestApp, authHeader, makeUser, makeRoom, addMember, addForfeit, makeConfirmedReport, submitToRoom, resetDb } from "../lib/test-helpers.ts";
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

function setupRoom8(opts?: { chiaFirst?: number; chiaLast?: number; endDate?: string }) {
  const chiaFirst = opts?.chiaFirst ?? 33.2;
  const chiaLast = opts?.chiaLast ?? 32.7;
  const endDate = opts?.endDate ?? "2026-09-30";

  const chang = makeUser("Chang");
  const xuanyu = makeUser("宣羽");
  const yinyin = makeUser("茵茵");
  const jiwei = makeUser("紀維");
  const yuqing = makeUser("邱郁晴");
  const chia = makeUser("chia");
  const zhiwei = makeUser("張志瑋");
  const kevin = makeUser("kevin");
  const jeffrey = makeUser("Jeffrey");

  const room = makeRoom(chang.id, {
    visibilityMode: "mirror",
    startDate: "2026-07-01",
    endDate,
  });

  const members = [xuanyu, yinyin, jiwei, yuqing, chia, zhiwei, kevin, jeffrey];
  for (const m of members) addMember(room.id, m.id);

  const data: [typeof chang, number, number][] = [
    [xuanyu, 37.5, 33.4],
    [yinyin, 24.9, 23.3],
    [chang, 27.4, 26.3],
    [chia, chiaFirst, chiaLast],
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

describe("body fat score is absolute point change", () => {
  test("A: ranking order matches absolute point change", async () => {
    const { room, chang } = setupRoom8();
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.rankings.map((r: any) => r.name);
    // 紀維 (-0.6) ahead of chia (-0.5); relative scoring would flip them
    expect(names.slice(0, 4)).toEqual(["宣羽", "茵茵", "Chang", "紀維"]);
    expect(names.slice(4, 6).sort()).toEqual(["chia", "邱郁晴"].sort()); // tied at -0.5
    expect(names.slice(6)).toEqual(["張志瑋", "kevin", "Jeffrey"]);
  });

  test("B: diff values are absolute points with 1 decimal", async () => {
    const { room, chang } = setupRoom8();
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    const diffs = body.rankings.map((r: any) => r.diff);
    expect(diffs).toEqual([-4.1, -1.6, -1.1, -0.6, -0.5, -0.5, -0.4, -0.3, 1.8]);

    const rawDiffs = body.rankings.map((r: any) => r.rawDiff);
    expect(rawDiffs).toEqual([-4.1, -1.6, -1.1, -0.6, -0.5, -0.5, -0.4, -0.3, 1.8]);

    expect(body.mvp.gain).toBe(-4.1);
    expect(body.scoring).toBe("absolute");
    expect(body.diffDecimals).toBe(1);

    // Predictions carry metric field
    if (body.predictions?.length > 0) {
      expect(body.predictions[0].metric).toBe("bodyFatPct");
    }
  });

  test("C: weight multiplier applies to absolute diff", async () => {
    const { room, chang, xuanyu, jeffrey } = setupRoom8();
    db.update(schema.roomMembers)
      .set({ weightMultiplier: 2 })
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, xuanyu.id)))
      .run();
    db.update(schema.roomMembers)
      .set({ weightMultiplier: 2 })
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, jeffrey.id)))
      .run();

    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    const byName = Object.fromEntries(body.rankings.map((r: any) => [r.name, r]));

    expect(byName["宣羽"].rawDiff).toBe(-4.1);
    expect(byName["宣羽"].weightedDiff).toBe(-8.2);
    expect(byName["宣羽"].isImprovement).toBe(true);

    expect(byName["Jeffrey"].rawDiff).toBe(1.8);
    expect(byName["Jeffrey"].weightedDiff).toBe(0.9);
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
    // 35.0 - 37.5 = -2.5 (the 09-20 report is hidden from owner)
    expect(xuanyuEntry.diff).toBe(-2.5);
  });
});

describe("ties, forfeits and zones", () => {
  test("L1b: fixture really has the floating-point trap", () => {
    expect(31.7 - 32.2).not.toBe(-0.5);
  });

  test("L1: competition ranking with ties — chia and 邱郁晴 both #5, 張志瑋 #7", async () => {
    const { room, chang } = setupRoom8({ chiaFirst: 32.2, chiaLast: 31.7 });
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    const ranks = body.rankings.map((r: any) => r.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 5, 7, 8, 9]);
    const chiaEntry = body.rankings.find((r: any) => r.name === "chia");
    const yuqingEntry = body.rankings.find((r: any) => r.name === "邱郁晴");
    expect(chiaEntry.rank).toBe(5);
    expect(yuqingEntry.rank).toBe(5);
    const zhiweiEntry = body.rankings.find((r: any) => r.name === "張志瑋");
    expect(zhiweiEntry.rank).toBe(7);
  });

  test("L2: 9 people, winnerCutoff=4, chia/邱郁晴 are losers", async () => {
    const { room, chang } = setupRoom8({ chiaFirst: 32.2, chiaLast: 31.7 });
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    expect(body.totalParticipants).toBe(9);
    expect(body.winnerCutoff).toBe(4);
    const chiaEntry = body.rankings.find((r: any) => r.name === "chia");
    const yuqingEntry = body.rankings.find((r: any) => r.name === "邱郁晴");
    expect(chiaEntry.zone).toBe("loser");
    expect(yuqingEntry.zone).toBe("loser");
  });

  test("L3: name-only forfeit makes 10 people, chia/邱郁晴 become winners", async () => {
    const { room, chang } = setupRoom8({ chiaFirst: 32.2, chiaLast: 31.7 });
    addForfeit(room.id, { name: "一芳", createdBy: chang.id });
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    expect(body.rankings).toHaveLength(10);
    expect(body.totalParticipants).toBe(10);
    expect(body.winnerCutoff).toBe(5);
    const lastEntry = body.rankings[body.rankings.length - 1];
    expect(lastEntry.name).toBe("一芳");
    expect(lastEntry.rank).toBe(10);
    expect(lastEntry.forfeited).toBe(true);
    expect(lastEntry.userId).toBeNull();
    expect(lastEntry.diff).toBeNull();
    expect(lastEntry.zone).toBe("loser");
    const chiaEntry = body.rankings.find((r: any) => r.name === "chia");
    const yuqingEntry = body.rankings.find((r: any) => r.name === "邱郁晴");
    expect(chiaEntry.zone).toBe("winner");
    expect(yuqingEntry.zone).toBe("winner");
  });

  test("L4: two forfeits — both rank 10, totalParticipants=11, 大P not in unqualified", async () => {
    const { room, chang } = setupRoom8({ chiaFirst: 32.2, chiaLast: 31.7 });
    const daP = makeUser("大P");
    addMember(room.id, daP.id);
    addForfeit(room.id, { name: "一芳", createdBy: chang.id });
    addForfeit(room.id, { userId: daP.id, createdBy: chang.id });
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    const forfeitEntries = body.rankings.filter((r: any) => r.forfeited);
    expect(forfeitEntries).toHaveLength(2);
    expect(forfeitEntries[0].rank).toBe(10);
    expect(forfeitEntries[1].rank).toBe(10);
    expect(body.totalParticipants).toBe(11);
    const unqNames = body.unqualifiedMembers.map((u: any) => u.name);
    expect(unqNames).not.toContain("大P");
  });

  test("L5: member with data forfeited — shows as forfeit, not in scored list", async () => {
    const { room, chang, jeffrey } = setupRoom8({ chiaFirst: 32.2, chiaLast: 31.7 });
    addForfeit(room.id, { userId: jeffrey.id, createdBy: chang.id });
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    const scoredNames = body.rankings.filter((r: any) => !r.forfeited).map((r: any) => r.name);
    expect(scoredNames).not.toContain("Jeffrey");
    const jeffreyEntry = body.rankings.find((r: any) => r.name === "Jeffrey");
    expect(jeffreyEntry.forfeited).toBe(true);
    expect(jeffreyEntry.diff).toBeNull();
    expect(body.totalParticipants).toBe(9);
  });

  test("L6: entryKey unique; mvp is 宣羽; only-forfeits → mvp null", async () => {
    const { room, chang } = setupRoom8({ chiaFirst: 32.2, chiaLast: 31.7 });
    addForfeit(room.id, { name: "一芳", createdBy: chang.id });
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    const keys = body.rankings.map((r: any) => r.entryKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(body.mvp.name).toBe("宣羽");
  });

  test("L7: mirror in-progress — rankRange.max ≤ scored count; forfeits at end", async () => {
    const { room, chang, xuanyu } = setupRoom8({ chiaFirst: 32.2, chiaLast: 31.7, endDate: "2099-12-31" });
    addForfeit(room.id, { name: "一芳", createdBy: chang.id });
    // Chang has older data than xuanyu → estimated
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    if (body.rankRange) {
      const scoredCount = body.rankings.filter((r: any) => !r.forfeited).length;
      expect(body.rankRange.max).toBeLessThanOrEqual(scoredCount);
    }
    const lastEntry = body.rankings[body.rankings.length - 1];
    expect(lastEntry.forfeited).toBe(true);
  });

  test("L8: viewer is forfeited — rankType real, rankRange null", async () => {
    // Mirror, in-progress, viewer has 1 submission dated earlier than others
    const owner = makeUser("owner-l8");
    const viewer = makeUser("viewer-l8");
    const other = makeUser("other-l8");
    const room = makeRoom(owner.id, {
      visibilityMode: "mirror",
      startDate: "2026-07-01",
      endDate: "2099-12-31",
    });
    addMember(room.id, viewer.id);
    addMember(room.id, other.id);
    // Owner: 2 subs
    const o1 = makeConfirmedReport(owner.id, "2026-07-01", { bodyFatPct: 30 });
    submitToRoom(room.id, owner.id, o1.id);
    const o2 = makeConfirmedReport(owner.id, "2026-09-01", { bodyFatPct: 28 });
    submitToRoom(room.id, owner.id, o2.id);
    // Viewer: 1 sub, dated earlier → would be estimated
    const v1 = makeConfirmedReport(viewer.id, "2026-07-01", { bodyFatPct: 25 });
    submitToRoom(room.id, viewer.id, v1.id);
    const v2 = makeConfirmedReport(viewer.id, "2026-07-15", { bodyFatPct: 24 });
    submitToRoom(room.id, viewer.id, v2.id);
    // Other: 2 subs, latest is after viewer's
    const t1 = makeConfirmedReport(other.id, "2026-07-01", { bodyFatPct: 35 });
    submitToRoom(room.id, other.id, t1.id);
    const t2 = makeConfirmedReport(other.id, "2026-09-15", { bodyFatPct: 33 });
    submitToRoom(room.id, other.id, t2.id);
    // Forfeit the viewer
    addForfeit(room.id, { userId: viewer.id, createdBy: owner.id });
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(viewer.id),
    });
    const body = await res.json();
    const myEntry = body.rankings.find((r: any) => r.isMe);
    expect(myEntry.forfeited).toBe(true);
    expect(body.rankRange).toBeNull();
    expect(body.rankType).toBe("real");
  });

  test("L9: member forfeit then leaves — not in list; rejoins — forfeit restored", async () => {
    const { room, chang, jeffrey } = setupRoom8({ chiaFirst: 32.2, chiaLast: 31.7 });
    addForfeit(room.id, { userId: jeffrey.id, createdBy: chang.id });
    // Jeffrey leaves
    db.update(schema.roomMembers)
      .set({ leftAt: "2026-10-01T00:00:00Z" })
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, jeffrey.id)))
      .run();
    let res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    let body = await res.json();
    expect(body.totalParticipants).toBe(8);
    expect(body.rankings.find((r: any) => r.name === "Jeffrey")).toBeUndefined();
    // Jeffrey rejoins
    db.update(schema.roomMembers)
      .set({ leftAt: null })
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, jeffrey.id)))
      .run();
    res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    body = await res.json();
    expect(body.totalParticipants).toBe(9);
    const jeffreyEntry = body.rankings.find((r: any) => r.name === "Jeffrey");
    expect(jeffreyEntry.forfeited).toBe(true);
  });

  test("L10: weighted tie — pre-round raw diff before multiplying", async () => {
    const { room, chang, chia, yuqing } = setupRoom8({ chiaFirst: 32.2, chiaLast: 31.7 });
    // Both chia (32.2→31.7, raw=-0.5) and yuqing (34.2→33.7, raw=-0.5) get multiplier 1.5
    db.update(schema.roomMembers)
      .set({ weightMultiplier: 1.5 })
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, chia.id)))
      .run();
    db.update(schema.roomMembers)
      .set({ weightMultiplier: 1.5 })
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, yuqing.id)))
      .run();
    const res = await app.request(`/api/rooms/${room.slug}/leaderboard`, {
      headers: await authHeader(chang.id),
    });
    const body = await res.json();
    const chiaEntry = body.rankings.find((r: any) => r.name === "chia");
    const yuqingEntry = body.rankings.find((r: any) => r.name === "邱郁晴");
    expect(chiaEntry.rank).toBe(yuqingEntry.rank);
    expect(chiaEntry.weightedDiff).toBe(-0.8);
    expect(yuqingEntry.weightedDiff).toBe(-0.8);
  });
});
