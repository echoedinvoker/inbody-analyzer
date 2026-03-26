import Anthropic from "@anthropic-ai/sdk";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { getCompetitionMode } from "./config.ts";
import { getCompetitionMeasurements } from "./competition.ts";

const client = new Anthropic();

/**
 * Get or generate a one-liner narrative for a user's journey.
 * Returns null if < 2 measurements.
 */
export async function getNarrative(userId: number): Promise<string | null> {
  // Get confirmed measurements scoped to current competition
  const rows = getCompetitionMeasurements(userId);

  if (rows.length < 2) return null;

  const latestReportId = rows[rows.length - 1]!.reportId;

  // Check cache
  const cached = db
    .select()
    .from(schema.narrativeCache)
    .where(eq(schema.narrativeCache.userId, userId))
    .get();

  if (cached && cached.latestReportId === latestReportId) {
    return cached.narrative;
  }

  // Build data summary for prompt
  const mode = getCompetitionMode();
  const dataRows = rows
    .map(
      (r) =>
        `${r.measuredAt?.slice(0, 10)}: 體重${r.weight}kg 骨骼肌${r.skeletalMuscle}kg 體脂肪${r.bodyFatMass}kg 體脂率${r.bodyFatPct}%`
    )
    .join("\n");

  const modeHint = mode === "bulk"
    ? "這是增肌比賽期間，關注骨骼肌的增長趨勢。"
    : "這是減脂比賽期間，關注體脂率的下降趨勢。";

  const prompt = `你是一位紀錄片旁白。用一句話（30 字以內）描述這位使用者的身體組成變化旅程。

${modeHint}

歷史數據（由舊到新）：
${dataRows}

規則：
- 用「你」稱呼使用者
- 聚焦在「身體正在發生什麼」，不是「你應該做什麼」
- 語氣像在描述一個正在展開的故事，帶一點戲劇感
- 即使數字只有微小變化，也要讓使用者感受到「有東西在改變」
- 不要用教練口吻，用敘事者口吻
- 只回一句話，不要加引號

好的範例：
- 你的身體正在回應——三週內骨骼肌穩定攀升 0.6kg
- 體重沒動，但底層正在重塑：肌肉 +0.3kg，脂肪 -0.4kg
- 第四期了，你的肌肉增長速度比前兩期快了一倍

壞的範例（不要寫）：
- 建議增加蛋白質攝取（這是建議不是敘事）
- 繼續加油！（空洞）
- 你的骨骼肌從 31.4 增加到 31.7（純數據搬運）`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const narrative = textBlock?.type === "text"
    ? textBlock.text.trim().replace(/^[「『"']|[」』"']$/g, "")
    : null;

  if (!narrative) return null;

  // Upsert cache
  if (cached) {
    db.update(schema.narrativeCache)
      .set({ latestReportId, narrative, createdAt: new Date().toISOString() })
      .where(eq(schema.narrativeCache.userId, userId))
      .run();
  } else {
    db.insert(schema.narrativeCache)
      .values({ userId, latestReportId, narrative })
      .run();
  }

  return narrative;
}
