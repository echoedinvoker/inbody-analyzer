import { Hono } from "hono";
import { eq, desc, sql } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth, type SessionUser } from "../lib/session.ts";
import { getConfig, getCompetitionMode, getCompetitionStart, getCompetitionEnd, saveConfig } from "../lib/config.ts";
import { startNewCompetition } from "../lib/competition.ts";
import { sendMeasurementReminder, sendTestMessage } from "../lib/line-notify.ts";
import { Layout } from "../views/layout.tsx";

const DATA_DIR = process.env.DATABASE_PATH
  ? process.env.DATABASE_PATH.replace(/\/[^/]+$/, "")
  : "./data";
const PHOTO_DIR = `${DATA_DIR}/photos`;

const admin = new Hono();

// Admin guard middleware (skip cron endpoints which use API key auth)
admin.use("/admin/*", async (c, next) => {
  if (c.req.path.startsWith("/admin/cron/")) return next();
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

  const competitionMode = getCompetitionMode();
  const compStart = getCompetitionStart();
  const compEnd = getCompetitionEnd();
  const compHistory = db.select().from(schema.competitionHistory).all();

  return c.html(
    <Layout title="管理員" user={user}>
      <h2>管理員面板</h2>
      <div style="margin-bottom:1rem;">
        <a href="/admin/invite" class="btn-outline">管理邀請碼</a>
      </div>

      {/* Competition Management */}
      <h3>比賽管理</h3>
      <div class="ib-card" style="padding:1rem;margin-bottom:1.5rem;">
        <div style="display:grid;gap:0.5rem;font-size:0.85rem;margin-bottom:1rem;">
          <div><strong>目前模式：</strong>{competitionMode === "bulk" ? "💪 增肌" : "🔥 減脂"}</div>
          <div><strong>比賽期間：</strong>{compStart && compEnd ? `${compStart} ~ ${compEnd}` : "未設定"}</div>
          {compHistory.length > 0 && <div><strong>已完成屆數：</strong>{compHistory.length} 屆</div>}
        </div>

        <form method="post" action="/admin/start-competition" style="margin:0;" onsubmit="return confirm('確定開始新比賽？當前比賽排名會被快照保存，所有 streak 會重設。');">
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end;">
            <label style="flex:1;min-width:100px;margin:0;">
              <span style="font-size:0.8rem;">模式</span>
              <select name="mode" style="padding:0.3rem;font-size:0.85rem;margin:0;">
                <option value="bulk">💪 增肌</option>
                <option value="cut">🔥 減脂</option>
              </select>
            </label>
            <label style="flex:1;min-width:120px;margin:0;">
              <span style="font-size:0.8rem;">開始日期</span>
              <input type="date" name="start" style="padding:0.3rem;font-size:0.85rem;margin:0;" required />
            </label>
            <label style="flex:1;min-width:120px;margin:0;">
              <span style="font-size:0.8rem;">結束日期</span>
              <input type="date" name="end" style="padding:0.3rem;font-size:0.85rem;margin:0;" required />
            </label>
            <button type="submit" style="font-size:0.85rem;padding:0.4rem 1rem;margin:0;white-space:nowrap;">🚀 開始新比賽</button>
          </div>
        </form>
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
                {u.isGhost && " 👻"}
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
                  <div>
                    <span
                      style="cursor:pointer;font-size:0.85rem;"
                      onclick={`this.style.display='none';this.nextElementSibling.style.display='flex';`}
                    >
                      {u.competitionStart} ~ {u.competitionEnd ?? "?"}
                    </span>
                    <form method="post" action={`/admin/user/${u.id}/competition`} style="display:none;gap:0.25rem;align-items:center;margin:0;">
                      <input type="date" name="start" value={u.competitionStart} style="padding:0.15rem 0.3rem;font-size:0.8rem;width:auto;margin:0;" />
                      <span>~</span>
                      <input type="date" name="end" value={u.competitionEnd ?? ""} style="padding:0.15rem 0.3rem;font-size:0.8rem;width:auto;margin:0;" />
                      <button type="submit" style="all:unset;cursor:pointer;color:var(--ib-primary);font-size:0.8rem;white-space:nowrap;">儲存</button>
                    </form>
                  </div>
                ) : "未開始"}
              </td>
              <td>
                {!u.isAdmin && (
                  <form
                    method="post"
                    action={`/admin/user/${u.id}/delete`}
                    style="display:inline;margin:0;"
                    onsubmit="return confirm('確定刪除此使用者及其所有數據？')"
                  >
                    <button
                      type="submit"
                      style="all:unset;cursor:pointer;color:var(--ib-danger);font-size:0.8rem;"
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

      {/* LINE Integration */}
      <h3 style="margin-top:2rem;">LINE 群組提醒</h3>
      <div class="ib-card" style="padding:1rem;">
        <div style="display:grid;gap:0.5rem;font-size:0.85rem;">
          <div>
            <strong>Group ID：</strong>
            <span style="opacity:0.7;">{getConfig("line_group_id") || "（尚未設定——把 Bot 加入群組後自動取得）"}</span>
          </div>
          <div>
            <strong>Token：</strong>
            <span style="opacity:0.7;">{process.env.LINE_CHANNEL_ACCESS_TOKEN ? "已設定 ✓" : "未設定"}</span>
          </div>
          <div>
            <strong>Cron Secret：</strong>
            <code style="font-size:0.8rem;opacity:0.6;">{getConfig("cron_secret") || "—"}</code>
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
            <form method="post" action="/admin/line-test" style="margin:0;">
              <button type="submit" style="font-size:0.85rem;padding:0.3rem 0.8rem;">發送測試訊息</button>
            </form>
            <form method="post" action="/admin/line-remind" style="margin:0;">
              <button type="submit" style="font-size:0.85rem;padding:0.3rem 0.8rem;">立即發送提醒</button>
            </form>
          </div>
        </div>
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

// LINE test message
admin.post("/admin/line-test", async (c) => {
  const user = requireAuth(c);
  if (!user.isAdmin) return c.redirect("/");
  try {
    await sendTestMessage();
  } catch (e: any) {
    console.error("LINE test failed:", e.message);
  }
  return c.redirect("/admin");
});

// LINE immediate reminder
admin.post("/admin/line-remind", async (c) => {
  const user = requireAuth(c);
  if (!user.isAdmin) return c.redirect("/");
  try {
    await sendMeasurementReminder();
  } catch (e: any) {
    console.error("LINE reminder failed:", e.message);
  }
  return c.redirect("/admin");
});

// Cron endpoint for external scheduler (no session auth, uses cron_secret)
admin.post("/admin/cron/reminder", async (c) => {
  const secret = c.req.query("secret") || c.req.header("x-cron-secret") || "";
  const expected = getConfig("cron_secret");
  if (!expected || secret !== expected) return c.text("Forbidden", 403);

  // Prevent duplicate sends on same day
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const today = utc8.toISOString().slice(0, 10);
  const lastSent = getConfig("last_reminder_date");
  if (lastSent === today) return c.json({ skipped: true, reason: "already sent today" });

  try {
    const result = await sendMeasurementReminder();
    if (result?.sent) {
      saveConfig("last_reminder_date", today);
    }
    return c.json({ sent: result?.sent ?? false, date: today, detail: result?.message });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Start new competition
admin.post("/admin/start-competition", async (c) => {
  const user = requireAuth(c);
  if (!user.isAdmin) return c.redirect("/");

  const body = await c.req.parseBody();
  const mode = String(body.mode || "").trim();
  const start = String(body.start || "").trim();
  const end = String(body.end || "").trim();

  if ((mode === "cut" || mode === "bulk") && start && end) {
    const snapshot = startNewCompetition("", mode, start, end);
    // Notify LINE group about ended competition
    if (snapshot) {
      const { notifyCompetitionEnd } = await import("../lib/line-notify.ts");
      notifyCompetitionEnd(snapshot.resultsJson, snapshot.name).catch((e) =>
        console.error("LINE competition end notify failed:", e.message)
      );
    }
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

  // Delete badges
  db.delete(schema.badges).where(eq(schema.badges.userId, targetId)).run();

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
