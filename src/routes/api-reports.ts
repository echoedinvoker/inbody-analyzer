import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { writeFileSync, mkdirSync } from "fs";
import convert from "heic-convert";
import { db, schema } from "../db/index.ts";
import { requireAuth } from "../lib/session.ts";
import { extractFromPhoto, type ExtractedData } from "../lib/extract.ts";
import { checkBadges } from "../lib/badges.ts";
import { updateStreak } from "../lib/streak.ts";
import { notifyNewUpload } from "../lib/line-notify.ts";

const DATA_DIR = process.env.DATABASE_PATH
  ? process.env.DATABASE_PATH.replace(/\/[^/]+$/, "")
  : "./data";
const PHOTO_DIR = `${DATA_DIR}/photos`;

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
];

const apiReports = new Hono();

// GET /api/reports — list my reports
apiReports.get("/api/reports", (c) => {
  const user = requireAuth(c);

  const rows = db
    .select({
      id: schema.reports.id,
      measuredAt: schema.reports.measuredAt,
      confirmed: schema.reports.confirmed,
      createdAt: schema.reports.createdAt,
      weight: schema.measurements.weight,
      skeletalMuscle: schema.measurements.skeletalMuscle,
      bodyFatPct: schema.measurements.bodyFatPct,
    })
    .from(schema.reports)
    .leftJoin(schema.measurements, eq(schema.measurements.reportId, schema.reports.id))
    .where(eq(schema.reports.userId, user.id))
    .orderBy(desc(schema.reports.measuredAt))
    .all();

  return c.json(rows);
});

// POST /api/reports/upload — upload photo, AI extract
apiReports.post("/api/reports/upload", async (c) => {
  const user = requireAuth(c);

  const body = await c.req.parseBody();
  const photo = body.photo;

  if (!(photo instanceof File)) {
    return c.json({ error: "請選擇照片檔案" }, 400);
  }

  if (photo.size > 5 * 1024 * 1024) {
    return c.json({ error: "照片太大，請控制在 5MB 以內" }, 400);
  }

  const fileName = (photo.name || "").toLowerCase();
  const ext = fileName.slice(fileName.lastIndexOf("."));
  const acceptedExts = [".jpg", ".jpeg", ".png", ".heic", ".heif"];
  const isAccepted =
    ACCEPTED_TYPES.includes(photo.type) || acceptedExts.includes(ext);

  if (!isAccepted) {
    return c.json({ error: "只支援 JPEG、PNG、HEIC 格式" }, 400);
  }

  // Save photo (convert HEIC to JPEG)
  const timestamp = Date.now();
  const arrayBuffer = await photo.arrayBuffer();
  mkdirSync(PHOTO_DIR, { recursive: true });

  const needsConvert = [".heic", ".heif"].includes(ext);

  let savedFilename: string;
  let photoPath: string;

  if (needsConvert) {
    savedFilename = `${user.id}_${timestamp}.jpg`;
    photoPath = `${PHOTO_DIR}/${savedFilename}`;
    const jpegBuffer = await convert({
      buffer: Buffer.from(arrayBuffer),
      format: "JPEG",
      quality: 0.9,
    });
    writeFileSync(photoPath, Buffer.from(jpegBuffer));
  } else {
    const saveExt = photo.type === "image/png" ? "png" : "jpg";
    savedFilename = `${user.id}_${timestamp}.${saveExt}`;
    photoPath = `${PHOTO_DIR}/${savedFilename}`;
    writeFileSync(photoPath, Buffer.from(arrayBuffer));
  }

  // Create report record
  const report = db
    .insert(schema.reports)
    .values({
      userId: user.id,
      measuredAt: new Date().toISOString().slice(0, 16),
      photoPath: savedFilename,
      confirmed: false,
    })
    .returning()
    .get();

  // Extract data with AI
  try {
    const { data, rawResponse } = await extractFromPhoto(photoPath);

    db.update(schema.reports)
      .set({
        rawJson: rawResponse,
        measuredAt: data.measured_at || report.measuredAt,
      })
      .where(eq(schema.reports.id, report.id))
      .run();

    return c.json({
      reportId: report.id,
      extractedData: data,
    });
  } catch (error: any) {
    return c.json({ error: `AI 分析失敗：${error.message}` }, 500);
  }
});

// GET /api/reports/:id — single report details
apiReports.get("/api/reports/:id", (c) => {
  const user = requireAuth(c);
  const reportId = Number(c.req.param("id"));

  const report = db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .get();

  if (!report || report.userId !== user.id) {
    return c.json({ error: "Report not found" }, 404);
  }

  // Get measurement if confirmed
  const measurement = db
    .select()
    .from(schema.measurements)
    .where(eq(schema.measurements.reportId, reportId))
    .get();

  // Parse raw JSON for unconfirmed reports (AI extracted data)
  let extractedData: any = null;
  if (!report.confirmed && report.rawJson) {
    try {
      extractedData = JSON.parse(report.rawJson);
    } catch {}
  }

  return c.json({
    id: report.id,
    measuredAt: report.measuredAt,
    confirmed: report.confirmed,
    extractedData,
    measurement: measurement
      ? {
          weight: measurement.weight,
          skeletalMuscle: measurement.skeletalMuscle,
          bodyFatMass: measurement.bodyFatMass,
          bodyFatPct: measurement.bodyFatPct,
          bmi: measurement.bmi,
          totalBodyWater: measurement.totalBodyWater,
          visceralFatLevel: measurement.visceralFatLevel,
          basalMetabolicRate: measurement.basalMetabolicRate,
          inbodyScore: measurement.inbodyScore,
        }
      : null,
  });
});

// POST /api/reports/:id/confirm — confirm extracted data
apiReports.post("/api/reports/:id/confirm", async (c) => {
  const user = requireAuth(c);
  const reportId = Number(c.req.param("id"));

  const report = db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .get();

  if (!report || report.userId !== user.id) {
    return c.json({ error: "Report not found" }, 404);
  }

  if (report.confirmed) {
    return c.json({ error: "Already confirmed" }, 400);
  }

  const body = await c.req.json();

  const num = (key: string) => {
    const v = (body as any)[key];
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };

  // Update measured_at on report
  const measuredAt = body.measured_at || report.measuredAt;
  db.update(schema.reports)
    .set({ measuredAt, confirmed: true })
    .where(eq(schema.reports.id, reportId))
    .run();

  // Insert measurement
  db.insert(schema.measurements)
    .values({
      reportId,
      weight: num("weight"),
      skeletalMuscle: num("skeletal_muscle"),
      bodyFatMass: num("body_fat_mass"),
      bodyFatPct: num("body_fat_pct"),
      bmi: num("bmi"),
      totalBodyWater: num("total_body_water"),
      visceralFatLevel: num("visceral_fat_level"),
      basalMetabolicRate: num("basal_metabolic_rate"),
      inbodyScore: num("inbody_score"),
    })
    .run();

  // Update streak + badges (synchronous for immediate response)
  const streakResult = updateStreak(user.id);
  const newBadges = checkBadges(user.id);

  // Notify LINE group (fire and forget)
  notifyNewUpload(user.id, user.name).catch((e) =>
    console.error("LINE notify failed:", e.message)
  );

  return c.json({
    ok: true,
    streak: {
      current: streakResult.currentStreak,
      best: streakResult.bestStreak,
      isNew: streakResult.isNew,
    },
    newBadges: newBadges.map((b) => ({
      type: b.badgeType,
      label: b.badgeLabel,
    })),
  });
});

// DELETE /api/reports/:id — delete a report
apiReports.delete("/api/reports/:id", (c) => {
  const user = requireAuth(c);
  const reportId = Number(c.req.param("id"));

  const report = db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .get();

  if (!report || report.userId !== user.id) {
    return c.json({ error: "Report not found" }, 404);
  }

  // Delete measurement first (foreign key)
  db.delete(schema.measurements)
    .where(eq(schema.measurements.reportId, reportId))
    .run();

  // Delete report
  db.delete(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .run();

  return c.json({ ok: true });
});

export default apiReports;
