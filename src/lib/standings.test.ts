import { describe, test, expect, beforeEach } from "bun:test";
import { computeFinalStandings } from "./standings.ts";
import { makeUser, makeRoom, addMember, addForfeit, makeConfirmedReport, submitToRoom, resetDb } from "./test-helpers.ts";
import { db, schema } from "../db/index.ts";
import { eq, and } from "drizzle-orm";

beforeEach(() => resetDb());

describe("computeFinalStandings", () => {
  test("room 8 + 一芳 = 10 entries, same ranks as leaderboard L3", () => {
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
      [xuanyu, 37.5, 33.4],
      [yinyin, 24.9, 23.3],
      [chang, 27.4, 26.3],
      [chia, 32.2, 31.7],
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
    addForfeit(room.id, { name: "一芳", createdBy: chang.id });

    const standings = computeFinalStandings(room.id);
    expect(standings).toHaveLength(10);
    const ranks = standings.map(s => s.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 5, 7, 8, 9, 10]);
    const chiaS = standings.find(s => s.name === "chia");
    expect(chiaS!.zone).toBe("winner");
    const yifangS = standings.find(s => s.name === "一芳");
    expect(yifangS!.rank).toBe(10);
    expect(yifangS!.forfeited).toBe(true);
    expect(yifangS!.zone).toBe("loser");
  });
});
