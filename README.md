# InBody 報告分析系統

**拍照上傳 InBody 報告 → AI 自動辨識數據 → 歷史趨勢圖表 → 團體排名比較**

私人健身團體用的體態追蹤系統。6 人使用中。

**[Live Demo](https://inbody-analyzer.fly.dev)** — 點「以訪客身份體驗」即可試用完整功能

---

## 功能展示

### AI 數據提取
手機拍照上傳 InBody 報告，Claude Vision 自動識別所有數據欄位，使用者校正後存入資料庫。支援 JPEG / PNG / HEIC。

### 個人儀表板
- 體重、骨骼肌、體脂肪、體脂率獨立趨勢圖
- 體脂率預測延伸線（線性回歸）+ 目標線
- 身體組成雷達圖（最新 vs 上次）
- AI 個人化飲食/訓練建議（Claude Haiku）

### 團體排行榜
- 體脂率 / 骨骼肌 / InBody 分數變化排名
- 乳清預測器：預測誰要買乳清蛋白送給誰
- 團體趨勢疊加折線圖

### 遊戲化設計（八角框架）
- 減脂比賽進度條 + 預測排名
- 漸進解鎖：上傳越多解鎖越多功能（趨勢圖 → 預測 → AI 建議）
- 里程碑徽章系統（8 種成就）
- Win State 慶祝頁：確認數據後的正向回饋
- 動態牆：社交 FOMO 驅動回訪
- 遊戲迴圈加速器：每個完成狀態都引導下一步行動

---

## 技術架構

| 層 | 技術 |
|----|------|
| Runtime | [Bun](https://bun.sh) |
| Web Framework | [Hono](https://hono.dev)（SSR with JSX） |
| Database | SQLite（`bun:sqlite`）+ [Drizzle ORM](https://orm.drizzle.team) |
| AI 數據提取 | Claude Sonnet 4.5（Vision） |
| AI 建議生成 | Claude Haiku 4.5 |
| 圖表 | [Chart.js v4](https://www.chartjs.org) |
| CSS | [Pico CSS v2](https://picocss.com) |
| 部署 | [Fly.io](https://fly.io)（Volume 持久化） |

**設計哲學**：零前端 build pipeline。Hono JSX 做 SSR，Pico CSS + Chart.js 走 CDN，全端一個 TypeScript 檔案就能跑。適合 < 50 人的工具型應用。

---

## 部署

```bash
# Fly.io
flyctl apps create inbody-analyzer
flyctl volumes create inbody_data --size 1 --region nrt
flyctl secrets set ANTHROPIC_API_KEY=... SESSION_SECRET=... ADMIN_INVITE_CODE=...
flyctl deploy
```

## 本地開發

```bash
bun install
cp .env.example .env  # 填入 ANTHROPIC_API_KEY
bun run dev
```
