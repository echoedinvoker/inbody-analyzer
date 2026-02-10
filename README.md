# InBody 報告分析系統

私人小團體用的 InBody 身體組成報告分析系統。上傳 InBody 報告照片 → AI 視覺辨識提取數據 → 歷史趨勢圖表 → AI 個人化建議 → 團體排名與減脂比賽。

## 功能

- **AI 數據提取**：拍照上傳 InBody 報告，Claude Vision 自動識別數據，支援人工校正
- **個人儀表板**：趨勢折線圖（體重/骨骼肌/體脂率）、身體組成雷達圖、前後差異摘要
- **AI 個人化建議**：根據歷史趨勢和目標，用 Claude Haiku 生成飲食/訓練建議
- **團體排行榜**：體脂率/骨骼肌/InBody 分數變化排名，團體趨勢對比圖
- **遊戲化機制**：
  - 減脂比賽進度條 + 乳清預測器（預測誰要買乳清蛋白）
  - 漸進解鎖（上傳越多解鎖越多功能）
  - 里程碑徽章系統（8 種成就徽章）
  - 動態牆（看到別人在努力）
- **管理員功能**：邀請碼管理、使用者管理、比賽日期設定

## 技術架構

- **Runtime**: [Bun](https://bun.sh)
- **Web Framework**: [Hono](https://hono.dev) (SSR with JSX)
- **Database**: SQLite (`bun:sqlite`) + [Drizzle ORM](https://orm.drizzle.team)
- **AI**: Claude Vision (數據提取) + Claude Haiku (建議生成)
- **Charts**: [Chart.js v4](https://www.chartjs.org) (CDN)
- **CSS**: [Pico CSS v2](https://picocss.com) (CDN)
- **Deploy**: [Fly.io](https://fly.io) (Volume 持久化 SQLite + 照片)

## 環境變數

### 本地開發 (`.env`)

```bash
# [必要] Anthropic API Key — 用於 AI 數據提取和建議生成
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxx

# [必要] Session 簽名密鑰 — 任意字串，用於 cookie session 安全性
SESSION_SECRET=your-secret-here

# [可選] SQLite 資料庫路徑（預設: ./data/inbody.db）
DATABASE_PATH=./data/inbody.db

# [可選] 伺服器埠號（預設: 3000）
PORT=3000
```

### Fly.io 部署 (Secrets + fly.toml)

以下透過 `flyctl secrets set` 設定：

```bash
# [必要] Anthropic API Key
flyctl secrets set ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxx

# [必要] Session 簽名密鑰 — 正式環境請用強隨機字串
flyctl secrets set SESSION_SECRET=$(openssl rand -hex 32)

# [必要] 管理員邀請碼 — 首次登入用，之後可在管理面板改
flyctl secrets set ADMIN_INVITE_CODE=your-admin-code
```

以下已在 `fly.toml` 中設定，不需額外操作：

```toml
[env]
  DATABASE_PATH = '/data/inbody.db'  # Volume 上的持久化路徑
  PORT = '3000'
```

### 環境變數說明

| 變數 | 必要性 | 說明 |
|------|--------|------|
| `ANTHROPIC_API_KEY` | 必要 | Anthropic API key，用於 Claude Vision 提取報告數據和 Haiku 生成建議 |
| `SESSION_SECRET` | 必要 | Cookie session 簽名密鑰，正式環境務必使用強隨機字串 |
| `ADMIN_INVITE_CODE` | 必要 (Fly.io) | 管理員首次登入的邀請碼，每次部署會自動同步到 DB |
| `DATABASE_PATH` | 可選 | SQLite 檔案路徑。本地預設 `./data/inbody.db`，Fly.io 設為 `/data/inbody.db` |
| `PORT` | 可選 | 伺服器埠號，預設 `3000` |

## 本地開發

```bash
# 安裝依賴
bun install

# 建立 .env（參考上方環境變數說明）
cp .env.example .env
# 編輯 .env 填入你的 ANTHROPIC_API_KEY

# 啟動開發伺服器（含 hot reload）
bun run dev

# 開啟瀏覽器
open http://localhost:3000
```

### 資料庫操作

```bash
# 執行 migration
bun run db:migrate

# 重置資料庫（刪除重建 + seed）
bun run db:reset

# 塞入 demo 資料（5 位測試使用者）
bun run scripts/seed-demo.ts
```

## 部署到 Fly.io

```bash
# 首次設定
flyctl apps create inbody-analyzer
flyctl volumes create inbody_data --size 1 --region nrt
flyctl secrets set ANTHROPIC_API_KEY=sk-ant-... SESSION_SECRET=... ADMIN_INVITE_CODE=...

# 部署
flyctl deploy

# 後續更新
flyctl deploy
```

## 專案結構

```
src/
├── index.ts              # Hono app 入口
├── db/
│   ├── schema.ts         # Drizzle ORM schema（users, reports, measurements, badges, ...）
│   ├── index.ts          # DB 連線
│   └── migrate.ts        # Migration runner + admin 初始化
├── lib/
│   ├── extract.ts        # Claude Vision 數據提取
│   ├── advice.ts         # Claude Haiku AI 建議生成
│   ├── predict.ts        # 線性回歸預測引擎
│   ├── badges.ts         # 徽章判定引擎
│   └── session.ts        # Session middleware + auth
├── routes/
│   ├── dashboard.tsx      # 個人儀表板（趨勢圖、雷達圖、預測、徽章）
│   ├── reports.tsx        # 上傳、AI 提取、校正確認
│   ├── history.tsx        # 歷史報告列表 + 詳情
│   ├── leaderboard.tsx    # 排行榜 + 乳清預測器
│   ├── settings.tsx       # 使用者目標設定
│   ├── admin.tsx          # 管理員面板
│   └── auth.tsx           # 登入/登出
└── views/
    └── layout.tsx         # HTML Layout（Pico CSS + nav）
```
