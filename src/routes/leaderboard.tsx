import { Hono } from "hono";
import { eq, sql, and, gte } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth, type SessionUser } from "../lib/session.ts";
import { predictAll, type Prediction } from "../lib/predict.ts";
import { getBadgeCount } from "../lib/badges.ts";
import { Layout } from "../views/layout.tsx";
import { Icon } from "../views/icons.tsx";

const leaderboard = new Hono();

type MetricKey = "bodyFatPct" | "skeletalMuscle" | "inbodyScore";

const METRIC_CONFIG: Record<
  MetricKey,
  { label: string; unit: string; lowerIsBetter: boolean }
> = {
  bodyFatPct: { label: "體脂率變化", unit: "%", lowerIsBetter: true },
  skeletalMuscle: { label: "骨骼肌變化", unit: "kg", lowerIsBetter: false },
  inbodyScore: { label: "InBody 分數變化", unit: "", lowerIsBetter: false },
};

leaderboard.get("/leaderboard", (c) => {
  const user = requireAuth(c);
  const period = c.req.query("period") || "90";
  const metric = (c.req.query("metric") || "bodyFatPct") as MetricKey;

  // Calculate date cutoff
  const days = period === "all" ? 0 : Number(period);
  const cutoff = days
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    : null;

  // Get all non-demo users with at least 2 confirmed measurements
  const allUsers = db.select().from(schema.users).all().filter((u) => !u.isDemo);

  type RankEntry = {
    userId: number;
    name: string;
    firstVal: number;
    lastVal: number;
    diff: number;
    count: number;
    badgeCount: number;
  };

  const rankings: RankEntry[] = [];
  // For group trend chart
  const trendData: Record<number, { name: string; points: { date: string; value: number }[] }> = {};

  for (const u of allUsers) {
    let query = db
      .select({
        measuredAt: schema.reports.measuredAt,
        bodyFatPct: schema.measurements.bodyFatPct,
        skeletalMuscle: schema.measurements.skeletalMuscle,
        inbodyScore: schema.measurements.inbodyScore,
      })
      .from(schema.measurements)
      .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
      .where(eq(schema.reports.userId, u.id))
      .orderBy(schema.reports.measuredAt)
      .all();

    // Filter by period
    if (cutoff) {
      query = query.filter((r) => (r.measuredAt || "") >= cutoff);
    }

    if (query.length < 2) continue;

    const first = query[0]!;
    const last = query[query.length - 1]!;
    const firstVal = first[metric] as number | null;
    const lastVal = last[metric] as number | null;

    if (firstVal == null || lastVal == null) continue;

    rankings.push({
      userId: u.id,
      name: u.name,
      firstVal,
      lastVal,
      diff: lastVal - firstVal,
      count: query.length,
      badgeCount: getBadgeCount(u.id),
    });

    // Collect trend data matching selected metric
    trendData[u.id] = {
      name: u.name,
      points: query
        .filter((r) => r[metric] != null)
        .map((r) => ({
          date: r.measuredAt?.slice(0, 10) || "",
          value: r[metric] as number,
        })),
    };
  }

  // Sort: for lowerIsBetter metrics, most negative diff first; otherwise most positive first
  const cfg = METRIC_CONFIG[metric]!;
  rankings.sort((a, b) => (cfg.lowerIsBetter ? a.diff - b.diff : b.diff - a.diff));

  // Whey predictions
  const predictions = predictAll();

  // Build chart data for group trend
  const colors = [
    "#f97316", "#10b981", "#ef4444", "#f59e0b", "#8b5cf6",
    "#ec4899", "#14b8a6", "#6366f1", "#0ea5e9", "#a8a29e",
  ];

  // Find my ranking entry
  const myEntry = rankings.find((r) => r.userId === user.id);
  const myRankIdx = myEntry ? rankings.indexOf(myEntry) : -1;

  return c.html(
    <Layout title="排行榜" user={user}>
      <h2>團體排行榜</h2>

      {/* My Position Hero Card */}
      {myEntry ? (
        <div class="ib-card" style="text-align:center;padding:1.5rem;">
          <div style="font-size:0.8rem;opacity:0.5;margin-bottom:0.25rem;">你的{cfg.label.replace("變化", "")}排名</div>
          <div style={`font-size:3rem;font-weight:bold;color:${myRankIdx < 3 ? 'var(--ib-success)' : myRankIdx >= rankings.length - 3 ? 'var(--ib-danger)' : 'inherit'};`}>
            第 {myRankIdx + 1} 名
          </div>
          <div style="font-size:0.9rem;opacity:0.7;">
            {myEntry.firstVal}{cfg.unit} → {myEntry.lastVal}{cfg.unit}
            <span style={`margin-left:0.5rem;font-weight:bold;color:${(cfg.lowerIsBetter ? myEntry.diff < 0 : myEntry.diff > 0) ? 'var(--ib-success)' : 'var(--ib-danger)'};`}>
              {myEntry.diff > 0 ? "+" : ""}{myEntry.diff.toFixed(1)}{cfg.unit}
            </span>
          </div>
          {myEntry.badgeCount > 0 && (
            <div style="font-size:0.8rem;opacity:0.5;margin-top:0.25rem;display:inline-flex;align-items:center;gap:0.3rem;">
              <Icon name="award" size={14} color="var(--ib-primary)" /> {myEntry.badgeCount} 個徽章
            </div>
          )}
        </div>
      ) : (
        <div class="ib-card" style="text-align:center;padding:1.5rem;">
          <div style="margin-bottom:0.5rem;"><Icon name="bar-chart-3" size={32} color="var(--ib-text-muted)" /></div>
          <p style="margin:0 0 0.5rem;opacity:0.7;">需要至少 2 筆數據才能加入排名</p>
          <a href="/upload" class="btn-outline" style="font-size:0.9rem;">上傳報告加入排名</a>
        </div>
      )}

      {/* Filters */}
      <form method="get" action="/leaderboard" style="display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
        <label style="flex:1;min-width:120px;">
          時間區間
          <select name="period" onchange="this.form.submit()">
            <option value="30" selected={period === "30"}>最近 30 天</option>
            <option value="90" selected={period === "90"}>最近 90 天</option>
            <option value="180" selected={period === "180"}>最近 180 天</option>
            <option value="all" selected={period === "all"}>全部</option>
          </select>
        </label>
        <label style="flex:1;min-width:120px;">
          排名指標
          <select name="metric" onchange="this.form.submit()">
            <option value="bodyFatPct" selected={metric === "bodyFatPct"}>體脂率變化</option>
            <option value="skeletalMuscle" selected={metric === "skeletalMuscle"}>骨骼肌變化</option>
            <option value="inbodyScore" selected={metric === "inbodyScore"}>InBody 分數變化</option>
          </select>
        </label>
      </form>

      {rankings.length === 0 ? (
        <p>目前沒有符合條件的排名（每位使用者需至少 2 筆數據）。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>使用者</th>
              <th>起始值</th>
              <th>最新值</th>
              <th>變化</th>
              <th>筆數</th>
            </tr>
          </thead>
          <tbody>
            {rankings.map((r, i) => {
              const isGood = cfg.lowerIsBetter ? r.diff < 0 : r.diff > 0;
              const color = r.diff === 0 ? "" : isGood ? "var(--ib-success)" : "var(--ib-danger)";
              const arrow = r.diff > 0 ? " ↑" : r.diff < 0 ? " ↓" : " →";
              const highlight = r.userId === user.id ? "font-weight:bold;background:var(--ib-primary-light);" : "";
              return (
                <tr style={highlight}>
                  <td>{i + 1}</td>
                  <td>
                    {r.name}{r.userId === user.id ? " (你)" : ""}
                    {r.badgeCount > 0 && (
                      <span title={`${r.badgeCount} 個徽章`} style="margin-left:0.3rem;font-size:0.8rem;opacity:0.7;display:inline-flex;align-items:center;gap:0.15rem;">
                        <Icon name="award" size={14} color="var(--ib-primary)" />{r.badgeCount}
                      </span>
                    )}
                  </td>
                  <td>{r.firstVal} {cfg.unit}</td>
                  <td>{r.lastVal} {cfg.unit}</td>
                  <td style={color ? `color:${color};font-weight:bold` : ""}>
                    {r.diff > 0 ? "+" : ""}{r.diff.toFixed(1)}{arrow}
                  </td>
                  <td>{r.count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Whey predictor */}
      <WheyPredictor predictions={predictions} currentUserId={user.id} />

      {/* Group trend chart */}
      {Object.keys(trendData).length > 0 && (
        <div>
          <h3>團體{cfg.label.replace("變化", "")}趨勢</h3>
          <canvas id="groupTrendChart" height="120"></canvas>
        </div>
      )}

      <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
      <script
        dangerouslySetInnerHTML={{
          __html: buildGroupChartScript(trendData, colors, cfg.label.replace("變化", ""), cfg.unit),
        }}
      />
    </Layout>
  );
});

function buildGroupChartScript(
  trendData: Record<number, { name: string; points: { date: string; value: number }[] }>,
  colors: string[],
  metricLabel: string,
  metricUnit: string
): string {
  // Collect all unique dates
  const allDates = new Set<string>();
  for (const u of Object.values(trendData)) {
    for (const p of u.points) allDates.add(p.date);
  }
  const sortedDates = [...allDates].sort();

  // Build datasets
  const datasets = Object.values(trendData).map((u, i) => {
    const dateMap = new Map(u.points.map((p) => [p.date, p.value]));
    return {
      label: u.name,
      data: sortedDates.map((d) => dateMap.get(d) ?? null),
      borderColor: colors[i % colors.length],
      tension: 0.3,
      spanGaps: true,
    };
  });

  // Average line
  const avgData = sortedDates.map((d) => {
    const vals = Object.values(trendData)
      .map((u) => u.points.find((p) => p.date === d)?.value)
      .filter((v) => v != null) as number[];
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  datasets.push({
    label: "團體平均",
    data: avgData,
    borderColor: "#a8a29e",
    tension: 0.3,
    spanGaps: true,
    borderDash: [5, 5],
  } as any);

  return `
    new Chart(document.getElementById('groupTrendChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(sortedDates)},
        datasets: ${JSON.stringify(datasets)},
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          title: { display: false },
          legend: { position: 'bottom' },
        },
        scales: {
          y: { title: { display: true, text: '${metricLabel}${metricUnit ? ` (${metricUnit})` : ""}' } },
        },
      },
    });
  `;
}

// --- Whey Predictor Component ---

function WheyPredictor({
  predictions,
  currentUserId,
}: {
  predictions: Prediction[];
  currentUserId: number;
}) {
  if (predictions.length === 0) {
    return (
      <div class="ib-card" style="margin:2rem 0;">
        <h3 style="margin-top:0;display:flex;align-items:center;gap:0.5rem;"><Icon name="milk" size={22} color="var(--ib-primary)" /> 乳清預測器</h3>
        <p style="opacity:0.7;">需要至少 2 筆數據才能預測，快去上傳吧！</p>
      </div>
    );
  }

  const total = predictions.length;
  // Top 3 win whey, bottom 3 buy whey (for 6 people competition)
  const winnerCount = Math.min(3, Math.floor(total / 2));
  const loserStart = total - winnerCount;

  return (
    <div class="ib-card" style="margin:2rem 0;">
      <h3 style="margin-top:0;display:flex;align-items:center;gap:0.5rem;"><Icon name="milk" size={22} color="var(--ib-primary)" /> 乳清預測器</h3>
      <p style="font-size:0.85rem;opacity:0.7;margin-bottom:1rem;">
        根據目前趨勢預測比賽結束時的體脂率變化，僅供參考。
      </p>
      <table>
        <thead>
          <tr>
            <th>預測排名</th>
            <th>姓名</th>
            <th>起始體脂</th>
            <th>目前體脂</th>
            <th>預測最終</th>
            <th>預測變化</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>
          {predictions.map((p, i) => {
            const isMe = p.userId === currentUserId;
            const isWinner = i < winnerCount;
            const isLoser = i >= loserStart;
            const bgColor = isWinner
              ? "rgba(34,197,94,0.08)"
              : isLoser
                ? "rgba(239,68,68,0.08)"
                : "";
            const rowStyle = `${isMe ? "font-weight:bold;" : ""}${bgColor ? `background:${bgColor};` : ""}`;

            let statusIcon = "";
            let statusText = "—";
            if (isWinner) { statusIcon = "gift"; statusText = "收到乳清"; }
            else if (isLoser) { statusIcon = "dumbbell"; statusText = "準備乳清"; }

            return (
              <tr style={rowStyle}>
                <td>{i + 1}</td>
                <td>{p.name}{isMe ? " (你)" : ""}</td>
                <td>{p.firstFatPct}%</td>
                <td>{p.currentFatPct}%</td>
                <td>{p.predictedFatPct}%</td>
                <td style={`color:${p.predictedChange < 0 ? "var(--ib-success)" : "var(--ib-danger)"};font-weight:bold`}>
                  {p.predictedChange > 0 ? "+" : ""}{p.predictedChange}%
                </td>
                <td style="white-space:nowrap;">
                  {statusIcon ? <><Icon name={statusIcon} size={16} color={isWinner ? "var(--ib-success)" : "var(--ib-danger)"} /> {statusText}</> : statusText}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Fun whey matchups */}
      {winnerCount > 0 && predictions.length >= winnerCount * 2 && (
        <div style="margin-top:1rem;font-size:0.9rem;">
          {Array.from({ length: winnerCount }).map((_, i) => {
            const loser = predictions[total - 1 - i];
            const winner = predictions[i];
            if (!loser || !winner) return null;
            return (
              <p style="margin:0.25rem 0;">
                按目前趨勢，<strong>{loser.name}</strong> 需要準備 1kg 乳清蛋白送給 <strong>{winner.name}</strong> <Icon name="smile" size={16} />
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default leaderboard;
