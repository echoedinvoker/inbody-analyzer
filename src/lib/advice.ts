import Anthropic from "@anthropic-ai/sdk";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";

const client = new Anthropic();

const GOAL_LABELS: Record<string, string> = {
  cut: "減脂",
  bulk: "增肌",
  maintain: "維持體態",
};

export async function getAdvice(userId: number): Promise<string | null> {
  // Get user info
  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return null;

  // Get confirmed measurements
  const rows = db
    .select({
      reportId: schema.reports.id,
      measuredAt: schema.reports.measuredAt,
      weight: schema.measurements.weight,
      skeletalMuscle: schema.measurements.skeletalMuscle,
      bodyFatMass: schema.measurements.bodyFatMass,
      bodyFatPct: schema.measurements.bodyFatPct,
      bmi: schema.measurements.bmi,
      inbodyScore: schema.measurements.inbodyScore,
      basalMetabolicRate: schema.measurements.basalMetabolicRate,
    })
    .from(schema.measurements)
    .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
    .where(eq(schema.reports.userId, userId))
    .orderBy(desc(schema.reports.measuredAt))
    .limit(10)
    .all();

  if (rows.length === 0) return null;

  const latestReportId = rows[0]!.reportId;

  // Check cache
  const cached = db
    .select()
    .from(schema.adviceCache)
    .where(eq(schema.adviceCache.userId, userId))
    .get();

  if (cached && cached.latestReportId === latestReportId) {
    return cached.advice;
  }

  // Get user goals
  const goals = db
    .select()
    .from(schema.userGoals)
    .where(eq(schema.userGoals.userId, userId))
    .get();

  // Build prompt
  const goalLabel = GOAL_LABELS[user.goal ?? "maintain"] ?? "維持體態";
  const dataRows = rows
    .reverse() // chronological order
    .map(
      (r) =>
        `${r.measuredAt?.slice(0, 10)}: 體重${r.weight}kg 骨骼肌${r.skeletalMuscle}kg 體脂肪${r.bodyFatMass}kg 體脂率${r.bodyFatPct}% BMI${r.bmi} InBody${r.inbodyScore} 基代${r.basalMetabolicRate}kcal`
    )
    .join("\n");

  let goalText = `目標：${goalLabel}`;
  if (goals) {
    const parts: string[] = [];
    if (goals.targetWeight) parts.push(`目標體重 ${goals.targetWeight}kg`);
    if (goals.targetBodyFatPct) parts.push(`目標體脂率 ${goals.targetBodyFatPct}%`);
    if (goals.targetSkeletalMuscle) parts.push(`目標骨骼肌 ${goals.targetSkeletalMuscle}kg`);
    if (parts.length) goalText += `（${parts.join("、")}）`;
  }

  const prompt = `你是一位健身教練和營養師。根據以下 InBody 體組成歷史數據，給出 3-5 條具體、可執行的建議。

使用者：${user.name}
${goalText}

歷史數據（由舊到新）：
${dataRows}

要求：
- 先用一句話總結趨勢（例如「體脂穩定下降，骨骼肌略有增長」）
- 再給 3-5 條具體建議，每條包含飲食或訓練的可執行動作
- 如果數據只有一筆，基於當前狀態給建議，不要硬分析趨勢
- 語氣直接實用，用繁體中文
- 不要加醫療免責聲明
- 用 markdown 格式`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const advice = textBlock?.type === "text" ? textBlock.text : "無法生成建議";

  // Upsert cache
  if (cached) {
    db.update(schema.adviceCache)
      .set({ latestReportId, advice, createdAt: new Date().toISOString() })
      .where(eq(schema.adviceCache.userId, userId))
      .run();
  } else {
    db.insert(schema.adviceCache)
      .values({ userId, latestReportId, advice })
      .run();
  }

  return advice;
}
