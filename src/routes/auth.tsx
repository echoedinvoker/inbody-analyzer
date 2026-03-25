import { Hono } from "hono";
import { eq, and, isNotNull } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { createSession, destroySession, signJwt } from "../lib/session.ts";
import { getOrCreateDemoUser } from "../lib/demo.ts";
import { Layout } from "../views/layout.tsx";

const LIFF_ID = "2009579829-XlKrJJI0";

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
        <button type="submit" class="btn-primary" style="width:100%;">登入</button>
      </form>

      <div style="text-align:center;margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--ib-border);">
        <a href="/liff" style="display:block;width:100%;padding:0.75rem;background:#06C755;color:#fff;text-align:center;border-radius:8px;text-decoration:none;font-weight:bold;font-size:1rem;margin-bottom:0.75rem;">
          用 LINE 登入
        </a>
        <p style="font-size:0.85rem;opacity:0.6;margin-bottom:0.75rem;">沒有邀請碼？</p>
        <form method="post" action="/login/demo">
          <button type="submit" class="btn-outline" style="width:100%;">
            以訪客身份體驗
          </button>
        </form>
      </div>
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

// Demo login - create/reset demo user and log in
auth.post("/login/demo", (c) => {
  const userId = getOrCreateDemoUser();
  createSession(c, userId);
  return c.redirect("/dashboard");
});

// Logout
auth.post("/logout", (c) => {
  destroySession(c);
  return c.redirect("/login");
});

// LIFF landing page — serves LIFF SDK that auto-authenticates via LINE
auth.get("/liff", (c) => {
  // If already logged in, redirect to dashboard
  const user = c.get("user") as any;
  if (user) return c.redirect("/dashboard");

  return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>InBody 登入中...</title>
  <style>
    body { margin:0; display:flex; align-items:center; justify-content:center; height:100vh; background:#1a1a2e; color:#fff; font-family:system-ui; }
    .loading { text-align:center; }
    .spinner { width:40px; height:40px; border:3px solid rgba(255,255,255,0.2); border-top-color:#f97316; border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto 1rem; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .error { color:#ef4444; margin-top:1rem; }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <div id="status">正在透過 LINE 登入...</div>
    <div id="error" class="error" style="display:none;"></div>
  </div>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <script>
    (async () => {
      try {
        await liff.init({ liffId: '${LIFF_ID}' });

        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: location.href });
          return;
        }

        const accessToken = liff.getAccessToken();
        if (!accessToken) {
          document.getElementById('error').textContent = '無法取得 LINE token';
          document.getElementById('error').style.display = 'block';
          return;
        }

        document.getElementById('status').textContent = '驗證中...';

        const res = await fetch('/auth/liff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken }),
        });

        const data = await res.json();
        if (data.ok) {
          window.location.href = '/dashboard';
        } else {
          document.getElementById('error').textContent = data.error || '登入失敗';
          document.getElementById('error').style.display = 'block';
        }
      } catch (e) {
        document.getElementById('error').textContent = '登入錯誤: ' + e.message;
        document.getElementById('error').style.display = 'block';
      }
    })();
  </script>
</body>
</html>`);
});

// LIFF auth endpoint — verify LINE access token, find or create user, create session
auth.post("/auth/liff", async (c) => {
  try {
    const { accessToken } = await c.req.json();
    if (!accessToken) return c.json({ ok: false, error: "Missing token" }, 400);

    // Verify token and get profile from LINE
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileRes.ok) {
      return c.json({ ok: false, error: "Invalid LINE token" }, 401);
    }

    const profile = await profileRes.json() as { userId: string; displayName: string; pictureUrl?: string };
    const lineUserId = profile.userId;
    const displayName = profile.displayName;

    // Find existing user by LINE user ID
    let user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.lineUserId, lineUserId))
      .get();

    if (!user) {
      // Auto-create user for LINE login
      const result = db
        .insert(schema.users)
        .values({
          name: displayName,
          lineUserId,
          goal: "maintain",
        })
        .returning()
        .get();
      user = result;
    } else if (user.name.startsWith("待領取")) {
      // Update placeholder name with LINE display name
      db.update(schema.users)
        .set({ name: displayName })
        .where(eq(schema.users.id, user.id))
        .run();
    }

    createSession(c, user.id);
    return c.json({ ok: true });
  } catch (e: any) {
    console.error("LIFF auth error:", e.message);
    return c.json({ ok: false, error: "Server error" }, 500);
  }
});

// Admin: generate invite codes
auth.get("/admin/invite", (c) => {
  const user = c.get("user") as any;
  if (!user?.isAdmin) return c.redirect("/");

  // List existing unused invite codes
  const codes = db
    .select({ id: schema.users.id, name: schema.users.name, inviteCode: schema.users.inviteCode, isGhost: schema.users.isGhost })
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
        <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
          <input type="checkbox" name="ghost" value="1" style="width:auto;margin:0;" />
          幽靈模式（其他人看不到此玩家）
        </label>
        <button type="submit" class="btn-primary">產生</button>
      </form>
      <h3>現有邀請碼</h3>
      <table>
        <thead>
          <tr>
            <th>邀請碼</th>
            <th>使用者</th>
            <th>模式</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((row) => (
            <tr>
              <td>
                <code>{row.inviteCode}</code>
              </td>
              <td>{row.name}</td>
              <td>{row.isGhost ? "👻 幽靈" : "一般"}</td>
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
  const ghost = body.ghost === "1";

  for (let i = 0; i < count; i++) {
    const code = `INB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    db.insert(schema.users)
      .values({ name: `待領取 (${code})`, inviteCode: code, goal: "maintain", isGhost: ghost })
      .run();
  }

  const modeLabel = ghost ? "幽靈" : "一般";
  return c.redirect(`/admin/invite?msg=已產生 ${count} 組${modeLabel}邀請碼`);
});

// ==========================================
// JSON API endpoints (for Nuxt frontend)
// ==========================================

// POST /api/auth/liff — verify LINE token, return JWT
auth.post("/api/auth/liff", async (c) => {
  try {
    const { accessToken } = await c.req.json();
    if (!accessToken) return c.json({ error: "Missing token" }, 400);

    // Verify token and get profile from LINE
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileRes.ok) {
      return c.json({ error: "Invalid LINE token" }, 401);
    }

    const profile = (await profileRes.json()) as {
      userId: string;
      displayName: string;
      pictureUrl?: string;
    };
    const lineUserId = profile.userId;
    const displayName = profile.displayName;

    // Find existing user by LINE user ID
    let user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.lineUserId, lineUserId))
      .get();

    if (!user) {
      // Auto-create user for LINE login
      user = db
        .insert(schema.users)
        .values({
          name: displayName,
          lineUserId,
          goal: "maintain",
        })
        .returning()
        .get();
    } else if (user.name.startsWith("待領取")) {
      // Update placeholder name with LINE display name
      db.update(schema.users)
        .set({ name: displayName })
        .where(eq(schema.users.id, user.id))
        .run();
      user = { ...user, name: displayName };
    }

    const token = await signJwt(user.id, user.name);
    return c.json({
      token,
      user: { id: user.id, name: user.name, goal: user.goal },
    });
  } catch (e: any) {
    console.error("API LIFF auth error:", e.message);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /api/auth/dev — dev-only: get JWT by userId (no LINE token needed)
auth.post("/api/auth/dev", async (c) => {
  if (process.env.NODE_ENV === "production") {
    return c.json({ error: "Not available in production" }, 403);
  }
  const { userId } = await c.req.json();
  if (!userId) return c.json({ error: "Missing userId" }, 400);

  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, Number(userId)))
    .get();

  if (!user) return c.json({ error: "User not found" }, 404);

  const token = await signJwt(user.id, user.name);
  return c.json({
    token,
    user: { id: user.id, name: user.name, goal: user.goal },
  });
});

// GET /api/auth/me — get current user info from JWT
auth.get("/api/auth/me", (c) => {
  const user = c.get("user") as any;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({
    id: user.id,
    name: user.name,
    isAdmin: user.isAdmin,
    goal: user.goal,
  });
});

export default auth;
