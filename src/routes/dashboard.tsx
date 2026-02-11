import { Hono } from "hono";
import { eq, desc, sql } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth, type SessionUser } from "../lib/session.ts";
import { getAdvice } from "../lib/advice.ts";
import { predictUser, predictAll } from "../lib/predict.ts";
import { getUserBadges } from "../lib/badges.ts";
import { Layout } from "../views/layout.tsx";

const dashboard = new Hono();

dashboard.get("/dashboard", async (c) => {
  const user = requireAuth(c);

  // Get recent activity across all users (for feed)
  const recentActivity = db
    .select({
      userName: schema.users.name,
      userId: schema.reports.userId,
      measuredAt: schema.reports.measuredAt,
    })
    .from(schema.reports)
    .innerJoin(schema.users, eq(schema.reports.userId, schema.users.id))
    .where(eq(schema.reports.confirmed, true))
    .orderBy(desc(schema.reports.measuredAt))
    .limit(10)
    .all();

  // Get prediction for this user
  const myPrediction = predictUser(user.id);
  const allPredictions = predictAll();
  const myRank = myPrediction
    ? allPredictions.findIndex((p) => p.userId === user.id) + 1
    : null;
  const totalPredicted = allPredictions.length;

  // Get user's badges
  const myBadges = getUserBadges(user.id);

  // Get all confirmed measurements for this user, ordered by date
  const rows = db
    .select({
      reportId: schema.reports.id,
      measuredAt: schema.reports.measuredAt,
      weight: schema.measurements.weight,
      skeletalMuscle: schema.measurements.skeletalMuscle,
      bodyFatMass: schema.measurements.bodyFatMass,
      bodyFatPct: schema.measurements.bodyFatPct,
      bmi: schema.measurements.bmi,
      totalBodyWater: schema.measurements.totalBodyWater,
      visceralFatLevel: schema.measurements.visceralFatLevel,
      basalMetabolicRate: schema.measurements.basalMetabolicRate,
      inbodyScore: schema.measurements.inbodyScore,
    })
    .from(schema.measurements)
    .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
    .where(eq(schema.reports.userId, user.id))
    .orderBy(schema.reports.measuredAt)
    .all();

  if (rows.length === 0) {
    return c.html(
      <Layout title="儀表板" user={user}>
        {/* Hero: empty state */}
        <div style="text-align:center;padding:3rem 1rem;background:var(--pico-card-background-color);border-radius:12px;margin-bottom:1.5rem;">
          <div style="font-size:3rem;margin-bottom:0.5rem;">📸</div>
          <h2 style="margin:0 0 0.5rem;">開始你的比賽之旅</h2>
          <p style="opacity:0.7;margin:0 0 1.5rem;">上傳你的第一份 InBody 報告，建立基準數據。</p>
          <a href="/upload" role="button" style="font-size:1.1rem;padding:0.75rem 2.5rem;">
            上傳 InBody 報告
          </a>
        </div>
        <ActivityFeed activities={recentActivity} currentUserId={user.id} collapsed={true} />
      </Layout>
    );
  }

  const latest = rows[rows.length - 1]!;
  const prev = rows.length >= 2 ? rows[rows.length - 2]! : null;

  // Prepare chart data as JSON for client-side Chart.js
  const chartData = {
    labels: rows.map((r) => r.measuredAt?.slice(0, 10) || ""),
    weight: rows.map((r) => r.weight),
    skeletalMuscle: rows.map((r) => r.skeletalMuscle),
    bodyFatMass: rows.map((r) => r.bodyFatMass),
    bodyFatPct: rows.map((r) => r.bodyFatPct),
    bmi: rows.map((r) => r.bmi),
    inbodyScore: rows.map((r) => r.inbodyScore),
  };

  // Radar chart data: normalize to 0-100 scale for comparison
  const radarLatest = {
    weight: latest.weight,
    skeletalMuscle: latest.skeletalMuscle,
    bodyFatPct: latest.bodyFatPct,
    bmi: latest.bmi,
    inbodyScore: latest.inbodyScore,
  };
  const radarPrev = prev
    ? {
        weight: prev.weight,
        skeletalMuscle: prev.skeletalMuscle,
        bodyFatPct: prev.bodyFatPct,
        bmi: prev.bmi,
        inbodyScore: prev.inbodyScore,
      }
    : null;

  // Get user goals for target line
  const userGoals = db
    .select()
    .from(schema.userGoals)
    .where(eq(schema.userGoals.userId, user.id))
    .get();

  // Prediction data for chart extension
  const predictionChartData = myPrediction && user.competitionEnd
    ? {
        endDate: user.competitionEnd,
        predictedFatPct: myPrediction.predictedFatPct,
        targetFatPct: userGoals?.targetBodyFatPct ?? null,
      }
    : null;

  // Feature unlock tiers based on report count
  const reportCount = rows.length;
  const unlockTrends = reportCount >= 2;
  const unlockFull = reportCount >= 4;

  // Get AI advice only if fully unlocked
  let advice: string | null = null;
  if (unlockFull) {
    try {
      advice = await getAdvice(user.id);
    } catch (e: any) {
      console.error("Advice generation failed:", e.message);
    }
  }

  // Calculate last upload time for game loop accelerator
  const lastUploadDate = rows[rows.length - 1]?.measuredAt;
  const daysSinceUpload = lastUploadDate
    ? Math.floor((Date.now() - new Date(lastUploadDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return c.html(
    <Layout title="儀表板" user={user}>
      {/* Hero section: competition status + prominent upload CTA (Desert Oasis) */}
      <div style="display:grid;grid-template-columns:1fr auto;gap:1.5rem;align-items:center;padding:1.25rem;background:var(--pico-card-background-color);border-radius:12px;margin-bottom:1.5rem;">
        <div>
          <CompetitionProgress user={user} prediction={myPrediction} rank={myRank} totalPredicted={totalPredicted} />
          {myBadges.length > 0 && <BadgeDisplay badges={myBadges} />}
        </div>
        {/* THE oasis: the one thing that stands out */}
        <div style="text-align:center;">
          <a href="/upload" role="button" style="font-size:1.1rem;padding:1rem 1.5rem;white-space:nowrap;display:block;">
            📸 上傳新報告
          </a>
          <div style="font-size:0.75rem;opacity:0.5;margin-top:0.5rem;">
            <a href="/reports" style="opacity:0.7;">歷史紀錄</a>
          </div>
        </div>
      </div>

      {/* Activity feed - collapsed by default */}
      <ActivityFeed activities={recentActivity} currentUserId={user.id} collapsed={true} />

      {/* Diff summary */}
      <div style="margin-bottom:1.5rem;">
        <h3 style="font-size:1rem;margin-bottom:0.5rem;opacity:0.8;">最新數據</h3>
        <DiffSummary latest={latest} prev={prev} />
      </div>

      {/* Trend charts - unlock at 2 reports */}
      {unlockTrends ? (
        <div>
          <h3>趨勢圖表</h3>
          <div style="margin-bottom:2rem;">
            <canvas id="trendChart" height="100"></canvas>
          </div>
          <div style="margin-bottom:2rem;">
            <canvas id="fatPctChart" height="60"></canvas>
          </div>
        </div>
      ) : (
        <LockedBlock
          title="趨勢圖表"
          message={`再上傳 ${2 - reportCount} 筆即可解鎖趨勢圖和預測功能`}
        />
      )}

      {/* Radar chart + AI Advice - unlock at 4 reports */}
      {unlockFull ? (
        <div>
          <h3>身體組成對比{prev ? "（最新 vs 上次）" : ""}</h3>
          <div style="max-width:450px;margin:0 auto 2rem;">
            <canvas id="radarChart"></canvas>
          </div>
          {advice && (
            <div style="margin-bottom:2rem;padding:1.5rem;background:var(--pico-card-background-color);border-radius:8px;">
              <h3>AI 建議</h3>
              <div dangerouslySetInnerHTML={{ __html: markdownToHtml(advice) }} />
            </div>
          )}
        </div>
      ) : unlockTrends ? (
        <LockedBlock
          title="雷達圖 & AI 深度分析"
          message={`再上傳 ${4 - reportCount} 筆即可解鎖雷達圖和 AI 個人化建議`}
        />
      ) : null}

      {/* Game Loop Accelerator: "next step" suggestion */}
      <NextStepSuggestion
        reportCount={reportCount}
        daysSinceUpload={daysSinceUpload}
        hasGoal={!!userGoals}
        prediction={myPrediction}
        rank={myRank}
        totalPredicted={totalPredicted}
      />

      {/* Chart.js scripts - only load if needed */}
      {unlockTrends && (
        <div>
          <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
          <script
            dangerouslySetInnerHTML={{
              __html: buildChartScript(chartData, radarLatest, unlockFull ? radarPrev : null, predictionChartData),
            }}
          />
        </div>
      )}
    </Layout>
  );
});

// --- Next Step Suggestion (Game Loop Accelerator) ---

function NextStepSuggestion({
  reportCount,
  daysSinceUpload,
  hasGoal,
  prediction,
  rank,
  totalPredicted,
}: {
  reportCount: number;
  daysSinceUpload: number | null;
  hasGoal: boolean;
  prediction: Prediction | null;
  rank: number | null;
  totalPredicted: number;
}) {
  // Determine the most relevant next action
  let icon = "💡";
  let message = "";
  let linkText = "";
  let linkHref = "";

  if (!hasGoal) {
    icon = "🎯";
    message = "設定你的減脂目標，AI 建議將依照目標量身打造";
    linkText = "設定目標";
    linkHref = "/settings";
  } else if (reportCount < 2) {
    icon = "📈";
    message = `再上傳 ${2 - reportCount} 筆即可解鎖趨勢圖和預測功能`;
    linkText = "上傳報告";
    linkHref = "/upload";
  } else if (reportCount < 4) {
    icon = "🤖";
    message = `再 ${4 - reportCount} 筆就能解鎖 AI 個人化建議`;
    linkText = "上傳報告";
    linkHref = "/upload";
  } else if (daysSinceUpload != null && daysSinceUpload >= 7) {
    icon = "⏰";
    message = `距離上次測量已 ${daysSinceUpload} 天，是時候看看最新進展了`;
    linkText = "上傳新報告";
    linkHref = "/upload";
  } else if (rank != null && totalPredicted > 0) {
    const winnerCount = Math.min(3, Math.floor(totalPredicted / 2));
    const loserStart = totalPredicted - winnerCount;
    if (rank > loserStart) {
      icon = "⚠️";
      message = "你目前在危險區！上傳更多數據可能改變預測結果";
      linkText = "上傳新報告";
      linkHref = "/upload";
    } else {
      icon = "🏆";
      message = "你在安全區！到排行榜看看其他人的最新狀況";
      linkText = "查看排行榜";
      linkHref = "/leaderboard";
    }
  } else {
    return null; // No suggestion needed
  }

  return (
    <div style="margin:2rem 0;padding:1rem 1.25rem;border-radius:8px;border:1px solid var(--pico-muted-border-color);display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
      <span style="font-size:1.5rem;">{icon}</span>
      <span style="flex:1;font-size:0.9rem;">{message}</span>
      <a href={linkHref} role="button" class="outline" style="white-space:nowrap;font-size:0.85rem;padding:0.4rem 1rem;">
        {linkText}
      </a>
    </div>
  );
}

// --- Diff Summary Component ---

type Row = {
  weight: number | null;
  skeletalMuscle: number | null;
  bodyFatMass: number | null;
  bodyFatPct: number | null;
  bmi: number | null;
  totalBodyWater: number | null;
  visceralFatLevel: number | null;
  basalMetabolicRate: number | null;
  inbodyScore: number | null;
};

function DiffSummary({ latest, prev }: { latest: Row; prev: Row | null }) {
  const metrics: {
    label: string;
    key: keyof Row;
    unit: string;
    higherIsGood: boolean;
  }[] = [
    { label: "體重", key: "weight", unit: "kg", higherIsGood: false },
    { label: "骨骼肌", key: "skeletalMuscle", unit: "kg", higherIsGood: true },
    { label: "體脂肪", key: "bodyFatMass", unit: "kg", higherIsGood: false },
    { label: "體脂率", key: "bodyFatPct", unit: "%", higherIsGood: false },
    { label: "BMI", key: "bmi", unit: "", higherIsGood: false },
    { label: "InBody 分數", key: "inbodyScore", unit: "", higherIsGood: true },
    { label: "基礎代謝", key: "basalMetabolicRate", unit: "kcal", higherIsGood: true },
  ];

  return (
    <table>
      <thead>
        <tr>
          <th>指標</th>
          <th>最新</th>
          {prev && <th>上次</th>}
          {prev && <th>變化</th>}
        </tr>
      </thead>
      <tbody>
        {metrics.map(({ label, key, unit, higherIsGood }) => {
          const cur = latest[key] as number | null;
          const pre = prev ? (prev[key] as number | null) : null;
          const diff = cur != null && pre != null ? cur - pre : null;
          const arrow = diff == null ? "" : diff > 0 ? " ↑" : diff < 0 ? " ↓" : " →";
          const isGood =
            diff == null
              ? null
              : higherIsGood
                ? diff > 0
                : diff < 0;
          const color = isGood === null ? "" : isGood ? "green" : diff === 0 ? "" : "red";

          return (
            <tr>
              <td>{label}</td>
              <td>
                {cur != null ? `${cur} ${unit}` : "—"}
              </td>
              {prev && (
                <td>{pre != null ? `${pre} ${unit}` : "—"}</td>
              )}
              {prev && (
                <td style={color ? `color:${color};font-weight:bold` : ""}>
                  {diff != null ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)}${arrow}` : "—"}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// --- Chart.js Script Builder ---

function buildChartScript(
  chartData: any,
  radarLatest: any,
  radarPrev: any | null,
  predictionData: { endDate: string; predictedFatPct: number; targetFatPct: number | null } | null
): string {
  return `
    const data = ${JSON.stringify(chartData)};
    const radarLatest = ${JSON.stringify(radarLatest)};
    const radarPrev = ${JSON.stringify(radarPrev)};
    const prediction = ${JSON.stringify(predictionData)};

    // Trend chart: weight + skeletal muscle + body fat mass
    new Chart(document.getElementById('trendChart'), {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [
          {
            label: '體重 (kg)',
            data: data.weight,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.1)',
            yAxisID: 'y',
            tension: 0.3,
          },
          {
            label: '骨骼肌 (kg)',
            data: data.skeletalMuscle,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.1)',
            yAxisID: 'y',
            tension: 0.3,
          },
          {
            label: '體脂肪 (kg)',
            data: data.bodyFatMass,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.1)',
            yAxisID: 'y',
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: { title: { display: true, text: '體重 / 骨骼肌 / 體脂肪 趨勢' } },
        scales: {
          y: { type: 'linear', position: 'left', title: { display: true, text: 'kg' } },
        },
      },
    });

    // Body fat % trend with prediction extension
    const fatLabels = [...data.labels];
    const fatActual = [...data.bodyFatPct];
    const fatPredicted = new Array(data.labels.length).fill(null);
    const fatTarget = [];

    if (prediction && data.bodyFatPct.length >= 2) {
      // Add prediction point: dashed line from last actual to predicted end
      const endLabel = prediction.endDate.slice(0, 10);
      fatLabels.push(endLabel);
      fatActual.push(null);
      // Prediction line: starts from last actual value, ends at predicted
      fatPredicted[fatPredicted.length - 1] = data.bodyFatPct[data.bodyFatPct.length - 1];
      fatPredicted.push(prediction.predictedFatPct);
    }

    const fatDatasets = [
      {
        label: '體脂率 (%)',
        data: fatActual,
        borderColor: '#f97316',
        backgroundColor: 'rgba(249,115,22,0.15)',
        fill: true,
        tension: 0.3,
      },
    ];

    if (prediction && data.bodyFatPct.length >= 2) {
      fatDatasets.push({
        label: '預測趨勢',
        data: fatPredicted,
        borderColor: '#f97316',
        borderDash: [6, 4],
        backgroundColor: 'rgba(249,115,22,0.05)',
        fill: false,
        tension: 0,
        pointStyle: 'triangle',
        pointRadius: 5,
      });
    }

    if (prediction && prediction.targetFatPct != null) {
      const targetLine = fatLabels.map(() => prediction.targetFatPct);
      fatDatasets.push({
        label: '目標體脂率',
        data: targetLine,
        borderColor: '#22c55e',
        borderDash: [3, 3],
        backgroundColor: 'transparent',
        fill: false,
        tension: 0,
        pointRadius: 0,
        borderWidth: 2,
      });
    }

    new Chart(document.getElementById('fatPctChart'), {
      type: 'line',
      data: { labels: fatLabels, datasets: fatDatasets },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: prediction ? '體脂率趨勢（含預測）' : '體脂率趨勢' },
          legend: { position: 'bottom' },
        },
        scales: {
          y: { title: { display: true, text: '%' } },
        },
      },
    });

    // Radar chart
    const radarLabels = ['體重', '骨骼肌', '體脂率(反)', 'BMI', 'InBody分數'];
    // Normalize: use latest values as 100% baseline for single-point, or scale to reasonable range
    function normalize(val, key) {
      const ranges = {
        weight: [40, 120],
        skeletalMuscle: [15, 45],
        bodyFatPct: [5, 40],
        bmi: [15, 35],
        inbodyScore: [40, 100],
      };
      const [min, max] = ranges[key] || [0, 100];
      if (val == null) return 0;
      let n = ((val - min) / (max - min)) * 100;
      // Invert body fat % (lower is better)
      if (key === 'bodyFatPct') n = 100 - n;
      return Math.max(0, Math.min(100, n));
    }

    const keys = ['weight', 'skeletalMuscle', 'bodyFatPct', 'bmi', 'inbodyScore'];
    const radarDatasets = [{
      label: '最新',
      data: keys.map(k => normalize(radarLatest[k], k)),
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.2)',
    }];
    if (radarPrev) {
      radarDatasets.push({
        label: '上次',
        data: keys.map(k => normalize(radarPrev[k], k)),
        borderColor: '#94a3b8',
        backgroundColor: 'rgba(148,163,184,0.15)',
      });
    }

    new Chart(document.getElementById('radarChart'), {
      type: 'radar',
      data: { labels: radarLabels, datasets: radarDatasets },
      options: {
        responsive: true,
        scales: { r: { min: 0, max: 100, ticks: { display: false } } },
        plugins: { legend: { position: 'bottom' } },
      },
    });
  `;
}

// Simple markdown to HTML (handles headers, bold, lists, paragraphs)
function markdownToHtml(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^\- (.+)$/gm, "<li>$1</li>")
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, "<br><br>")
    .replace(/\n/g, "<br>");
}

// --- Locked Block Component ---

function LockedBlock({ title, message }: { title: string; message: string }) {
  return (
    <div style="position:relative;margin-bottom:2rem;padding:2rem 1.5rem;background:var(--pico-card-background-color);border-radius:8px;text-align:center;">
      <div style="filter:blur(3px);opacity:0.3;pointer-events:none;">
        <h3>{title}</h3>
        <div style="height:80px;background:var(--pico-muted-border-color);border-radius:4px;" />
      </div>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:90%;">
        <p style="margin:0;font-size:1rem;">🔒 {message}</p>
        <a href="/upload" style="font-size:0.9rem;">上傳報告</a>
      </div>
    </div>
  );
}

// --- Badge Display Component ---

function BadgeDisplay({ badges }: { badges: { type: string; label: string; earnedAt: string }[] }) {
  return (
    <div style="margin-bottom:1.5rem;padding:0.75rem 1rem;background:var(--pico-card-background-color);border-radius:8px;">
      <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
        <strong style="font-size:0.85rem;">徽章：</strong>
        {badges.map((b) => (
          <span
            title={`${b.label.slice(2).trim()} — ${b.earnedAt.slice(0, 10)}`}
            style="font-size:1.2rem;cursor:default;"
          >
            {b.label.slice(0, 2)}
          </span>
        ))}
      </div>
    </div>
  );
}

// --- Activity Feed Component ---

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return dateStr.slice(0, 10);
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  const weeks = Math.floor(days / 7);
  return `${weeks} 週前`;
}

function ActivityFeed({
  activities,
  currentUserId,
  collapsed,
}: {
  activities: { userName: string; userId: number; measuredAt: string }[];
  currentUserId: number;
  collapsed?: boolean;
}) {
  if (activities.length === 0) return null;

  const shown = collapsed ? activities.slice(0, 3) : activities;
  const hasMore = collapsed && activities.length > 3;

  return (
    <div style="margin-bottom:1.5rem;">
      <h4 style="margin-bottom:0.5rem;font-size:0.9rem;opacity:0.7;">最近動態</h4>
      <div style="background:var(--pico-card-background-color);border-radius:8px;padding:0.5rem 0.75rem;font-size:0.9rem;">
        {shown.map((a) => {
          const isMe = a.userId === currentUserId;
          return (
            <div style={`display:flex;justify-content:space-between;align-items:center;padding:0.3rem 0;${isMe ? 'background:rgba(59,130,246,0.06);margin:0 -0.5rem;padding-left:0.5rem;padding-right:0.5rem;border-radius:4px;' : ''}`}>
              <span>
                <strong>{isMe ? "你" : a.userName}</strong> 上傳了新數據
              </span>
              <span style="font-size:0.75rem;opacity:0.5;white-space:nowrap;margin-left:1rem;">
                {relativeTime(a.measuredAt)}
              </span>
            </div>
          );
        })}
        {hasMore && (
          <details style="margin-top:0.25rem;">
            <summary style="font-size:0.8rem;opacity:0.5;cursor:pointer;">更多動態</summary>
            {activities.slice(3).map((a) => {
              const isMe = a.userId === currentUserId;
              return (
                <div style={`display:flex;justify-content:space-between;align-items:center;padding:0.3rem 0;`}>
                  <span>
                    <strong>{isMe ? "你" : a.userName}</strong> 上傳了新數據
                  </span>
                  <span style="font-size:0.75rem;opacity:0.5;white-space:nowrap;margin-left:1rem;">
                    {relativeTime(a.measuredAt)}
                  </span>
                </div>
              );
            })}
          </details>
        )}
      </div>
    </div>
  );
}

// --- Competition Progress Component ---

import type { Prediction } from "../lib/predict.ts";

function CompetitionProgress({
  user,
  prediction,
  rank,
  totalPredicted,
}: {
  user: SessionUser;
  prediction: Prediction | null;
  rank: number | null;
  totalPredicted: number;
}) {
  const { competitionStart, competitionEnd } = user;

  if (!competitionStart || !competitionEnd) {
    return (
      <div style="margin-bottom:0.5rem;">
        <p style="margin:0;opacity:0.7;font-size:0.9rem;">上傳第一份報告開始比賽</p>
      </div>
    );
  }

  const now = new Date();
  const start = new Date(competitionStart);
  const end = new Date(competitionEnd);
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const elapsedDays = Math.round((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const remainingDays = Math.max(0, Math.round((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  const pct = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
  const isFinished = now > end;

  const winnerCount = Math.min(3, Math.floor(totalPredicted / 2));
  const loserStart = totalPredicted - winnerCount;
  const inDanger = rank != null && rank > loserStart;
  const isSafe = rank != null && rank <= winnerCount;

  return (
    <div style="margin-bottom:0.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
        <strong style="font-size:0.9rem;">{isFinished ? "比賽已結束" : "減脂比賽"}</strong>
        <span style="font-size:0.75rem;opacity:0.6;">剩餘 {remainingDays} 天</span>
      </div>
      <div style="background:var(--pico-muted-border-color);border-radius:4px;height:0.6rem;overflow:hidden;margin-bottom:0.5rem;">
        <div style={`background:${isFinished ? '#22c55e' : '#3b82f6'};height:100%;width:${pct}%;border-radius:4px;`} />
      </div>

      {/* Rank and prediction - condensed */}
      {prediction && rank ? (
        <div style="font-size:0.85rem;">
          <span style={`font-weight:bold;color:${inDanger ? '#ef4444' : isSafe ? '#22c55e' : 'inherit'};`}>
            第 {rank} 名
          </span>
          <span style="opacity:0.6;"> / {totalPredicted} 人</span>
          <span style="opacity:0.5;margin-left:0.5rem;">
            預測 {prediction.predictedFatPct}%
          </span>
          {inDanger && <span style="color:#ef4444;margin-left:0.5rem;">⚠️</span>}
          {isSafe && <span style="color:#22c55e;margin-left:0.5rem;">✅</span>}
        </div>
      ) : (
        <p style="margin:0;font-size:0.8rem;opacity:0.5;">
          再上傳 1 筆即可解鎖預測
        </p>
      )}
    </div>
  );
}

export default dashboard;
