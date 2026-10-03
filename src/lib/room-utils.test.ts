import { describe, test, expect } from "bun:test";
import {
  isRoomEnded, applyMirrorFilter, applyDateMirrorFilter,
  resolveRankType, computeHasHidden, classifyMember, applyMultiplier,
  metricDiff, diffDecimals,
  competitionRanks, winnerCutoff, zoneOf, rankKey,
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

describe("metricDiff", () => {
  test("bodyFatPct: absolute points (37.5 → 33.4)", () => {
    expect(metricDiff("bodyFatPct", 37.5, 33.4)).toBeCloseTo(-4.1, 3);
  });
  test("bodyFatPct: absolute increase (30.4 → 32.2)", () => {
    expect(metricDiff("bodyFatPct", 30.4, 32.2)).toBeCloseTo(1.8, 3);
  });
  test("bodyFatPct: 30 → 27 is -3 points, not -10%", () => {
    expect(metricDiff("bodyFatPct", 30, 27)).toBeCloseTo(-3, 3);
  });
  test("skeletalMuscle: absolute diff (30 → 31.2)", () => {
    expect(metricDiff("skeletalMuscle", 30, 31.2)).toBeCloseTo(1.2, 3);
  });
  test("inbodyScore: absolute diff (70 → 72)", () => {
    expect(metricDiff("inbodyScore", 70, 72)).toBe(2);
  });
  test("bodyFatPct: first is null → null", () => {
    expect(metricDiff("bodyFatPct", null, 20)).toBeNull();
  });
  test("bodyFatPct: last is null → null", () => {
    expect(metricDiff("bodyFatPct", 20, null)).toBeNull();
  });
});

describe("diffDecimals", () => {
  test("bodyFatPct → 1 (InBody reports 0.1 precision)", () => {
    expect(diffDecimals("bodyFatPct")).toBe(1);
  });
  test("skeletalMuscle → 1", () => {
    expect(diffDecimals("skeletalMuscle")).toBe(1);
  });
  test("inbodyScore → 1", () => {
    expect(diffDecimals("inbodyScore")).toBe(1);
  });
});

describe("competitionRanks", () => {
  test("U1: room 8 real data — ties get same rank, next skips", () => {
    expect(competitionRanks([-4.1, -1.6, -1.1, -0.6, -0.5, -0.5, -0.4, -0.3, 1.8]))
      .toEqual([1, 2, 3, 4, 5, 5, 7, 8, 9]);
  });
  test("U2: all same → all rank 1", () => {
    expect(competitionRanks([1, 1, 1])).toEqual([1, 1, 1]);
  });
  test("U3: empty → empty", () => {
    expect(competitionRanks([])).toEqual([]);
  });
});

describe("winnerCutoff", () => {
  test("U4: floor division", () => {
    expect(winnerCutoff(10)).toBe(5);
    expect(winnerCutoff(9)).toBe(4);
    expect(winnerCutoff(2)).toBe(1);
    expect(winnerCutoff(1)).toBe(0);
    expect(winnerCutoff(0)).toBe(0);
  });
});

describe("zoneOf", () => {
  test("U5: winner/loser boundary", () => {
    expect(zoneOf(5, 10)).toBe("winner");
    expect(zoneOf(6, 10)).toBe("loser");
    expect(zoneOf(5, 9)).toBe("loser");
    expect(zoneOf(4, 9)).toBe("winner");
  });
});

describe("rankKey", () => {
  test("U6: floating point trap — both round to -0.5", () => {
    expect(rankKey(-0.5000000000000036, 1)).toBe(rankKey(-0.4999999999999964, 1));
    expect(rankKey(-0.5000000000000036, 1)).toBe(-0.5);
  });
});
