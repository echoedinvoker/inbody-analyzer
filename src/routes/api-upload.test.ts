import { describe, test, expect, beforeEach, mock } from "bun:test";
import { readdirSync, unlinkSync, existsSync } from "fs";

mock.module("../lib/extract.ts", () => ({
  extractFromPhoto: async (_photoPath: string, _opts?: any) => ({
    data: {
      measured_at: "2026-09-27 12:00",
      weight: 75,
      skeletal_muscle: null, body_fat_mass: null, body_fat_pct: null,
      bmi: null, total_body_water: null, visceral_fat_level: null,
      basal_metabolic_rate: null, inbody_score: null,
      is_inbody: true, device_type: "InBody 270",
      segmental_lean: null, segmental_fat: null,
    },
    rawResponse: '{"weight": 75}',
  }),
}));

import apiReports from "./api-reports.ts";
import { makeTestApp, authHeader, makeUser, resetDb } from "../lib/test-helpers.ts";

const app = makeTestApp(apiReports);
const PHOTO_DIR = "./data/test/photos";

function cleanPhotos() {
  if (existsSync(PHOTO_DIR)) {
    for (const f of readdirSync(PHOTO_DIR)) unlinkSync(`${PHOTO_DIR}/${f}`);
  }
}

beforeEach(() => { resetDb(); cleanPhotos(); });

function makeJpeg(size = 100): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return buf;
}

function makePng(size = 100): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  return buf;
}

function makeHeic(size = 100): Buffer {
  const buf = Buffer.alloc(Math.max(size, 12));
  buf.writeUInt32BE(0x1c, 0);
  buf.write("ftyp", 4, "ascii");
  buf.write("heic", 8, "ascii");
  return buf;
}

async function upload(userId: number, filename: string, content: Buffer) {
  const formData = new FormData();
  formData.append("photo", new File([content], filename, { type: "application/octet-stream" }));
  return app.request("/api/reports/upload", {
    method: "POST", body: formData,
    headers: await authHeader(userId),
  });
}

describe("upload — content sniffing", () => {
  test("file named .jpg but content is PNG → saved as .png", async () => {
    const user = makeUser("test");
    const res = await upload(user.id, "photo.jpg", makePng());
    expect(res.status).toBe(200);
    const saved = readdirSync(PHOTO_DIR).filter(f => f.startsWith(`${user.id}_`));
    expect(saved.length).toBe(1);
    expect(saved[0]).toMatch(/\.png$/);
  });

  test("normal JPEG → saved as .jpg", async () => {
    const user = makeUser("test");
    const res = await upload(user.id, "photo.jpg", makeJpeg());
    expect(res.status).toBe(200);
    const saved = readdirSync(PHOTO_DIR).filter(f => f.startsWith(`${user.id}_`));
    expect(saved[0]).toMatch(/\.jpg$/);
  });

  test("unknown format → 400", async () => {
    const user = makeUser("test");
    const res = await upload(user.id, "photo.jpg", Buffer.alloc(100));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("JPEG");
  });

  test(">5MB → 400", async () => {
    const user = makeUser("test");
    const res = await upload(user.id, "photo.jpg", makeJpeg(5 * 1024 * 1024 + 1));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("5MB");
  });
});

describe("upload — error masking", () => {
  test("AI failure does not expose SDK details", async () => {
    mock.module("../lib/extract.ts", () => ({
      extractFromPhoto: async () => {
        throw new Error("Anthropic API rate limit (request_id: req_abc, credit_balance: $0.05)");
      },
    }));
    const user = makeUser("test3");
    const res = await upload(user.id, "photo.jpg", makeJpeg());
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).not.toContain("request_id");
    expect(body.error).not.toContain("credit_balance");
    expect(body.error).toBe("AI 分析失敗，請再試一次或換一張照片");
  });
});
