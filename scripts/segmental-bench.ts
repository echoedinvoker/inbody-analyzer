// Left/right swap bench for segmental readings.
// Usage: bun scripts/segmental-bench.ts <label>      (runs API, writes data/ocr-bench/segmental-<label>.json)
//        bun scripts/segmental-bench.ts --score <label>  (scores an existing run against segmental-truth.json)
// Images: data/ocr-bench/thumb-2576/*.jpg (what production sends today) + data/ocr-bench/small/*.JPG.
// temperature 0, 3 runs each. Never commit data/ (health data, gitignored).
import { extractFromPhoto } from "../src/lib/extract";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, basename, extname } from "path";
import { scoreReading, type TruthEntry, type Reading } from "./segmental-score";

const DATA_DIR = join(import.meta.dir, "../data/ocr-bench");
const DIRS = [join(DATA_DIR, "thumb-2576"), join(DATA_DIR, "small")];
const RUNS = 3;
const COST_LIMIT_USD = Number(process.env.COST_LIMIT_USD ?? "0.6");
const cost = (u: { input_tokens: number; output_tokens: number }) =>
  (u.input_tokens * 3 + u.output_tokens * 15) / 1_000_000;

type Run = { image: string; run: number; reading: Reading | null; full?: Record<string, unknown>; error?: string; costUsd: number };

async function runBench(label: string) {
  const runs: Run[] = [];
  let total = 0;
  for (const dir of DIRS) {
    for (const f of readdirSync(dir).filter((x) => /\.jpe?g$/i.test(x)).sort()) {
      const image = basename(f, extname(f));
      for (let run = 1; run <= RUNS; run++) {
        if (total >= COST_LIMIT_USD) {
          console.error(`COST LIMIT $${COST_LIMIT_USD} reached at $${total.toFixed(4)}`);
          writeFileSync(join(DATA_DIR, `segmental-${label}.json`), JSON.stringify({ runs, total, aborted: true }, null, 2));
          process.exit(1);
        }
        try {
          const { data, usage } = await extractFromPhoto(join(dir, f), { temperature: 0 });
          const c = usage ? cost(usage) : 0;
          total += c;
          runs.push({ image, run, reading: { segmental_lean: data.segmental_lean, segmental_fat: data.segmental_fat }, full: data as unknown as Record<string, unknown>, costUsd: c });
          console.log(`${image} run${run} ok ($${total.toFixed(4)})`);
        } catch (e) {
          runs.push({ image, run, reading: null, error: String(e), costUsd: 0 });
          console.error(`${image} run${run} FAILED`);
        }
      }
    }
  }
  writeFileSync(join(DATA_DIR, `segmental-${label}.json`), JSON.stringify({ runs, total, aborted: false }, null, 2));
  console.log(`done: ${runs.length} calls, $${total.toFixed(4)}`);
}

function score(label: string) {
  const truthPath = join(DATA_DIR, "segmental-truth.json");
  const truth = JSON.parse(readFileSync(truthPath, "utf8")) as Record<string, TruthEntry>;
  const { runs } = JSON.parse(readFileSync(join(DATA_DIR, `segmental-${label}.json`), "utf8")) as { runs: Run[] };
  const tally: Record<string, number> = {};
  const perImage: Record<string, Record<string, number>> = {};
  for (const r of runs) {
    const t = truth[r.image];
    if (!t) continue;
    const verdicts = r.reading ? scoreReading(t, r.reading) : [];
    for (const v of verdicts) {
      tally[v.verdict] = (tally[v.verdict] ?? 0) + 1;
      (perImage[r.image] ??= {})[v.verdict] = (perImage[r.image][v.verdict] ?? 0) + 1;
    }
  }
  const n = Object.values(tally).reduce((a, b) => a + b, 0);
  console.log(`label=${label} measurable pair-readings=${n}`);
  console.log(`tally ${JSON.stringify(tally)}  swap rate=${((tally.swapped ?? 0) / n * 100).toFixed(1)}%`);
  for (const [img, t] of Object.entries(perImage)) console.log(`  ${img} ${JSON.stringify(t)}`);
}

const [a, b] = process.argv.slice(2);
if (a === "--score") score(b);
else if (a) await runBench(a);
else console.error("usage: bun scripts/segmental-bench.ts <label> | --score <label>");
