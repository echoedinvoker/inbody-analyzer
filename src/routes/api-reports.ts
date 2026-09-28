import { Hono } from "hono";
import { eq, desc, and, gte, ne, inArray } from "drizzle-orm";
import { writeFileSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import convert from "heic-convert";
import { stripMetadata } from "../lib/strip-metadata.ts";
import { db, schema } from "../db/index.ts";
import { requireAuth } from "../lib/session.ts";
import { extractFromPhoto, type ExtractedData } from "../lib/extract.ts";
import { sniffImageType } from "../lib/image-sniff.ts";
import { checkBadges } from "../lib/badges.ts";
import { updateStreak } from "../lib/streak.ts";
import { notifyNewUpload } from "../lib/line-notify.ts";

const DATA_DIR = process.env.DATABASE_PATH
  ? process.env.DATABASE_PATH.replace(/\/[^/]+$/, "")
  : "./data";
const PHOTO_DIR = `${DATA_DIR}/photos`;

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
      photoPath: schema.reports.photoPath,
      isInbody: schema.reports.isInbody,
      deviceType: schema.reports.deviceType,
      editedAt: schema.reports.editedAt,
      weight: schema.measurements.weight,
      skeletalMuscle: schema.measurements.skeletalMuscle,
      bodyFatPct: schema.measurements.bodyFatPct,
      inbodyScore: schema.measurements.inbodyScore,
    })
    .from(schema.reports)
    .leftJoin(schema.measurements, eq(schema.measurements.reportId, schema.reports.id))
    .where(eq(schema.reports.userId, user.id))
    .orderBy(desc(schema.reports.measuredAt))
    .all();

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

  return c.json(rows.map((r) => {
    const activeRoomCheck = db
      .select({ id: schema.roomSubmissions.id })
      .from(schema.roomSubmissions)
      .innerJoin(schema.rooms, eq(schema.roomSubmissions.roomId, schema.rooms.id))
      .where(
        and(
          eq(schema.roomSubmissions.reportId, r.id),
          eq(schema.rooms.isActive, true),
          gte(schema.rooms.endDate, today)
        )
      )
      .limit(1)
      .get();

    return {
      ...r,
      photoUrl: r.photoPath ? `/api/photos/${r.photoPath}` : null,
      photoPath: undefined,
      inActiveRoom: !!activeRoomCheck,
    };
  }));
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

  const arrayBuffer = await photo.arrayBuffer();
  const headerBytes = Buffer.from(arrayBuffer.slice(0, 12));
  const sniffed = sniffImageType(headerBytes);

  if (sniffed === "unknown") {
    return c.json({ error: "只支援 JPEG、PNG、HEIC 格式" }, 400);
  }

  const timestamp = Date.now();
  mkdirSync(PHOTO_DIR, { recursive: true });

  const needsConvert = sniffed === "heic";

  let savedFilename: string;
  let photoPath: string;
  let savedMediaType: "image/jpeg" | "image/png" = "image/jpeg";

  if (needsConvert) {
    savedFilename = `${user.id}_${timestamp}.jpg`;
    photoPath = `${PHOTO_DIR}/${savedFilename}`;
    const jpegBuffer = await convert({
      buffer: Buffer.from(arrayBuffer),
      format: "JPEG",
      quality: 0.9,
    });
    writeFileSync(photoPath, stripMetadata(Buffer.from(jpegBuffer), "jpeg"));
  } else {
    const saveExt = sniffed === "png" ? "png" : "jpg";
    savedMediaType = sniffed === "png" ? "image/png" : "image/jpeg";
    savedFilename = `${user.id}_${timestamp}.${saveExt}`;
    photoPath = `${PHOTO_DIR}/${savedFilename}`;
    writeFileSync(photoPath, stripMetadata(Buffer.from(arrayBuffer), sniffed === "png" ? "png" : "jpeg"));
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
    const { data, rawResponse } = await extractFromPhoto(photoPath, { mediaType: savedMediaType });

    db.update(schema.reports)
      .set({
        rawJson: rawResponse,
        measuredAt: data.measured_at || report.measuredAt,
        isInbody: data.is_inbody ?? null,
        deviceType: data.device_type ?? null,
      })
      .where(eq(schema.reports.id, report.id))
      .run();

    return c.json({
      reportId: report.id,
      extractedData: data,
    });
  } catch (error: any) {
    console.error("AI extraction failed:", error.message);
    return c.json({ error: "AI 分析失敗，請再試一次或換一張照片" }, 500);
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
    editedAt: report.editedAt,
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

// Editable measurement fields: request key (snake_case, same as confirm) → measurements column
const EDITABLE_FIELDS = {
  weight: "weight",
  skeletal_muscle: "skeletalMuscle",
  body_fat_mass: "bodyFatMass",
  body_fat_pct: "bodyFatPct",
  bmi: "bmi",
  total_body_water: "totalBodyWater",
  visceral_fat_level: "visceralFatLevel",
  basal_metabolic_rate: "basalMetabolicRate",
  inbody_score: "inbodyScore",
} as const;

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}

// A submitted report's new date must still pass the rules it passed at submission:
// inside the room period, same order among the user's submissions, interval kept.
function checkDateAgainstSubmissions(reportId: number, userId: number, oldDate: string, newDate: string): string | null {
  const subs = db
    .select({ roomId: schema.roomSubmissions.roomId, room: schema.rooms })
    .from(schema.roomSubmissions)
    .innerJoin(schema.rooms, eq(schema.roomSubmissions.roomId, schema.rooms.id))
    .where(eq(schema.roomSubmissions.reportId, reportId))
    .all();

  for (const { roomId, room } of subs) {
    if (newDate < room.startDate || newDate > room.endDate) {
      return `此報告已提交到「${room.name}」，日期必須在賽程 ${room.startDate} ~ ${room.endDate} 內`;
    }
    const siblings = db
      .select({ measuredAt: schema.reports.measuredAt })
      .from(schema.roomSubmissions)
      .innerJoin(schema.reports, eq(schema.roomSubmissions.reportId, schema.reports.id))
      .where(and(
        eq(schema.roomSubmissions.roomId, roomId),
        eq(schema.roomSubmissions.userId, userId),
        ne(schema.roomSubmissions.reportId, reportId),
      ))
      .all()
      .map((r) => r.measuredAt.slice(0, 10));
    const prev = siblings.filter((d) => d < oldDate).sort().at(-1);
    const next = siblings.filter((d) => d > oldDate).sort()[0];
    if ((prev && newDate <= prev) || (next && newDate >= next)) {
      return `此報告已提交到「${room.name}」，改日期不能跨過你在該房間的其他筆數據`;
    }
    const interval = room.measurementInterval;
    if (interval) {
      for (const d of [prev, next]) {
        if (d && Math.abs(daysBetween(d, newDate)) < interval) {
          return `與 ${d} 的數據衝突，兩筆數據間需間隔至少 ${interval} 天`;
        }
      }
    }
  }
  return null;
}

// PATCH /api/reports/:id — uploader edits a confirmed report (numbers + measured date)
apiReports.patch("/api/reports/:id", async (c) => {
  const user = requireAuth(c);
  const reportId = Number(c.req.param("id"));

  const report = db.select().from(schema.reports).where(eq(schema.reports.id, reportId)).get();
  if (!report || report.userId !== user.id) {
    return c.json({ error: "Report not found" }, 404);
  }
  if (!report.confirmed) {
    return c.json({ error: "報告尚未確認，請先完成確認" }, 400);
  }
  const measurement = db.select().from(schema.measurements)
    .where(eq(schema.measurements.reportId, reportId)).get();
  if (!measurement) return c.json({ error: "Report not found" }, 404);

  const body = (await c.req.json()) as Record<string, unknown>;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const measurementPatch: Record<string, number | null> = {};

  for (const [key, column] of Object.entries(EDITABLE_FIELDS)) {
    if (!(key in body)) continue;
    const raw = body[key];
    let value: number | null = null;
    if (raw !== null && raw !== "") {
      value = Number(raw);
      if (!Number.isFinite(value)) return c.json({ error: `${key} 不是有效數字` }, 400);
    }
    const current = (measurement as any)[column] as number | null;
    if (value !== current) {
      before[key] = current;
      after[key] = value;
      measurementPatch[column] = value;
    }
  }

  let newDate: string | null = null;
  if ("measured_at" in body) {
    const d = String(body.measured_at ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) {
      return c.json({ error: "量測日期格式錯誤" }, 400);
    }
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
    if (d > today) return c.json({ error: "量測日期不能在未來" }, 400);
    if (d !== report.measuredAt.slice(0, 10)) {
      const conflict = checkDateAgainstSubmissions(reportId, user.id, report.measuredAt.slice(0, 10), d);
      if (conflict) return c.json({ error: conflict }, 400);
      newDate = d;
      before.measured_at = report.measuredAt;
      after.measured_at = d;
    }
  }

  if (Object.keys(after).length === 0) {
    return c.json({ ok: true, changed: [] });
  }

  const editedAt = new Date().toISOString();
  db.transaction((tx) => {
    if (Object.keys(measurementPatch).length > 0) {
      tx.update(schema.measurements).set(measurementPatch)
        .where(eq(schema.measurements.id, measurement.id)).run();
    }
    tx.update(schema.reports)
      .set({ editedAt, ...(newDate ? { measuredAt: newDate } : {}) })
      .where(eq(schema.reports.id, reportId)).run();
    tx.insert(schema.reportEdits).values({
      reportId,
      userId: user.id,
      beforeJson: JSON.stringify(before),
      afterJson: JSON.stringify(after),
      editedAt,
    }).run();
    // AI caches are keyed on the latest report/submission id, which an edit doesn't change.
    // Personal advice/narrative read all recent reports regardless of rooms ⇒ always refresh.
    tx.delete(schema.adviceCache).where(eq(schema.adviceCache.userId, user.id)).run();
    tx.delete(schema.narrativeCache).where(eq(schema.narrativeCache.userId, user.id)).run();
    // Room coach reads only the reports submitted to that room ⇒ refresh only those rooms
    const roomIds = tx.select({ roomId: schema.roomSubmissions.roomId })
      .from(schema.roomSubmissions)
      .where(eq(schema.roomSubmissions.reportId, reportId))
      .all()
      .map((r) => r.roomId);
    if (roomIds.length > 0) {
      tx.delete(schema.roomAdviceCache).where(and(
        eq(schema.roomAdviceCache.userId, user.id),
        inArray(schema.roomAdviceCache.roomId, roomIds),
      )).run();
    }
  });

  return c.json({ ok: true, changed: Object.keys(after), editedAt });
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

  // Check if submitted to any active room
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const activeRoomCheck = db
    .select({ id: schema.roomSubmissions.id })
    .from(schema.roomSubmissions)
    .innerJoin(schema.rooms, eq(schema.roomSubmissions.roomId, schema.rooms.id))
    .where(
      and(
        eq(schema.roomSubmissions.reportId, reportId),
        eq(schema.rooms.isActive, true),
        gte(schema.rooms.endDate, today)
      )
    )
    .limit(1)
    .get();

  if (activeRoomCheck) {
    return c.json({ error: "此報告已提交到進行中的房間，無法刪除。賽程結束後可刪除。" }, 400);
  }

  db.delete(schema.reportEdits)
    .where(eq(schema.reportEdits.reportId, reportId))
    .run();

  // Delete rejection audit records referencing this report (FK constraint)
  db.delete(schema.roomSubmissionRejections)
    .where(eq(schema.roomSubmissionRejections.reportId, reportId))
    .run();

  // Delete measurement first (foreign key)
  db.delete(schema.measurements)
    .where(eq(schema.measurements.reportId, reportId))
    .run();

  // Delete photo file
  if (report.photoPath) {
    try {
      unlinkSync(`${PHOTO_DIR}/${report.photoPath}`);
    } catch {}
  }

  // Delete report
  db.delete(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .run();

  return c.json({ ok: true });
});

// GET /api/photos/:filename — serve photo with JWT auth
apiReports.get("/api/photos/:filename", (c) => {
  const user = requireAuth(c);
  const filename = c.req.param("filename");

  if (filename.includes("..") || filename.includes("/")) {
    return c.json({ error: "Bad request" }, 400);
  }

  // Verify the photo belongs to this user
  const report = db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.photoPath, filename))
    .get();

  if (!report) {
    return c.json({ error: "Not found" }, 404);
  }

  if (report.userId !== user.id) {
    const ownerAccess = db.select({ id: schema.roomSubmissions.id })
      .from(schema.roomSubmissions)
      .innerJoin(schema.rooms, eq(schema.roomSubmissions.roomId, schema.rooms.id))
      .where(and(
        eq(schema.roomSubmissions.reportId, report.id),
        eq(schema.rooms.ownerId, user.id),
        eq(schema.rooms.isActive, true)
      ))
      .limit(1)
      .get();

    if (!ownerAccess) {
      return c.json({ error: "Not found" }, 404);
    }
  }

  try {
    const buffer = readFileSync(`${PHOTO_DIR}/${filename}`);
    const contentType = filename.endsWith(".png") ? "image/png" : "image/jpeg";
    return new Response(buffer, {
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

export default apiReports;
