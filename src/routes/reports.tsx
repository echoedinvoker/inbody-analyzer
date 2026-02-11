import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import convert from "heic-convert";
import { db, schema } from "../db/index.ts";
import { requireAuth, type SessionUser } from "../lib/session.ts";
import { extractFromPhoto, type ExtractedData } from "../lib/extract.ts";
import { checkBadges } from "../lib/badges.ts";
import { predictUser, predictAll } from "../lib/predict.ts";
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

  // Get report count for motivation preview
  const reportCount = db
    .select({ id: schema.reports.id })
    .from(schema.reports)
    .where(eq(schema.reports.userId, user.id))
    .all()
    .filter((r) => true).length;

  // Dynamic motivation message based on progress
  let previewItems: { icon: string; text: string }[] = [];
  if (reportCount === 0) {
    previewItems = [
      { icon: "🎯", text: "開始你的減脂比賽" },
      { icon: "📊", text: "建立身體組成基準數據" },
      { icon: "🏅", text: "獲得第一枚徽章" },
    ];
  } else if (reportCount === 1) {
    previewItems = [
      { icon: "📈", text: "解鎖趨勢圖和預測功能" },
      { icon: "🔮", text: "查看你的預測排名" },
      { icon: "🏅", text: "獲得「有跡可循」徽章" },
    ];
  } else if (reportCount < 4) {
    previewItems = [
      { icon: "🤖", text: `再 ${4 - reportCount} 筆解鎖 AI 個人化建議` },
      { icon: "🎯", text: "更新你的趨勢預測" },
      { icon: "📊", text: "更精確的排名預測" },
    ];
  } else {
    previewItems = [
      { icon: "📊", text: "更新趨勢分析" },
      { icon: "🔮", text: "刷新排名預測" },
      { icon: "🤖", text: "獲得最新 AI 建議" },
    ];
  }

  return c.html(
    <Layout title="上傳報告" user={user}>
      <div style="max-width:500px;margin:0 auto;">
        <h2 style="text-align:center;">上傳 InBody 報告</h2>

        {/* Motivation preview - what uploading gives you */}
        <div style="margin-bottom:1.5rem;padding:1rem;background:var(--pico-card-background-color);border-radius:8px;">
          <div style="font-size:0.85rem;opacity:0.6;margin-bottom:0.5rem;">上傳後你將</div>
          {previewItems.map((item) => (
            <div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;font-size:0.9rem;">
              <span>{item.icon}</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>

        {/* Upload form - the desert oasis */}
        <form
          method="post"
          action="/upload"
          enctype="multipart/form-data"
        >
          <label style="display:block;padding:2rem;border:2px dashed var(--pico-muted-border-color);border-radius:8px;text-align:center;cursor:pointer;margin-bottom:1rem;">
            <div style="font-size:2rem;margin-bottom:0.5rem;">📷</div>
            <div style="font-size:0.9rem;">選擇照片或拖放到此處</div>
            <div style="font-size:0.75rem;opacity:0.5;margin-top:0.25rem;">JPEG、PNG、HEIC，最大 5MB</div>
            <input type="file" name="photo" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif" required
              style="display:none;" />
          </label>
          <button type="submit" style="width:100%;font-size:1.1rem;padding:0.75rem;">
            上傳並分析
          </button>
        </form>
      </div>
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
      <p style="font-size:0.9rem;opacity:0.7;">核對 AI 提取的數據，如有錯誤可直接修改。</p>
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

            {/* Core metrics - prominent, always visible */}
            <fieldset>
              <legend><strong>核心指標</strong></legend>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
                <NumField label="體重 (kg)" name="weight" value={data.weight} />
                <NumField label="骨骼肌 (kg)" name="skeletal_muscle" value={data.skeletal_muscle} />
                <NumField label="體脂肪 (kg)" name="body_fat_mass" value={data.body_fat_mass} />
                <NumField label="體脂率 (%)" name="body_fat_pct" value={data.body_fat_pct} />
              </div>
            </fieldset>

            {/* Secondary metrics - collapsed */}
            <details style="margin-bottom:1rem;">
              <summary style="cursor:pointer;font-size:0.9rem;opacity:0.7;margin-bottom:0.5rem;">
                其他指標（BMI、基代、InBody 分數等）
              </summary>
              <fieldset>
                <NumField label="BMI" name="bmi" value={data.bmi} />
                <NumField label="總體水分 (L)" name="total_body_water" value={data.total_body_water} />
                <NumField label="內臟脂肪等級" name="visceral_fat_level" value={data.visceral_fat_level} />
                <NumField label="基礎代謝率 (kcal)" name="basal_metabolic_rate" value={data.basal_metabolic_rate} />
                <NumField label="InBody 分數" name="inbody_score" value={data.inbody_score} />
              </fieldset>
            </details>

            {/* Segmental data - collapsed */}
            {(data.segmental_lean || data.segmental_fat) && (
              <details style="margin-bottom:1rem;">
                <summary style="cursor:pointer;font-size:0.9rem;opacity:0.7;margin-bottom:0.5rem;">
                  節段分析
                </summary>
                {data.segmental_lean && (
                  <fieldset>
                    <legend>節段肌肉 (kg)</legend>
                    <NumField label="右臂" name="seg_lean_right_arm" value={data.segmental_lean.right_arm} />
                    <NumField label="左臂" name="seg_lean_left_arm" value={data.segmental_lean.left_arm} />
                    <NumField label="軀幹" name="seg_lean_trunk" value={data.segmental_lean.trunk} />
                    <NumField label="右腿" name="seg_lean_right_leg" value={data.segmental_lean.right_leg} />
                    <NumField label="左腿" name="seg_lean_left_leg" value={data.segmental_lean.left_leg} />
                  </fieldset>
                )}
                {data.segmental_fat && (
                  <fieldset>
                    <legend>節段脂肪 (%)</legend>
                    <NumField label="右臂" name="seg_fat_right_arm" value={data.segmental_fat.right_arm} />
                    <NumField label="左臂" name="seg_fat_left_arm" value={data.segmental_fat.left_arm} />
                    <NumField label="軀幹" name="seg_fat_trunk" value={data.segmental_fat.trunk} />
                    <NumField label="右腿" name="seg_fat_right_leg" value={data.segmental_fat.right_leg} />
                    <NumField label="左腿" name="seg_fat_left_leg" value={data.segmental_fat.left_leg} />
                  </fieldset>
                )}
              </details>
            )}

            <button type="submit" style="width:100%;font-size:1.05rem;padding:0.75rem;">
              確認並查看你的進步 →
            </button>
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
  const badgeParam = newBadges.length > 0
    ? `?badges=${encodeURIComponent(newBadges.map((b) => b.label).join("、"))}`
    : "";

  return c.redirect(`/report/${reportId}/success${badgeParam}`);
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

// --- Win State Success Page ---

reports.get("/report/:id/success", (c) => {
  const user = requireAuth(c);
  const reportId = Number(c.req.param("id"));
  const badgeFlash = c.req.query("badges") || null;

  // Verify ownership
  const report = db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .get();
  if (!report || report.userId !== user.id) return c.redirect("/dashboard");

  // Get current measurement
  const current = db
    .select()
    .from(schema.measurements)
    .where(eq(schema.measurements.reportId, reportId))
    .get();

  // Get all measurements to find previous
  const allMeasurements = db
    .select({
      reportId: schema.measurements.reportId,
      weight: schema.measurements.weight,
      skeletalMuscle: schema.measurements.skeletalMuscle,
      bodyFatPct: schema.measurements.bodyFatPct,
      bodyFatMass: schema.measurements.bodyFatMass,
      inbodyScore: schema.measurements.inbodyScore,
    })
    .from(schema.measurements)
    .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
    .where(eq(schema.reports.userId, user.id))
    .orderBy(asc(schema.reports.measuredAt))
    .all();

  const reportCount = allMeasurements.length;
  const currentIdx = allMeasurements.findIndex((m) => m.reportId === reportId);
  const prev = currentIdx > 0 ? allMeasurements[currentIdx - 1]! : null;

  // Prediction
  const myPrediction = predictUser(user.id);
  const allPredictions = predictAll();
  const myRank = myPrediction
    ? allPredictions.findIndex((p) => p.userId === user.id) + 1
    : null;
  const totalPredicted = allPredictions.length;

  // Build change items
  type ChangeItem = { label: string; diff: number; unit: string; isGood: boolean };
  const changes: ChangeItem[] = [];
  if (current && prev) {
    const items: { key: string; label: string; unit: string; lowerIsGood: boolean }[] = [
      { key: "bodyFatPct", label: "體脂率", unit: "%", lowerIsGood: true },
      { key: "skeletalMuscle", label: "骨骼肌", unit: "kg", lowerIsGood: false },
      { key: "weight", label: "體重", unit: "kg", lowerIsGood: true },
      { key: "bodyFatMass", label: "體脂肪", unit: "kg", lowerIsGood: true },
    ];
    for (const item of items) {
      const cur = (current as any)[item.key] as number | null;
      const pre = (prev as any)[item.key] as number | null;
      if (cur != null && pre != null) {
        const diff = Math.round((cur - pre) * 10) / 10;
        if (diff !== 0) {
          changes.push({
            label: item.label,
            diff,
            unit: item.unit,
            isGood: item.lowerIsGood ? diff < 0 : diff > 0,
          });
        }
      }
    }
  }

  // Determine accelerator message based on report count
  let acceleratorMsg = "";
  let acceleratorLink = "/upload";
  let acceleratorLabel = "";
  if (reportCount === 1) {
    acceleratorMsg = "再上傳 1 筆即可解鎖趨勢預測！";
    acceleratorLabel = "繼續上傳";
  } else if (reportCount < 4) {
    acceleratorMsg = `再 ${4 - reportCount} 筆就能解鎖 AI 深度分析`;
    acceleratorLabel = "繼續上傳";
  } else {
    acceleratorMsg = "查看你的完整分析報告";
    acceleratorLink = "/dashboard";
    acceleratorLabel = "查看儀表板";
  }

  const winnerCount = Math.min(3, Math.floor(totalPredicted / 2));
  const loserStart = totalPredicted - winnerCount;
  const inDanger = myRank != null && myRank > loserStart;
  const isSafe = myRank != null && myRank <= winnerCount;

  return c.html(
    <Layout title="數據已記錄！" user={user}>
      <style>{`
        @keyframes badge-pop {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.3); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 8px rgba(250,204,21,0.4); }
          50% { box-shadow: 0 0 20px rgba(250,204,21,0.8); }
        }
        @keyframes slide-up {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .win-badge {
          display: inline-flex; align-items: center; gap: 0.5rem;
          padding: 0.5rem 1rem; border-radius: 999px;
          background: linear-gradient(135deg, #fef3c7, #fde68a);
          border: 2px solid #f59e0b;
          animation: badge-pop 0.5s ease-out, glow-pulse 2s ease-in-out infinite;
          font-weight: bold; font-size: 1.1rem;
        }
        .change-card {
          animation: slide-up 0.4s ease-out both;
          padding: 1rem; border-radius: 8px; text-align: center;
          background: var(--pico-card-background-color);
        }
        .change-good { border-left: 4px solid #22c55e; }
        .change-bad { border-left: 4px solid #ef4444; }
        .win-hero { text-align: center; padding: 2rem 1rem; }
        .win-section { animation: slide-up 0.4s ease-out both; margin-bottom: 1.5rem; }
      `}</style>

      <div class="win-hero">
        <div style="font-size:3rem;margin-bottom:0.5rem;">🎉</div>
        <h1 style="margin:0 0 0.5rem;">數據已記錄！</h1>
        <p style="opacity:0.7;margin:0;">
          第 {reportCount} 筆數據 · {report.measuredAt?.slice(0, 10)}
        </p>
      </div>

      {/* Change summary */}
      {changes.length > 0 && (
        <div class="win-section" style="animation-delay:0.1s;">
          <h3 style="text-align:center;margin-bottom:1rem;">vs 上次測量</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem;">
            {changes.map((ch, i) => (
              <div class={`change-card ${ch.isGood ? "change-good" : "change-bad"}`}
                   style={`animation-delay:${0.15 + i * 0.1}s;`}>
                <div style={`font-size:1.5rem;font-weight:bold;color:${ch.isGood ? "#22c55e" : "#ef4444"};`}>
                  {ch.diff > 0 ? "+" : ""}{ch.diff}{ch.unit}
                </div>
                <div style="font-size:0.85rem;opacity:0.7;margin-top:0.25rem;">{ch.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Badges earned */}
      {badgeFlash && (
        <div class="win-section" style="text-align:center;animation-delay:0.3s;">
          <h3 style="margin-bottom:1rem;">解鎖徽章！</h3>
          <div style="display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;">
            {badgeFlash.split("、").map((badge, i) => (
              <div class="win-badge" style={`animation-delay:${0.4 + i * 0.2}s;`}>
                {badge}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rank preview */}
      {myPrediction && myRank && (
        <div class="win-section" style={`text-align:center;padding:1rem;border-radius:8px;background:${inDanger ? 'rgba(239,68,68,0.08)' : isSafe ? 'rgba(34,197,94,0.08)' : 'var(--pico-card-background-color)'};animation-delay:0.4s;`}>
          <div style="font-size:0.85rem;opacity:0.7;">目前預測排名</div>
          <div style="font-size:2.5rem;font-weight:bold;">
            第 {myRank} 名
          </div>
          <div style="font-size:0.9rem;opacity:0.7;">
            共 {totalPredicted} 人 · 預測體脂率 {myPrediction.predictedFatPct}%
          </div>
          {inDanger && (
            <div style="color:#ef4444;margin-top:0.5rem;font-size:0.9rem;">
              ⚠️ 小心！你可能需要準備乳清蛋白...
            </div>
          )}
          {isSafe && (
            <div style="color:#22c55e;margin-top:0.5rem;font-size:0.9rem;">
              ✅ 安全區！繼續保持！
            </div>
          )}
        </div>
      )}

      {/* Accelerator CTA - the game loop "green arrow" */}
      <div class="win-section" style="text-align:center;animation-delay:0.5s;margin-top:2rem;">
        <p style="margin-bottom:1rem;font-size:1.1rem;">
          {acceleratorMsg}
        </p>
        <a href={acceleratorLink} role="button" style="font-size:1.1rem;padding:0.75rem 2rem;">
          {acceleratorLabel}
        </a>
      </div>

      {/* Secondary options */}
      <div style="text-align:center;margin-top:1rem;font-size:0.9rem;opacity:0.6;">
        <a href="/dashboard">儀表板</a>
        {" · "}
        <a href="/leaderboard">排行榜</a>
        {" · "}
        <a href="/reports">歷史紀錄</a>
      </div>
    </Layout>
  );
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
