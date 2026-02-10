import { Hono } from "hono";
import { eq, desc, and } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth, type SessionUser } from "../lib/session.ts";
import { Layout } from "../views/layout.tsx";
import { unlinkSync } from "fs";

const DATA_DIR = process.env.DATABASE_PATH
  ? process.env.DATABASE_PATH.replace(/\/[^/]+$/, "")
  : "./data";
const PHOTO_DIR = `${DATA_DIR}/photos`;

const history = new Hono();

// Report list
history.get("/reports", (c) => {
  const user = requireAuth(c);

  const rows = db
    .select({
      reportId: schema.reports.id,
      measuredAt: schema.reports.measuredAt,
      photoPath: schema.reports.photoPath,
      confirmed: schema.reports.confirmed,
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

  return c.html(
    <Layout title="歷史紀錄" user={user}>
      <h2>歷史報告</h2>
      {rows.length === 0 ? (
        <p>
          尚無紀錄。<a href="/upload">上傳第一份報告</a>
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>體重</th>
              <th>骨骼肌</th>
              <th>體脂率</th>
              <th>InBody</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr>
                <td>{r.measuredAt?.slice(0, 10) || "—"}</td>
                <td>{r.weight != null ? `${r.weight} kg` : "—"}</td>
                <td>{r.skeletalMuscle != null ? `${r.skeletalMuscle} kg` : "—"}</td>
                <td>{r.bodyFatPct != null ? `${r.bodyFatPct}%` : "—"}</td>
                <td>{r.inbodyScore ?? "—"}</td>
                <td>{r.confirmed ? "已確認" : "待確認"}</td>
                <td>
                  <a href={`/report/${r.reportId}`}>詳情</a>
                  {" "}
                  <form
                    method="post"
                    action={`/report/${r.reportId}/delete`}
                    style="display:inline"
                    onsubmit="return confirm('確定刪除此報告？')"
                  >
                    <button
                      type="submit"
                      class="outline"
                      style="padding:0.2rem 0.5rem;color:red;border-color:red;"
                    >
                      刪除
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
});

// Report detail
history.get("/report/:id", (c) => {
  const user = requireAuth(c);
  const reportId = Number(c.req.param("id"));

  const report = db
    .select()
    .from(schema.reports)
    .where(and(eq(schema.reports.id, reportId), eq(schema.reports.userId, user.id)))
    .get();

  if (!report) return c.redirect("/reports");

  const measurement = db
    .select()
    .from(schema.measurements)
    .where(eq(schema.measurements.reportId, reportId))
    .get();

  return c.html(
    <Layout title="報告詳情" user={user}>
      <h2>報告詳情 — {report.measuredAt?.slice(0, 10)}</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;">
        {/* Photo proof */}
        <div>
          <h3>原始報告照片</h3>
          {report.photoPath ? (
            <img
              src={`/photos/${report.photoPath}`}
              alt="InBody 報告"
              style="max-width:100%;border-radius:8px;"
            />
          ) : (
            <p>無照片</p>
          )}
        </div>

        {/* Measurement data */}
        <div>
          <h3>測量數據</h3>
          {measurement ? (
            <table>
              <tbody>
                <DataRow label="體重" value={measurement.weight} unit="kg" />
                <DataRow label="骨骼肌重" value={measurement.skeletalMuscle} unit="kg" />
                <DataRow label="體脂肪重" value={measurement.bodyFatMass} unit="kg" />
                <DataRow label="體脂率" value={measurement.bodyFatPct} unit="%" />
                <DataRow label="BMI" value={measurement.bmi} unit="" />
                <DataRow label="總體水分" value={measurement.totalBodyWater} unit="L" />
                <DataRow label="內臟脂肪等級" value={measurement.visceralFatLevel} unit="" />
                <DataRow label="基礎代謝率" value={measurement.basalMetabolicRate} unit="kcal" />
                <DataRow label="InBody 分數" value={measurement.inbodyScore} unit="" />
              </tbody>
            </table>
          ) : (
            <p>
              尚未確認。<a href={`/report/${reportId}/confirm`}>前往確認</a>
            </p>
          )}
        </div>
      </div>
      <div style="margin-top:1rem;">
        <a href="/reports">返回歷史紀錄</a>
      </div>
    </Layout>
  );
});

// Delete report
history.post("/report/:id/delete", (c) => {
  const user = requireAuth(c);
  const reportId = Number(c.req.param("id"));

  const report = db
    .select()
    .from(schema.reports)
    .where(and(eq(schema.reports.id, reportId), eq(schema.reports.userId, user.id)))
    .get();

  if (!report) return c.redirect("/reports");

  // Delete measurement first (FK constraint)
  db.delete(schema.measurements)
    .where(eq(schema.measurements.reportId, reportId))
    .run();

  // Delete report
  db.delete(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .run();

  // Delete photo file
  if (report.photoPath) {
    try {
      unlinkSync(`${PHOTO_DIR}/${report.photoPath}`);
    } catch {}
  }

  return c.redirect("/reports");
});

function DataRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null;
  unit: string;
}) {
  return (
    <tr>
      <td>{label}</td>
      <td>{value != null ? `${value} ${unit}` : "—"}</td>
    </tr>
  );
}

export default history;
