import { describe, test, expect, beforeEach } from "bun:test";
import apiLeaderboard from "./api-leaderboard.ts";
import roomsRouter from "./rooms.ts";
import { makeTestApp, authHeader, makeUser, makeRoom, addMember, addForfeit, makeConfirmedReport, submitToRoom, resetDb } from "../lib/test-helpers.ts";
import { db, schema } from "../db/index.ts";
import { eq, and } from "drizzle-orm";

const app = makeTestApp(apiLeaderboard);
const roomsApp = makeTestApp(roomsRouter);

beforeEach(() => resetDb());

function setupRoom8Ended() {
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
    endDate: "2026-09-30",
  });
  for (const m of [xuanyu, yinyin, jiwei, yuqing, chia, zhiwei, kevin, jeffrey]) {
    addMember(room.id, m.id);
  }
  const data: [typeof chang, number, number][] = [
    [xuanyu, 37.5, 33.4], [yinyin, 24.9, 23.3], [chang, 27.4, 26.3],
    [chia, 32.2, 31.7], [yuqing, 34.2, 33.7], [jiwei, 42.5, 41.9],
    [zhiwei, 28.8, 28.4], [kevin, 26.9, 26.6], [jeffrey, 30.4, 32.2],
  ];
  for (const [u, first, last] of data) {
    const r1 = makeConfirmedReport(u.id, "2026-07-01", { bodyFatPct: first });
    submitToRoom(room.id, u.id, r1.id);
    const r2 = makeConfirmedReport(u.id, "2026-09-30", { bodyFatPct: last });
    submitToRoom(room.id, u.id, r2.id);
  }
  const yifang = addForfeit(room.id, { name: "一芳", createdBy: chang.id });
  return { room, chang, xuanyu, yinyin, jiwei, yuqing, chia, zhiwei, kevin, jeffrey, yifang };
}

async function putSettlement(slug: string, userId: number, body: any) {
  return roomsApp.request(`/api/rooms/${slug}/settlements`, {
    method: "PUT",
    headers: { ...(await authHeader(userId)), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getLeaderboard(slug: string, userId: number, metric = "bodyFatPct") {
  const res = await app.request(`/api/rooms/${slug}/leaderboard?metric=${metric}`, {
    headers: await authHeader(userId),
  });
  return res.json();
}

describe("reward settlements", () => {
  test("S1: room not ended → 409; leaderboard has no settlement field", async () => {
    const { room, chang, chia } = setupRoom8Ended();
    db.update(schema.rooms).set({ endDate: "2099-12-31" }).where(eq(schema.rooms.id, room.id)).run();
    const res1 = await putSettlement(room.slug, chia.id, { userId: chia.id, settled: true });
    expect(res1.status).toBe(409);
    const res2 = await putSettlement(room.slug, chang.id, { userId: chia.id, settled: true });
    expect(res2.status).toBe(409);
    const lb = await getLeaderboard(room.slug, chang.id);
    const chiaEntry = lb.rankings.find((r: any) => r.name === "chia");
    expect(chiaEntry.settlement).toBeUndefined();
  });

  test("S2: self-settle → 200; leaderboard shows settled", async () => {
    const { room, chia } = setupRoom8Ended();
    const res = await putSettlement(room.slug, chia.id, { userId: chia.id, settled: true });
    expect(res.status).toBe(200);
    const lb = await getLeaderboard(room.slug, chia.id);
    const chiaEntry = lb.rankings.find((r: any) => r.name === "chia");
    expect(chiaEntry.settlement.settled).toBe(true);
    expect(chiaEntry.settlement.markedAt).toBeTruthy();
    expect(chiaEntry.settlement.markedByOwner).toBe(false);
  });

  test("S3: permission — member settles another → 403; member settles forfeit → 403; non-member → 403; left member → 403; unauth → 401", async () => {
    const { room, chang, kevin, chia, yifang } = setupRoom8Ended();
    const outsider = makeUser("outsider");
    // kevin settles chia → 403
    let res = await putSettlement(room.slug, kevin.id, { userId: chia.id, settled: true });
    expect(res.status).toBe(403);
    let dbRow = db.select().from(schema.roomRewardSettlements).where(eq(schema.roomRewardSettlements.roomId, room.id)).get();
    expect(dbRow).toBeUndefined();
    // kevin settles forfeit → 403
    res = await putSettlement(room.slug, kevin.id, { forfeitId: yifang.id, settled: true });
    expect(res.status).toBe(403);
    // outsider → 403
    res = await putSettlement(room.slug, outsider.id, { userId: outsider.id, settled: true });
    expect(res.status).toBe(403);
    // left member → 403
    db.update(schema.roomMembers)
      .set({ leftAt: "2026-10-01T00:00:00Z" })
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, kevin.id)))
      .run();
    res = await putSettlement(room.slug, kevin.id, { userId: kevin.id, settled: true });
    expect(res.status).toBe(403);
    // unauth → 401
    res = await roomsApp.request(`/api/rooms/${room.slug}/settlements`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: chia.id, settled: true }),
    });
    expect(res.status).toBe(401);
  });

  test("S4: owner settles forfeit → markedByOwner true; owner settles kevin → markedByOwner true; owner settles self → markedByOwner false; kevin re-settles → markedByOwner false", async () => {
    const { room, chang, kevin, yifang } = setupRoom8Ended();
    // Owner settles forfeit
    await putSettlement(room.slug, chang.id, { forfeitId: yifang.id, settled: true });
    let lb = await getLeaderboard(room.slug, chang.id);
    let yifangEntry = lb.rankings.find((r: any) => r.name === "一芳");
    expect(yifangEntry.settlement.markedByOwner).toBe(true);
    // Owner settles kevin
    await putSettlement(room.slug, chang.id, { userId: kevin.id, settled: true });
    lb = await getLeaderboard(room.slug, chang.id);
    let kevinEntry = lb.rankings.find((r: any) => r.name === "kevin");
    expect(kevinEntry.settlement.markedByOwner).toBe(true);
    // Owner settles self (Chang)
    await putSettlement(room.slug, chang.id, { userId: chang.id, settled: true });
    lb = await getLeaderboard(room.slug, chang.id);
    let changEntry = lb.rankings.find((r: any) => r.name === "Chang");
    expect(changEntry.settlement.markedByOwner).toBe(false);
    // Kevin re-settles self → markedByOwner becomes false
    await putSettlement(room.slug, kevin.id, { userId: kevin.id, settled: true });
    lb = await getLeaderboard(room.slug, kevin.id);
    kevinEntry = lb.rankings.find((r: any) => r.name === "kevin");
    expect(kevinEntry.settlement.markedByOwner).toBe(false);
  });

  test("S10: body fields ignored — owner's id in marked_by despite markedBy in body", async () => {
    const { room, chang, kevin } = setupRoom8Ended();
    await putSettlement(room.slug, chang.id, { userId: kevin.id, settled: true, markedBy: kevin.id, markedAt: "2020-01-01" });
    const row = db.select().from(schema.roomRewardSettlements)
      .where(and(eq(schema.roomRewardSettlements.roomId, room.id), eq(schema.roomRewardSettlements.userId, kevin.id)))
      .get();
    expect(row!.markedBy).toBe(chang.id);
    expect(row!.markedAt).not.toBe("2020-01-01");
    const lb = await getLeaderboard(room.slug, chang.id);
    const kevinEntry = lb.rankings.find((r: any) => r.name === "kevin");
    expect(kevinEntry.settlement.markedByOwner).toBe(true);
    // Kevin settles self with forged markedBy
    await putSettlement(room.slug, kevin.id, { userId: kevin.id, settled: true, markedBy: chang.id });
    const row2 = db.select().from(schema.roomRewardSettlements)
      .where(and(eq(schema.roomRewardSettlements.roomId, room.id), eq(schema.roomRewardSettlements.userId, kevin.id)))
      .get();
    expect(row2!.markedBy).toBe(kevin.id);
  });

  test("S5: target not in standings → 404; both userId and forfeitId → 400", async () => {
    const { room, chang, yifang } = setupRoom8Ended();
    const daP = makeUser("大P");
    addMember(room.id, daP.id);
    // 大P has 0 submissions, not in standings
    let res = await putSettlement(room.slug, chang.id, { userId: daP.id, settled: true });
    expect(res.status).toBe(404);
    // Cross-room forfeit
    const owner2 = makeUser("owner2");
    const room2 = makeRoom(owner2.id);
    const f2 = addForfeit(room2.id, { name: "test", createdBy: owner2.id });
    res = await putSettlement(room.slug, chang.id, { forfeitId: f2.id, settled: true });
    expect(res.status).toBe(404);
    // Both userId and forfeitId
    res = await putSettlement(room.slug, chang.id, { userId: chang.id, forfeitId: yifang.id, settled: true });
    expect(res.status).toBe(400);
  });

  test("S6: zone changes → stale; revert → restored", async () => {
    const { room, chang, chia, yifang } = setupRoom8Ended();
    // 10 people, chia is winner (rank 5, cutoff 5)
    await putSettlement(room.slug, chia.id, { userId: chia.id, settled: true });
    // Remove 一芳 → 9 people, cutoff 4, chia becomes loser
    await roomsApp.request(`/api/rooms/${room.slug}/forfeits/${yifang.id}`, {
      method: "DELETE",
      headers: await authHeader(chang.id),
    });
    let lb = await getLeaderboard(room.slug, chang.id);
    let chiaEntry = lb.rankings.find((r: any) => r.name === "chia");
    expect(chiaEntry.settlement.stale).toBe(true);
    expect(chiaEntry.settlement.settled).toBe(false);
    expect(lb.settlementSummary.settled).toBe(0);
    // Re-add 一芳 → 10 people, chia back to winner
    await roomsApp.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(chang.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "一芳" }),
    });
    lb = await getLeaderboard(room.slug, chang.id);
    chiaEntry = lb.rankings.find((r: any) => r.name === "chia");
    expect(chiaEntry.settlement.stale).toBe(false);
    expect(chiaEntry.settlement.settled).toBe(true);
  });

  test("S7: delete forfeited person with settlement → 200, settlement also deleted", async () => {
    const { room, chang, yifang } = setupRoom8Ended();
    await putSettlement(room.slug, chang.id, { forfeitId: yifang.id, settled: true });
    const res = await roomsApp.request(`/api/rooms/${room.slug}/forfeits/${yifang.id}`, {
      method: "DELETE",
      headers: await authHeader(chang.id),
    });
    expect(res.status).toBe(200);
    const row = db.select().from(schema.roomRewardSettlements)
      .where(eq(schema.roomRewardSettlements.forfeitId, yifang.id)).get();
    expect(row).toBeUndefined();
  });

  test("S8: all 10 settled → allSettled; one stale → false", async () => {
    const { room, chang, xuanyu, yinyin, jiwei, yuqing, chia, zhiwei, kevin, jeffrey, yifang } = setupRoom8Ended();
    const all = [chang, xuanyu, yinyin, jiwei, yuqing, chia, zhiwei, kevin, jeffrey];
    for (const u of all) {
      await putSettlement(room.slug, chang.id, { userId: u.id, settled: true });
    }
    await putSettlement(room.slug, chang.id, { forfeitId: yifang.id, settled: true });
    let lb = await getLeaderboard(room.slug, chang.id);
    expect(lb.settlementSummary.allSettled).toBe(true);
    expect(lb.settlementSummary.total).toBe(10);
    expect(lb.settlementSummary.settled).toBe(10);
    // Remove 一芳 → chia's zone changes → stale
    await roomsApp.request(`/api/rooms/${room.slug}/forfeits/${yifang.id}`, {
      method: "DELETE",
      headers: await authHeader(chang.id),
    });
    lb = await getLeaderboard(room.slug, chang.id);
    expect(lb.settlementSummary.allSettled).toBe(false);
  });

  test("S9: self cancel → row deleted; can cancel owner-marked", async () => {
    const { room, chang, chia } = setupRoom8Ended();
    await putSettlement(room.slug, chia.id, { userId: chia.id, settled: true });
    await putSettlement(room.slug, chia.id, { userId: chia.id, settled: false });
    const row = db.select().from(schema.roomRewardSettlements)
      .where(and(eq(schema.roomRewardSettlements.roomId, room.id), eq(schema.roomRewardSettlements.userId, chia.id))).get();
    expect(row).toBeUndefined();
    // Owner marks, then chia cancels
    await putSettlement(room.slug, chang.id, { userId: chia.id, settled: true });
    await putSettlement(room.slug, chia.id, { userId: chia.id, settled: false });
    const row2 = db.select().from(schema.roomRewardSettlements)
      .where(and(eq(schema.roomRewardSettlements.roomId, room.id), eq(schema.roomRewardSettlements.userId, chia.id))).get();
    expect(row2).toBeUndefined();
  });

  test("S6b: re-settle after zone change → zone_at_mark updated; then revert → stale again", async () => {
    const { room, chang, chia, yifang } = setupRoom8Ended();
    // chia winner in 10 people
    await putSettlement(room.slug, chia.id, { userId: chia.id, settled: true });
    // Remove 一芳 → chia loser
    await roomsApp.request(`/api/rooms/${room.slug}/forfeits/${yifang.id}`, {
      method: "DELETE",
      headers: await authHeader(chang.id),
    });
    // Re-settle as loser
    await putSettlement(room.slug, chia.id, { userId: chia.id, settled: true });
    const row = db.select().from(schema.roomRewardSettlements)
      .where(and(eq(schema.roomRewardSettlements.roomId, room.id), eq(schema.roomRewardSettlements.userId, chia.id))).get();
    expect(row!.zoneAtMark).toBe("loser");
    // Re-add 一芳 → chia winner again → her zone_at_mark says loser → stale
    await roomsApp.request(`/api/rooms/${room.slug}/forfeits`, {
      method: "POST",
      headers: { ...(await authHeader(chang.id)), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "一芳" }),
    });
    const lb = await getLeaderboard(room.slug, chang.id);
    const chiaEntry = lb.rankings.find((r: any) => r.name === "chia");
    expect(chiaEntry.settlement.stale).toBe(true);
  });

  test("S12: owner sets endDate to future → no settlements in LB; back to past → settlements restored", async () => {
    const { room, chang, chia } = setupRoom8Ended();
    await putSettlement(room.slug, chia.id, { userId: chia.id, settled: true });
    // Set end date to future
    db.update(schema.rooms).set({ endDate: "2099-12-31" }).where(eq(schema.rooms.id, room.id)).run();
    let lb = await getLeaderboard(room.slug, chang.id);
    expect(lb.settlementSummary).toBeUndefined();
    const res = await putSettlement(room.slug, chia.id, { userId: chia.id, settled: true });
    expect(res.status).toBe(409);
    // Set back to ended
    db.update(schema.rooms).set({ endDate: "2026-09-30" }).where(eq(schema.rooms.id, room.id)).run();
    lb = await getLeaderboard(room.slug, chang.id);
    const chiaEntry = lb.rankings.find((r: any) => r.name === "chia");
    expect(chiaEntry.settlement.settled).toBe(true);
  });

  test("S13: non-official metric has no settlements", async () => {
    const { room, chang, chia } = setupRoom8Ended();
    await putSettlement(room.slug, chia.id, { userId: chia.id, settled: true });
    const lb = await getLeaderboard(room.slug, chang.id, "skeletalMuscle");
    expect(lb.settlementSummary).toBeUndefined();
    const chiaEntry = lb.rankings?.find((r: any) => r.name === "chia");
    if (chiaEntry) {
      expect(chiaEntry.settlement).toBeUndefined();
    }
  });

  test("S14: ghost member sees self without settlement; ghost PUT → 404", async () => {
    const { room, chang } = setupRoom8Ended();
    const ghost = makeUser("ghost");
    const gm = addMember(room.id, ghost.id);
    db.update(schema.roomMembers).set({ isGhost: true }).where(eq(schema.roomMembers.id, gm.id)).run();
    const g1 = makeConfirmedReport(ghost.id, "2026-07-01", { bodyFatPct: 25 });
    submitToRoom(room.id, ghost.id, g1.id);
    const g2 = makeConfirmedReport(ghost.id, "2026-09-30", { bodyFatPct: 23 });
    submitToRoom(room.id, ghost.id, g2.id);
    const lb = await getLeaderboard(room.slug, ghost.id);
    const ghostEntry = lb.rankings.find((r: any) => r.name === "ghost");
    if (ghostEntry) {
      expect(ghostEntry.settlement).toBeNull();
    }
    const res = await putSettlement(room.slug, ghost.id, { userId: ghost.id, settled: true });
    expect(res.status).toBe(404);
  });

  test("S15: PUT with forfeitId pointing to member-forfeit → 400", async () => {
    const { room, chang, jeffrey } = setupRoom8Ended();
    const f = addForfeit(room.id, { userId: jeffrey.id, createdBy: chang.id });
    const res = await putSettlement(room.slug, chang.id, { forfeitId: f.id, settled: true });
    expect(res.status).toBe(400);
  });

  test("S16: member leaves → total decreases; rejoins → settlement restored", async () => {
    const { room, chang, kevin } = setupRoom8Ended();
    await putSettlement(room.slug, kevin.id, { userId: kevin.id, settled: true });
    let lb = await getLeaderboard(room.slug, chang.id);
    const total1 = lb.settlementSummary.total;
    const settled1 = lb.settlementSummary.settled;
    // Kevin leaves
    db.update(schema.roomMembers)
      .set({ leftAt: "2026-10-01T00:00:00Z" })
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, kevin.id)))
      .run();
    lb = await getLeaderboard(room.slug, chang.id);
    expect(lb.settlementSummary.total).toBe(total1 - 1);
    expect(lb.settlementSummary.settled).toBe(settled1 - 1);
    // Kevin rejoins
    db.update(schema.roomMembers)
      .set({ leftAt: null })
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, kevin.id)))
      .run();
    lb = await getLeaderboard(room.slug, chang.id);
    expect(lb.settlementSummary.total).toBe(total1);
    expect(lb.settlementSummary.settled).toBe(settled1);
  });
});
