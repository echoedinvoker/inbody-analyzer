import type { FC } from "hono/jsx";

export const Layout: FC<{ title?: string; user?: { name: string; isAdmin?: boolean } }> = ({
  title,
  user,
  children,
}) => (
  <html lang="zh-TW">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title ? `${title} — InBody` : "InBody 分析系統"}</title>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
      />
      <style>{`
        body { max-width: 900px; margin: 0 auto; padding: 1rem; }
        nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 0.5rem; }
        nav a { margin-left: 0.75rem; white-space: nowrap; }
        .flash { padding: 0.75rem; border-radius: 4px; margin-bottom: 1rem; }
        .flash-error { background: #fee; color: #c00; }
        .flash-success { background: #efe; color: #060; }
        table { font-size: 0.9rem; }
        .table-wrap { overflow-x: auto; }
        .table-wrap table { white-space: nowrap; }
        details.inline-edit > summary { list-style: none; display: block; cursor: pointer; }
        details.inline-edit > summary::after { display: none !important; }
        details.inline-edit > summary::-webkit-details-marker { display: none; }
        details.inline-edit > summary::marker { display: none; content: ""; }
        details.inline-edit > summary:hover { text-decoration: underline; opacity: 0.8; }
        canvas { max-width: 100%; }
        @media (max-width: 768px) {
          div[style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
          nav a { margin-left: 0.4rem; font-size: 0.85rem; }
          table { display: block; overflow-x: auto; white-space: nowrap; }
        }
      `}</style>
    </head>
    <body>
      <nav>
        <strong>
          <a href="/">InBody 分析</a>
        </strong>
        {user ? (
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:0.25rem">
            <span>{user.name}</span>
            <a href="/upload">上傳</a>
            <a href="/dashboard">儀表板</a>
            <a href="/leaderboard">排行榜</a>
            <a href="/settings">設定</a>
            {user.isAdmin && <a href="/admin">管理</a>}
            <form method="post" action="/logout" style="display:inline;margin:0;margin-left:0.75rem;">
              <button type="submit" style="all:unset;color:var(--pico-primary);cursor:pointer;">
                登出
              </button>
            </form>
          </div>
        ) : (
          <a href="/login">登入</a>
        )}
      </nav>
      <main>{children}</main>
    </body>
  </html>
);
