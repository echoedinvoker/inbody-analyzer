import { Hono } from "hono";
import { eq, desc, sql } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth, type SessionUser } from "../lib/session.ts";
import { Layout } from "../views/layout.tsx";

const DATA_DIR = process.env.DATABASE_PATH
  ? process.env.DATABASE_PATH.replace(/\/[^/]+$/, "")
  : "./data";
const PHOTO_DIR = `${DATA_DIR}/photos`;

const admin = new Hono();

// Admin guard middleware
admin.use("/admin/*", async (c, next) => {
  const user = c.get("user") as SessionUser | null;
  if (!user?.isAdmin) return c.redirect("/");
  return next();
});

// Admin dashboard
admin.get("/admin", (c) => {
  const user = requireAuth(c);

  // All users with their latest measurement
  const users = db.select().from(schema.users).all();

  const userSummaries = users.map((u) => {
    const latest = db
      .select({
        measuredAt: schema.reports.measuredAt,
        weight: schema.measurements.weight,
        bodyFatPct: schema.measurements.bodyFatPct,
        skeletalMuscle: schema.measurements.skeletalMuscle,
      })
      .from(schema.measurements)
      .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
      .where(eq(schema.reports.userId, u.id))
      .orderBy(desc(schema.reports.measuredAt))
      .limit(1)
      .get();

    const reportCount = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.reports)
      .where(eq(schema.reports.userId, u.id))
      .get();

    return {
      ...u,
      latest,
      reportCount: reportCount?.count ?? 0,
    };
  });

  return c.html(
    <Layout title="管理員" user={user}>
      <h2>管理員面板</h2>
      <div style="margin-bottom:1rem;">
        <a href="/admin/invite" role="button" class="outline">
          管理邀請碼
        </a>
      </div>

      <h3>使用者列表（{users.length} 人）</h3>
      <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名稱</th>
            <th>目標</th>
            <th>報告數</th>
            <th>最新體重</th>
            <th>最新體脂率</th>
            <th>最新日期</th>
            <th>比賽區間</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {userSummaries.map((u) => (
            <tr>
              <td>{u.id}</td>
              <td>
                {u.name}
                {u.isAdmin && " (管理員)"}
              </td>
              <td>
                {{ cut: "減脂", bulk: "增肌", maintain: "維持" }[u.goal ?? "maintain"]}
              </td>
              <td>{u.reportCount}</td>
              <td>{u.latest?.weight != null ? `${u.latest.weight} kg` : "—"}</td>
              <td>{u.latest?.bodyFatPct != null ? `${u.latest.bodyFatPct}%` : "—"}</td>
              <td>{u.latest?.measuredAt?.slice(0, 10) ?? "—"}</td>
              <td>
                {u.competitionStart ? (
                  <form method="post" action={`/admin/user/${u.id}/competition`} style="display:flex;gap:0.25rem;align-items:center;">
                    <input type="date" name="start" value={u.competitionStart} style="padding:0.15rem 0.3rem;font-size:0.8rem;width:auto;" />
                    <span>~</span>
                    <input type="date" name="end" value={u.competitionEnd ?? ""} style="padding:0.15rem 0.3rem;font-size:0.8rem;width:auto;" />
                    <button type="submit" class="outline" style="padding:0.15rem 0.4rem;margin:0;font-size:0.75rem;">存</button>
                  </form>
                ) : "未開始"}
              </td>
              <td>
                {!u.isAdmin && (
                  <form
                    method="post"
                    action={`/admin/user/${u.id}/delete`}
                    style="display:inline"
                    onsubmit="return confirm('確定刪除此使用者及其所有數據？')"
                  >
                    <button
                      type="submit"
                      class="outline"
                      style="padding:0.2rem 0.5rem;color:red;border-color:red;"
                    >
                      刪除
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Layout>
  );
});

// Update user competition dates
admin.post("/admin/user/:id/competition", async (c) => {
  const user = requireAuth(c);
  if (!user.isAdmin) return c.redirect("/");

  const targetId = Number(c.req.param("id"));
  const body = await c.req.parseBody();
  const start = String(body.start || "").trim();
  const end = String(body.end || "").trim();

  if (start && end) {
    db.update(schema.users)
      .set({ competitionStart: start, competitionEnd: end })
      .where(eq(schema.users.id, targetId))
      .run();
  }

  return c.redirect("/admin");
});

// Delete user and all data
admin.post("/admin/user/:id/delete", (c) => {
  const user = requireAuth(c);
  if (!user.isAdmin) return c.redirect("/");

  const targetId = Number(c.req.param("id"));
  if (targetId === user.id) return c.redirect("/admin"); // can't delete yourself

  // Get all report IDs for this user
  const reports = db
    .select({ id: schema.reports.id, photoPath: schema.reports.photoPath })
    .from(schema.reports)
    .where(eq(schema.reports.userId, targetId))
    .all();

  // Delete measurements
  for (const r of reports) {
    db.delete(schema.measurements)
      .where(eq(schema.measurements.reportId, r.id))
      .run();
  }

  // Delete reports
  db.delete(schema.reports).where(eq(schema.reports.userId, targetId)).run();

  // Delete advice cache
  db.delete(schema.adviceCache).where(eq(schema.adviceCache.userId, targetId)).run();

  // Delete user goals
  db.delete(schema.userGoals).where(eq(schema.userGoals.userId, targetId)).run();

  // Delete sessions
  db.delete(schema.sessions).where(eq(schema.sessions.userId, targetId)).run();

  // Delete user
  db.delete(schema.users).where(eq(schema.users.id, targetId)).run();

  // Delete photos
  const { unlinkSync } = require("fs");
  for (const r of reports) {
    if (r.photoPath) {
      try { unlinkSync(`${PHOTO_DIR}/${r.photoPath}`); } catch {}
    }
  }

  return c.redirect("/admin");
});

export default admin;
