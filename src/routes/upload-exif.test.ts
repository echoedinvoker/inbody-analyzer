import { describe, test, expect, beforeEach, mock } from "bun:test";
import { readdirSync, readFileSync, unlinkSync, existsSync } from "fs";

mock.module("../lib/extract.ts", () => ({
  extractFromPhoto: async () => ({
    data: {
      measured_at: "2026-09-27 12:00", weight: 75,
      skeletal_muscle: null, body_fat_mass: null, body_fat_pct: null,
      bmi: null, total_body_water: null, visceral_fat_level: null,
      basal_metabolic_rate: null, inbody_score: null,
      is_inbody: true, device_type: "InBody 270",
      segmental_lean: null, segmental_fat: null,
    },
    rawResponse: '{"weight": 75}',
  }),
}));

import { Hono } from "hono";
import apiReports from "./api-reports.ts";
import reports from "./reports.tsx";
import { makeTestApp, authHeader, makeUser, resetDb } from "../lib/test-helpers.ts";

// Every path that writes into /data/photos must drop GPS:
// new API (JPEG / PNG / HEIC→JPEG) and the legacy SSR upload page (same three).
const router = new Hono();
router.route("/", apiReports);
router.route("/", reports);
const app = makeTestApp(router);

const PHOTO_DIR = "./data/test/photos";
const FIX = `${import.meta.dir}/../test-fixtures`;

function rationalBytes(le: boolean) {
  const b = Buffer.alloc(24);
  [12, 1, 34, 1, 56, 1].forEach((v, i) => (le ? b.writeUInt32LE(v, i * 4) : b.writeUInt32BE(v, i * 4)));
  return b;
}
const hasFakeLatitude = (buf: Buffer) =>
  buf.includes(rationalBytes(true)) || buf.includes(rationalBytes(false));

function cleanPhotos() {
  if (existsSync(PHOTO_DIR)) for (const f of readdirSync(PHOTO_DIR)) unlinkSync(`${PHOTO_DIR}/${f}`);
}
beforeEach(() => { resetDb(); cleanPhotos(); });

async function post(path: string, userId: number, fixture: string, sendAs: string) {
  const fd = new FormData();
  fd.append("photo", new File([readFileSync(`${FIX}/${fixture}`)], sendAs, { type: "application/octet-stream" }));
  return app.request(path, { method: "POST", body: fd, headers: await authHeader(userId) });
}

function savedFile(userId: number) {
  const saved = readdirSync(PHOTO_DIR).filter((f) => f.startsWith(`${userId}_`));
  expect(saved.length).toBe(1);
  return readFileSync(`${PHOTO_DIR}/${saved[0]}`);
}

const cases: [string, string, string][] = [
  ["JPEG", "gps.jpg", "IMG_0001.jpg"],
  ["PNG", "gps.png", "IMG_0001.png"],
  ["HEIC", "gps.heic", "IMG_0001.HEIC"],
];

for (const [route, path] of [["API /api/reports/upload", "/api/reports/upload"], ["SSR /upload", "/upload"]]) {
  describe(`${route} strips GPS before saving`, () => {
    for (const [kind, fixture, sendAs] of cases) {
      test(kind, async () => {
        expect(hasFakeLatitude(readFileSync(`${FIX}/${fixture}`))).toBe(true);
        const user = makeUser(`exif-${kind}`);
        const res = await post(path, user.id, fixture, sendAs);
        expect(res.status).toBeLessThan(400);
        const saved = savedFile(user.id);
        expect(saved.length).toBeGreaterThan(0);
        expect(hasFakeLatitude(saved)).toBe(false);
        expect(saved.includes(Buffer.from("SyntheticCam"))).toBe(false);
      });
    }
  });
}
