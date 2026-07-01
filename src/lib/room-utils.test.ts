import { describe, test, expect } from "bun:test";
import {
  isRoomEnded, applyMirrorFilter, applyDateMirrorFilter,
  resolveRankType, computeHasHidden, classifyMember, applyMultiplier,
} from "./room-utils.ts";

describe("isRoomEnded", () => {
  test("endDate before today → ended", () => {
    expect(isRoomEnded("2026-06-30", "2026-07-01")).toBe(true);
  });
  test("endDate equals today → ended", () => {
    expect(isRoomEnded("2026-07-01", "2026-07-01")).toBe(true);
  });
  test("endDate after today → not ended", () => {
    expect(isRoomEnded("2026-07-02", "2026-07-01")).toBe(false);
  });
});

describe("applyMirrorFilter", () => {
  const rows = [
    { measuredAt: "2026-06-01T10:00:00" },
    { measuredAt: "2026-06-15T10:00:00" },
    { measuredAt: "2026-06-28T10:00:00" },
  ];

  test("isMe → all rows visible", () => {
    expect(applyMirrorFilter(rows, { isMe: true, isEnded: false, myLatestDate: "" })).toHaveLength(3);
  });
  test("isEnded → all rows visible regardless of myLatestDate", () => {
    expect(applyMirrorFilter(rows, { isMe: false, isEnded: true, myLatestDate: "2026-06-10" })).toHaveLength(3);
  });
  test("mirror active, myLatestDate covers first two → 2 visible", () => {
    expect(applyMirrorFilter(rows, { isMe: false, isEnded: false, myLatestDate: "2026-06-20" })).toHaveLength(2);
  });
  test("mirror active, no submissions → only first visible", () => {
    expect(applyMirrorFilter(rows, { isMe: false, isEnded: false, myLatestDate: "" })).toHaveLength(1);
  });
});

describe("applyDateMirrorFilter", () => {
  const dates = ["2026-06-01", "2026-06-15", "2026-06-28"];

  test("isEnded → all dates visible", () => {
    expect(applyDateMirrorFilter(dates, { isEnded: true, myLatestDate: "2026-06-10" })).toBe(3);
  });
  test("mirror active, myLatestDate covers first two → 2", () => {
    expect(applyDateMirrorFilter(dates, { isEnded: false, myLatestDate: "2026-06-20" })).toBe(2);
  });
  test("mirror active, no submissions → only first", () => {
    expect(applyDateMirrorFilter(dates, { isEnded: false, myLatestDate: "" })).toBe(1);
  });
});

describe("resolveRankType", () => {
  test("not mirror → real", () => {
    expect(resolveRankType({ isMirror: false, isEnded: false, myLatestDate: "", maxOtherDate: "2026-07-01" }))
      .toEqual({ rankType: "real", shouldComputeRange: false });
  });
  test("mirror + ended → real", () => {
    expect(resolveRankType({ isMirror: true, isEnded: true, myLatestDate: "2026-06-01", maxOtherDate: "2026-07-01" }))
      .toEqual({ rankType: "real", shouldComputeRange: false });
  });
  test("mirror + active + caught up → real", () => {
    expect(resolveRankType({ isMirror: true, isEnded: false, myLatestDate: "2026-07-01", maxOtherDate: "2026-06-15" }))
      .toEqual({ rankType: "real", shouldComputeRange: false });
  });
  test("mirror + active + behind → estimated", () => {
    expect(resolveRankType({ isMirror: true, isEnded: false, myLatestDate: "2026-06-01", maxOtherDate: "2026-07-01" }))
      .toEqual({ rankType: "estimated", shouldComputeRange: true });
  });
});

describe("computeHasHidden", () => {
  const rows = [
    { measuredAt: "2026-06-01T10:00:00" },
    { measuredAt: "2026-06-15T10:00:00" },
    { measuredAt: "2026-06-28T10:00:00" },
  ];

  test("not mirror → false", () => {
    expect(computeHasHidden(rows, { isMirror: false, isEnded: false, isMe: false, myLatestDate: "2026-06-10" })).toBe(false);
  });
  test("isMe → false", () => {
    expect(computeHasHidden(rows, { isMirror: true, isEnded: false, isMe: true, myLatestDate: "2026-06-10" })).toBe(false);
  });
  test("isEnded → false", () => {
    expect(computeHasHidden(rows, { isMirror: true, isEnded: true, isMe: false, myLatestDate: "2026-06-10" })).toBe(false);
  });
  test("mirror active, has rows beyond myLatestDate → true", () => {
    expect(computeHasHidden(rows, { isMirror: true, isEnded: false, isMe: false, myLatestDate: "2026-06-10" })).toBe(true);
  });
  test("mirror active, all rows within myLatestDate → false", () => {
    expect(computeHasHidden(rows, { isMirror: true, isEnded: false, isMe: false, myLatestDate: "2026-07-01" })).toBe(false);
  });
});

describe("classifyMember", () => {
  test("0 submissions → no_participation", () => {
    expect(classifyMember(0, 3)).toBe("no_participation");
  });
  test("1 submission → no_participation", () => {
    expect(classifyMember(1, 3)).toBe("no_participation");
  });
  test("2 submissions, minSubs 3 → below_minimum", () => {
    expect(classifyMember(2, 3)).toBe("below_minimum");
  });
  test("3 submissions, minSubs 3 → qualified", () => {
    expect(classifyMember(3, 3)).toBe("qualified");
  });
  test("5 submissions, minSubs 3 → qualified", () => {
    expect(classifyMember(5, 3)).toBe("qualified");
  });
  test("1 submission, minSubs 1 → no_participation", () => {
    expect(classifyMember(1, 1)).toBe("no_participation");
  });
});

describe("applyMultiplier", () => {
  test("skeletalMuscle gain (lowerIsBetter=false, positive diff) → multiply", () => {
    const r = applyMultiplier(1, 1.5, false);
    expect(r.value).toBeCloseTo(1.5);
    expect(r.isImprovement).toBe(true);
  });
  test("skeletalMuscle loss (lowerIsBetter=false, negative diff) → divide", () => {
    const r = applyMultiplier(-1, 1.5, false);
    expect(r.value).toBeCloseTo(-0.6667, 3);
    expect(r.isImprovement).toBe(false);
  });
  test("bodyFatPct drop (lowerIsBetter=true, negative diff) → multiply", () => {
    const r = applyMultiplier(-2, 1.5, true);
    expect(r.value).toBeCloseTo(-3);
    expect(r.isImprovement).toBe(true);
  });
  test("bodyFatPct gain (lowerIsBetter=true, positive diff) → divide", () => {
    const r = applyMultiplier(2, 1.5, true);
    expect(r.value).toBeCloseTo(1.3333, 3);
    expect(r.isImprovement).toBe(false);
  });
  test("debuff multiplier on gain → multiply (reduces gain)", () => {
    const r = applyMultiplier(1, 0.5, false);
    expect(r.value).toBeCloseTo(0.5);
    expect(r.isImprovement).toBe(true);
  });
  test("debuff multiplier on loss → divide (amplifies loss)", () => {
    const r = applyMultiplier(-1, 0.5, false);
    expect(r.value).toBeCloseTo(-2);
    expect(r.isImprovement).toBe(false);
  });
  test("zero diff → zero, isImprovement false (neutral)", () => {
    const r = applyMultiplier(0, 1.5, false);
    expect(r.value).toBe(0);
    expect(r.isImprovement).toBe(false);
  });
  test("multiplier 1.0 → no change", () => {
    const r = applyMultiplier(5, 1.0, false);
    expect(r.value).toBe(5);
    expect(r.isImprovement).toBe(true);
  });
});
