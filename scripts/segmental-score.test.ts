import { test, expect, describe } from "bun:test";
import { classifyPair, scoreReading } from "./segmental-score";

describe("classifyPair", () => {
  test("correct when both sides match truth", () => {
    expect(classifyPair({ left: 2.5, right: 2.6 }, { left: 2.5, right: 2.6 })).toBe("correct");
  });

  test("swapped when left and right are exchanged", () => {
    expect(classifyPair({ left: 2.5, right: 2.6 }, { left: 2.6, right: 2.5 })).toBe("swapped");
  });

  test("one-side-copied when left got the right value (or vice versa)", () => {
    expect(classifyPair({ left: 2.5, right: 2.6 }, { left: 2.6, right: 2.6 })).toBe("copied");
    expect(classifyPair({ left: 2.5, right: 2.6 }, { left: 2.5, right: 2.5 })).toBe("copied");
  });

  test("null when either side is missing", () => {
    expect(classifyPair({ left: 2.5, right: 2.6 }, { left: null, right: 2.6 })).toBe("null");
  });

  test("other-wrong for unrelated values", () => {
    expect(classifyPair({ left: 2.5, right: 2.6 }, { left: 3.1, right: 2.6 })).toBe("other");
  });

  test("unmeasurable when truth left == right (a swap would be invisible)", () => {
    expect(classifyPair({ left: 8.8, right: 8.8 }, { left: 8.8, right: 8.8 })).toBe("unmeasurable");
  });
});

describe("scoreReading", () => {
  const truth = {
    lean: { left_arm: 2.5, right_arm: 2.6, trunk: 21.8, left_leg: 8.8, right_leg: 8.8 },
    fat: { left_arm: 25.7, right_arm: 25.0, trunk: 24.7, left_leg: 22.4, right_leg: 22.3 },
  };

  test("returns one entry per measurable pair (arm/leg × lean/fat)", () => {
    const reading = {
      segmental_lean: { left_arm: 2.6, right_arm: 2.5, trunk: 21.8, left_leg: 8.8, right_leg: 8.8 },
      segmental_fat: { left_arm: 25.7, right_arm: 25.0, trunk: 24.7, left_leg: 22.4, right_leg: 22.3 },
    };
    const out = scoreReading(truth, reading);
    expect(out).toEqual([
      { pair: "lean.arm", verdict: "swapped" },
      { pair: "fat.arm", verdict: "correct" },
      { pair: "fat.leg", verdict: "correct" },
    ]);
  });

  test("whole section null counts as null for every measurable pair in it", () => {
    const reading = {
      segmental_lean: null,
      segmental_fat: { left_arm: 25.0, right_arm: 25.7, trunk: 24.7, left_leg: 22.3, right_leg: 22.4 },
    };
    expect(scoreReading(truth, reading)).toEqual([
      { pair: "lean.arm", verdict: "null" },
      { pair: "fat.arm", verdict: "swapped" },
      { pair: "fat.leg", verdict: "swapped" },
    ]);
  });
});
