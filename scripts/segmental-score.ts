// Scores segmental (per-limb) OCR readings against a human-confirmed truth table,
// focusing on left/right swaps. Used by scripts/segmental-bench.ts.

export type Side = { left: number | null; right: number | null };
export type Verdict = "correct" | "swapped" | "copied" | "null" | "other" | "unmeasurable";

type Limbs = {
  left_arm: number | null;
  right_arm: number | null;
  trunk: number | null;
  left_leg: number | null;
  right_leg: number | null;
};

export type TruthEntry = { lean: Limbs; fat: Limbs };
export type Reading = { segmental_lean: Limbs | null; segmental_fat: Limbs | null };

const eq = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) < 1e-9;

export function classifyPair(truth: Side, read: Side): Verdict {
  if (eq(truth.left, truth.right)) return "unmeasurable";
  if (read.left === null || read.right === null) return "null";
  if (eq(read.left, truth.left) && eq(read.right, truth.right)) return "correct";
  if (eq(read.left, truth.right) && eq(read.right, truth.left)) return "swapped";
  if (eq(read.left, read.right) && (eq(read.left, truth.left) || eq(read.left, truth.right))) return "copied";
  return "other";
}

export function scoreReading(truth: TruthEntry, reading: Reading): { pair: string; verdict: Verdict }[] {
  const out: { pair: string; verdict: Verdict }[] = [];
  for (const section of ["lean", "fat"] as const) {
    const read = section === "lean" ? reading.segmental_lean : reading.segmental_fat;
    for (const limb of ["arm", "leg"] as const) {
      const t: Side = { left: truth[section][`left_${limb}`], right: truth[section][`right_${limb}`] };
      const r: Side = read
        ? { left: read[`left_${limb}`] ?? null, right: read[`right_${limb}`] ?? null }
        : { left: null, right: null };
      const verdict = classifyPair(t, r);
      if (verdict !== "unmeasurable") out.push({ pair: `${section}.${limb}`, verdict });
    }
  }
  return out;
}
