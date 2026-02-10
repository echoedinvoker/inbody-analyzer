import { Hono } from "hono";
import { eq, and, isNotNull } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { createSession, destroySession } from "../lib/session.ts";
import { Layout } from "../views/layout.tsx";

const auth = new Hono();

// Login page
auth.get("/login", (c) => {
  const error = c.req.query("error");
  return c.html(
    <Layout title="登入">
      {error && <div class="flash flash-error">{error}</div>}
      <h2>登入 InBody 分析系統</h2>
      <form method="post" action="/login">
        <label>
          邀請碼
          <input
            type="text"
            name="invite_code"
            placeholder="輸入你的邀請碼"
            required
            autofocus
          />
        </label>
        <label>
          你的名字
          <input
            type="text"
            name="name"
            placeholder="顯示名稱（首次登入用）"
          />
        </label>
        <button type="submit">登入</button>
      </form>
    </Layout>
  );
});

// Login handler
auth.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const inviteCode = String(body.invite_code || "").trim();
  const name = String(body.name || "").trim();

  if (!inviteCode) {
    return c.redirect("/login?error=請輸入邀請碼");
  }

  // Find user with this invite code
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.inviteCode, inviteCode))
    .limit(1);

  if (rows.length === 0) {
    return c.redirect("/login?error=邀請碼無效");
  }

  const user = rows[0]!;

  // If name is provided and user still has placeholder name, update it
  if (name && user.name.startsWith("待領取")) {
    db.update(schema.users)
      .set({ name })
      .where(eq(schema.users.id, user.id))
      .run();
  }

  createSession(c, user.id);
  return c.redirect("/dashboard");
});

// Logout
auth.post("/logout", (c) => {
  destroySession(c);
  return c.redirect("/login");
});

// Admin: generate invite codes
auth.get("/admin/invite", (c) => {
  const user = c.get("user") as any;
  if (!user?.isAdmin) return c.redirect("/");

  // List existing unused invite codes
  const codes = db
    .select({ id: schema.users.id, name: schema.users.name, inviteCode: schema.users.inviteCode })
    .from(schema.users)
    .where(isNotNull(schema.users.inviteCode))
    .all();

  const message = c.req.query("msg");

  return c.html(
    <Layout title="管理邀請碼" user={user}>
      {message && <div class="flash flash-success">{message}</div>}
      <h2>管理邀請碼</h2>
      <form method="post" action="/admin/invite">
        <label>
          產生數量
          <input type="number" name="count" value="3" min="1" max="20" />
        </label>
        <button type="submit">產生</button>
      </form>
      <h3>現有邀請碼</h3>
      <table>
        <thead>
          <tr>
            <th>邀請碼</th>
            <th>使用者</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((row) => (
            <tr>
              <td>
                <code>{row.inviteCode}</code>
              </td>
              <td>{row.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
});

// Admin: create invite codes
auth.post("/admin/invite", async (c) => {
  const user = c.get("user") as any;
  if (!user?.isAdmin) return c.redirect("/");

  const body = await c.req.parseBody();
  const count = Math.min(Number(body.count) || 3, 20);

  for (let i = 0; i < count; i++) {
    const code = `INB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    db.insert(schema.users)
      .values({ name: `待領取 (${code})`, inviteCode: code, goal: "maintain" })
      .run();
  }

  return c.redirect(`/admin/invite?msg=已產生 ${count} 組邀請碼`);
});

export default auth;
