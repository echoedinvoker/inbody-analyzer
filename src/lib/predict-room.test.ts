import { describe, test, expect, beforeEach } from "bun:test";
import { predictAllInRoom } from "./predict-room.ts";
import { makeUser, makeRoom, addMember, makeConfirmedReport, submitToRoom, resetDb } from "./test-helpers.ts";

beforeEach(() => resetDb());

describe("predict-room body fat absolute change", () => {
  test("predictedChange is absolute points for cut rooms", () => {
    const owner = makeUser("owner");
    const xuanyu = makeUser("宣羽");
    const jiwei = makeUser("紀維");
    const chia = makeUser("chia");

    const room = makeRoom(owner.id, {
      visibilityMode: "open",
      startDate: "2026-07-01",
      endDate: "2026-09-30",
    });
    addMember(room.id, xuanyu.id);
    addMember(room.id, jiwei.id);
    addMember(room.id, chia.id);

    // 2 points each, latest on endDate → regression line passes through both
    // → predictedValue = last value exactly
    makeConfirmedReport(xuanyu.id, "2026-07-01", { bodyFatPct: 37.5 });
    makeConfirmedReport(xuanyu.id, "2026-09-30", { bodyFatPct: 33.4 });

    makeConfirmedReport(jiwei.id, "2026-07-01", { bodyFatPct: 42.5 });
    makeConfirmedReport(jiwei.id, "2026-09-30", { bodyFatPct: 41.9 });

    makeConfirmedReport(chia.id, "2026-07-01", { bodyFatPct: 33.2 });
    makeConfirmedReport(chia.id, "2026-09-30", { bodyFatPct: 32.7 });

    makeConfirmedReport(owner.id, "2026-07-01", { bodyFatPct: 25 });
    makeConfirmedReport(owner.id, "2026-09-30", { bodyFatPct: 24 });

    const predictions = predictAllInRoom(room.id, room);
    const byName = Object.fromEntries(predictions.map((p) => [p.name, p]));

    // 宣羽: 33.4 - 37.5 = -4.1 points
    expect(byName["宣羽"].predictedValue).toBe(33.4);
    expect(byName["宣羽"].predictedChange).toBe(-4.1);

    // 紀維: 41.9 - 42.5 = -0.6
    expect(byName["紀維"].predictedChange).toBe(-0.6);

    // Sorted by absolute change (ascending for cut): 宣羽 -4.1, owner -1, 紀維 -0.6, chia -0.5
    // (relative scoring would put chia before 紀維 — this order distinguishes the two)
    const order = predictions.map((p) => p.name);
    expect(order).toEqual(["宣羽", "owner", "紀維", "chia"]);
  });
});
