import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import convert from "heic-convert";
import { db, schema } from "../db/index.ts";
import { requireAuth, type SessionUser } from "../lib/session.ts";
import { extractFromPhoto, type ExtractedData } from "../lib/extract.ts";
import { checkBadges } from "../lib/badges.ts";
import { Layout } from "../views/layout.tsx";

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

const reports = new Hono();

// Upload page
reports.get("/upload", (c) => {
  const user = c.get("user") as SessionUser | null;
  if (!user) return c.redirect("/login");

  return c.html(
    <Layout title="上傳報告" user={user}>
      <h2>上傳 InBody 報告</h2>
      <form
        method="post"
        action="/upload"
        enctype="multipart/form-data"
      >
        <label>
          選擇照片（JPEG、PNG、HEIC，最大 5MB）
          <input type="file" name="photo" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif" required />
        </label>
        <button type="submit">上傳並分析</button>
      </form>
    </Layout>
  );
});

// Upload handler
reports.post("/upload", async (c) => {
  const user = requireAuth(c);
  const body = await c.req.parseBody();
  const photo = body.photo;

  if (!(photo instanceof File)) {
    return c.html(
      <Layout title="錯誤" user={user}>
        <div class="flash flash-error">請選擇照片檔案</div>
        <a href="/upload">重新上傳</a>
      </Layout>,
      400
    );
  }

  // Validate size (5MB)
  if (photo.size > 5 * 1024 * 1024) {
    return c.html(
      <Layout title="錯誤" user={user}>
        <div class="flash flash-error">照片太大，請控制在 5MB 以內</div>
        <a href="/upload">重新上傳</a>
      </Layout>,
      400
    );
  }

  // Validate type
  // Browsers send HEIC as various MIME types: image/heic, image/heif,
  // application/octet-stream, or even empty string. Use filename as primary check.
  const fileName = (photo.name || "").toLowerCase();
  const ext = fileName.slice(fileName.lastIndexOf("."));
  const acceptedExts = [".jpg", ".jpeg", ".png", ".heic", ".heif"];
  const isAccepted =
    ACCEPTED_TYPES.includes(photo.type) || acceptedExts.includes(ext);

  if (!isAccepted) {
    return c.html(
      <Layout title="錯誤" user={user}>
        <div class="flash flash-error">
          只支援 JPEG、PNG、HEIC 格式（收到：type={photo.type || "empty"}, name={photo.name || "empty"}）
        </div>
        <a href="/upload">重新上傳</a>
      </Layout>,
      400
    );
  }

  // Save photo (convert HEIC to JPEG)
  const timestamp = Date.now();
  const arrayBuffer = await photo.arrayBuffer();
  const photoDir = PHOTO_DIR;
  mkdirSync(photoDir, { recursive: true });

  const needsConvert = [".heic", ".heif"].includes(ext);

  let filename: string;
  let photoPath: string;

  if (needsConvert) {
    // Convert HEIC/HEIF → JPEG via heic-convert (pure JS, no native deps)
    filename = `${user.id}_${timestamp}.jpg`;
    photoPath = `${photoDir}/${filename}`;
    const jpegBuffer = await convert({
      buffer: Buffer.from(arrayBuffer),
      format: "JPEG",
      quality: 0.9,
    });
    writeFileSync(photoPath, Buffer.from(jpegBuffer));
  } else {
    const ext = photo.type === "image/png" ? "png" : "jpg";
    filename = `${user.id}_${timestamp}.${ext}`;
    photoPath = `${photoDir}/${filename}`;
    writeFileSync(photoPath, Buffer.from(arrayBuffer));
  }

  // Create report record
  const result = db
    .insert(schema.reports)
    .values({
      userId: user.id,
      measuredAt: new Date().toISOString().slice(0, 16), // placeholder, AI will extract real date
      photoPath: filename,
      confirmed: false,
    })
    .returning()
    .get();

  // Extract data with AI
  try {
    const { data, rawResponse } = await extractFromPhoto(photoPath);

    // Update report with raw JSON and measured_at from AI
    db.update(schema.reports)
      .set({
        rawJson: rawResponse,
        measuredAt: data.measured_at || result.measuredAt,
      })
      .where(eq(schema.reports.id, result.id))
      .run();

    // Store extracted data temporarily in report's rawJson for the confirm page
    return c.redirect(`/report/${result.id}/confirm`);
  } catch (error: any) {
    return c.html(
      <Layout title="分析失敗" user={user}>
        <div class="flash flash-error">
          AI 分析失敗：{error.message}
        </div>
        <p>你可以重新上傳，或聯繫管理員。</p>
        <a href="/upload">重新上傳</a>
      </Layout>,
      500
    );
  }
});

// Confirm page - show extracted data for correction
reports.get("/report/:id/confirm", (c) => {
  const user = requireAuth(c);
  const reportId = Number(c.req.param("id"));

  const report = db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .get();

  if (!report || report.userId !== user.id) {
    return c.redirect("/dashboard");
  }

  // Parse extracted data from rawJson
  let data: ExtractedData | null = null;
  if (report.rawJson) {
    try {
      const jsonMatch = report.rawJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) data = JSON.parse(jsonMatch[0]);
    } catch {}
  }

  if (!data) {
    return c.html(
      <Layout title="錯誤" user={user}>
        <div class="flash flash-error">無法讀取提取結果</div>
        <a href="/upload">重新上傳</a>
      </Layout>
    );
  }

  return c.html(
    <Layout title="確認數據" user={user}>
      <h2>確認 InBody 數據</h2>
      <p>請核對以下 AI 提取的數據，如有錯誤可直接修改，確認後儲存。</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;">
        {/* Left: photo */}
        <div>
          <img
            src={`/photos/${report.photoPath}`}
            alt="InBody 報告"
            style="max-width:100%;border-radius:8px;"
          />
        </div>

        {/* Right: editable form */}
        <div>
          <form method="post" action={`/report/${reportId}/confirm`}>
            <label>
              測量日期時間
              <input
                type="text"
                name="measured_at"
                value={data.measured_at || report.measuredAt}
                placeholder="YYYY-MM-DD HH:mm"
              />
            </label>

            <fieldset>
              <legend>基本指標</legend>
              <NumField label="體重 (kg)" name="weight" value={data.weight} />
              <NumField
                label="骨骼肌重 (kg)"
                name="skeletal_muscle"
                value={data.skeletal_muscle}
              />
              <NumField
                label="體脂肪重 (kg)"
                name="body_fat_mass"
                value={data.body_fat_mass}
              />
              <NumField
                label="體脂率 (%)"
                name="body_fat_pct"
                value={data.body_fat_pct}
              />
              <NumField label="BMI" name="bmi" value={data.bmi} />
              <NumField
                label="總體水分 (L)"
                name="total_body_water"
                value={data.total_body_water}
              />
            </fieldset>

            <fieldset>
              <legend>進階指標</legend>
              <NumField
                label="內臟脂肪等級"
                name="visceral_fat_level"
                value={data.visceral_fat_level}
              />
              <NumField
                label="基礎代謝率 (kcal)"
                name="basal_metabolic_rate"
                value={data.basal_metabolic_rate}
              />
              <NumField
                label="InBody 分數"
                name="inbody_score"
                value={data.inbody_score}
              />
            </fieldset>

            {data.segmental_lean && (
              <fieldset>
                <legend>節段肌肉 (kg)</legend>
                <NumField
                  label="右臂"
                  name="seg_lean_right_arm"
                  value={data.segmental_lean.right_arm}
                />
                <NumField
                  label="左臂"
                  name="seg_lean_left_arm"
                  value={data.segmental_lean.left_arm}
                />
                <NumField
                  label="軀幹"
                  name="seg_lean_trunk"
                  value={data.segmental_lean.trunk}
                />
                <NumField
                  label="右腿"
                  name="seg_lean_right_leg"
                  value={data.segmental_lean.right_leg}
                />
                <NumField
                  label="左腿"
                  name="seg_lean_left_leg"
                  value={data.segmental_lean.left_leg}
                />
              </fieldset>
            )}

            {data.segmental_fat && (
              <fieldset>
                <legend>節段脂肪 (%)</legend>
                <NumField
                  label="右臂"
                  name="seg_fat_right_arm"
                  value={data.segmental_fat.right_arm}
                />
                <NumField
                  label="左臂"
                  name="seg_fat_left_arm"
                  value={data.segmental_fat.left_arm}
                />
                <NumField
                  label="軀幹"
                  name="seg_fat_trunk"
                  value={data.segmental_fat.trunk}
                />
                <NumField
                  label="右腿"
                  name="seg_fat_right_leg"
                  value={data.segmental_fat.right_leg}
                />
                <NumField
                  label="左腿"
                  name="seg_fat_left_leg"
                  value={data.segmental_fat.left_leg}
                />
              </fieldset>
            )}

            <button type="submit">確認儲存</button>
          </form>
        </div>
      </div>
    </Layout>
  );
});

// Confirm handler - save corrected data
reports.post("/report/:id/confirm", async (c) => {
  const user = requireAuth(c);
  const reportId = Number(c.req.param("id"));

  const report = db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .get();

  if (!report || report.userId !== user.id) {
    return c.redirect("/dashboard");
  }

  const body = await c.req.parseBody();

  const num = (key: string) => {
    const v = body[key];
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };

  // Build segmental JSON if any field is present
  const hasSegLean = ["seg_lean_right_arm", "seg_lean_left_arm", "seg_lean_trunk", "seg_lean_right_leg", "seg_lean_left_leg"].some(k => body[k]);
  const hasSegFat = ["seg_fat_right_arm", "seg_fat_left_arm", "seg_fat_trunk", "seg_fat_right_leg", "seg_fat_left_leg"].some(k => body[k]);

  // Update measured_at on report
  const measuredAt = String(body.measured_at || report.measuredAt);
  db.update(schema.reports)
    .set({ measuredAt, confirmed: true })
    .where(eq(schema.reports.id, reportId))
    .run();

  // Auto-set competition dates on first confirmed report
  const userRecord = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
  if (userRecord && !userRecord.competitionStart) {
    const start = new Date(measuredAt);
    const end = new Date(start);
    end.setDate(end.getDate() + 60);
    db.update(schema.users)
      .set({
        competitionStart: start.toISOString().slice(0, 10),
        competitionEnd: end.toISOString().slice(0, 10),
      })
      .where(eq(schema.users.id, user.id))
      .run();
  }

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
      segmentalLeanJson: hasSegLean
        ? JSON.stringify({
            right_arm: num("seg_lean_right_arm"),
            left_arm: num("seg_lean_left_arm"),
            trunk: num("seg_lean_trunk"),
            right_leg: num("seg_lean_right_leg"),
            left_leg: num("seg_lean_left_leg"),
          })
        : null,
      segmentalFatJson: hasSegFat
        ? JSON.stringify({
            right_arm: num("seg_fat_right_arm"),
            left_arm: num("seg_fat_left_arm"),
            trunk: num("seg_fat_trunk"),
            right_leg: num("seg_fat_right_leg"),
            left_leg: num("seg_fat_left_leg"),
          })
        : null,
    })
    .run();

  // Check and award badges
  const newBadges = checkBadges(user.id);
  if (newBadges.length > 0) {
    const badgeNames = newBadges.map((b) => b.label).join("、");
    return c.redirect(`/dashboard?badges=${encodeURIComponent(badgeNames)}`);
  }

  return c.redirect("/dashboard");
});

// Serve photos
reports.get("/photos/:filename", (c) => {
  const user = c.get("user") as SessionUser | null;
  if (!user) return c.text("Unauthorized", 401);

  const filename = c.req.param("filename");
  // Basic path traversal protection
  if (filename.includes("..") || filename.includes("/")) {
    return c.text("Bad request", 400);
  }

  try {
    const buffer = readFileSync(`${PHOTO_DIR}/${filename}`);
    const ext = filename.endsWith(".png") ? "image/png" : "image/jpeg";
    return new Response(buffer, { headers: { "Content-Type": ext } });
  } catch {
    return c.text("Not found", 404);
  }
});

// Helper component
function NumField({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value: number | null;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        step="0.1"
        name={name}
        value={value ?? ""}
        placeholder="—"
      />
    </label>
  );
}

export default reports;
