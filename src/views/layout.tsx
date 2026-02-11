import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Icon } from "./icons";

export const Layout: FC<{ title?: string; user?: { name: string; isAdmin?: boolean } }> = ({
  title,
  user,
  children,
}) => (
  <>
  {raw('<!DOCTYPE html>')}
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
        /* ── Design System Variables ── */
        :root {
          --ib-primary: #f97316;
          --ib-primary-hover: #ea580c;
          --ib-primary-light: rgba(249,115,22,0.10);
          --ib-success: #10b981;
          --ib-danger: #ef4444;
          --ib-text-muted: #78716c;
          --ib-surface: rgba(255,247,237,0.5);
          --ib-border: rgba(214,188,150,0.3);
          --ib-gradient-primary: linear-gradient(135deg, #f97316, #f59e0b);
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --ib-text-muted: #a8a29e;
            --ib-surface: rgba(39,32,26,0.5);
            --ib-border: rgba(120,100,70,0.3);
          }
        }

        /* ── Layout ── */
        body { max-width: 900px; margin: 0 auto; padding: 1rem; }
        nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 0.5rem; }
        nav a { margin-left: 0.75rem; white-space: nowrap; }
        table { font-size: 0.9rem; }
        .table-wrap { overflow-x: auto; }
        .table-wrap table { white-space: nowrap; }
        canvas { max-width: 100%; }

        /* ── Flash Messages ── */
        .flash { padding: 0.75rem; border-radius: 8px; margin-bottom: 1rem; }
        .flash-error { background: rgba(239,68,68,0.08); color: var(--ib-danger); border: 1px solid rgba(239,68,68,0.2); }
        .flash-success { background: rgba(16,185,129,0.08); color: var(--ib-success); border: 1px solid rgba(16,185,129,0.2); }

        /* ── Card ── */
        .ib-card { background: var(--ib-surface); border: 1px solid var(--ib-border); border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; }

        /* ── Buttons ── */
        .btn-primary {
          display: inline-flex; align-items: center; gap: 0.5rem; justify-content: center;
          background: var(--ib-gradient-primary); color: #fff; border: none;
          padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600;
          cursor: pointer; text-decoration: none; font-size: 1rem;
          transition: opacity 0.15s, transform 0.15s;
          box-shadow: 0 2px 8px rgba(249,115,22,0.25);
        }
        .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); color: #fff; }
        .btn-primary:active { transform: translateY(0); }

        .btn-outline {
          display: inline-flex; align-items: center; gap: 0.5rem; justify-content: center;
          background: transparent; color: var(--ib-primary); border: 1.5px solid var(--ib-primary);
          padding: 0.5rem 1rem; border-radius: 8px; font-weight: 500;
          cursor: pointer; text-decoration: none; font-size: 0.9rem;
          transition: background 0.15s, color 0.15s;
        }
        .btn-outline:hover { background: var(--ib-primary-light); color: var(--ib-primary); }

        .btn-success {
          display: inline-flex; align-items: center; gap: 0.5rem; justify-content: center;
          background: var(--ib-success); color: #fff; border: none;
          padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600;
          cursor: pointer; text-decoration: none; font-size: 1rem;
          transition: opacity 0.15s;
        }
        .btn-success:hover { opacity: 0.9; color: #fff; }

        .btn-logout {
          all: unset; display: inline-flex; align-items: center; gap: 0.3rem;
          color: var(--ib-text-muted); cursor: pointer; font-size: 0.85rem;
          transition: color 0.15s;
        }
        .btn-logout:hover { color: var(--ib-danger); }

        /* ── Prompt / Suggestion ── */
        .ib-prompt {
          display: flex; align-items: center; gap: 0.75rem;
          background: var(--ib-primary-light); border: 1px solid var(--ib-border);
          border-radius: 10px; padding: 1rem 1.25rem;
          margin-bottom: 1rem;
        }
        .ib-prompt .ib-prompt-icon { flex-shrink: 0; color: var(--ib-primary); }
        .ib-prompt .ib-prompt-text { flex: 1; font-size: 0.95rem; }

        /* ── Locked Block ── */
        .ib-locked {
          position: relative; border-radius: 12px; overflow: hidden; margin-bottom: 1rem;
        }
        .ib-locked-blur { filter: blur(4px); pointer-events: none; user-select: none; }
        .ib-locked-overlay {
          position: absolute; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 0.5rem;
          background: rgba(255,255,255,0.6); z-index: 1;
        }
        @media (prefers-color-scheme: dark) {
          .ib-locked-overlay { background: rgba(30,30,30,0.6); }
        }

        /* ── Progress Bar ── */
        .ib-progress-track {
          width: 100%; height: 8px; border-radius: 4px;
          background: var(--ib-border); overflow: hidden;
        }
        .ib-progress-fill {
          height: 100%; border-radius: 4px;
          background: var(--ib-gradient-primary);
          transition: width 0.3s ease;
        }

        /* ── Hero Section ── */
        .hero-section {
          display: flex; gap: 1.5rem; align-items: center;
          padding: 1.25rem;
          background: var(--ib-surface);
          border: 1px solid var(--ib-border);
          border-radius: 12px; margin-bottom: 1.5rem;
        }
        .hero-upload { text-align: center; flex-shrink: 0; }

        /* ── Nav Brand ── */
        .nav-brand { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--ib-primary); text-decoration: none; }
        .nav-brand:hover { color: var(--ib-primary-hover); }

        /* ── Responsive ── */
        @media (max-width: 768px) {
          div[style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
          nav a { margin-left: 0.4rem; font-size: 0.85rem; }
          table { display: block; overflow-x: auto; white-space: nowrap; }
          .hero-section { flex-direction: column; }
          .hero-upload { width: 100%; }
        }
      `}</style>
    </head>
    <body>
      <nav>
        <strong>
          <a href="/" class="nav-brand">
            <Icon name="activity" size={22} color="var(--ib-primary)" />
            InBody 分析
          </a>
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
              <button type="submit" class="btn-logout">
                <Icon name="log-out" size={16} />
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
  </>
);
