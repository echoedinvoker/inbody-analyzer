import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";

const client = new Anthropic();

export type ExtractedData = {
  measured_at: string | null;
  weight: number | null;
  skeletal_muscle: number | null;
  body_fat_mass: number | null;
  body_fat_pct: number | null;
  bmi: number | null;
  total_body_water: number | null;
  visceral_fat_level: number | null;
  basal_metabolic_rate: number | null;
  inbody_score: number | null;
  segmental_lean: {
    right_arm: number | null;
    left_arm: number | null;
    trunk: number | null;
    right_leg: number | null;
    left_leg: number | null;
  } | null;
  segmental_fat: {
    right_arm: number | null;
    left_arm: number | null;
    trunk: number | null;
    right_leg: number | null;
    left_leg: number | null;
  } | null;
};

const EXTRACTION_PROMPT = `你是 InBody 體組成分析報告的數據提取專家。請從這張 InBody 報告照片中提取所有可辨識的數據。

請回傳 JSON 格式，嚴格遵循以下結構：

{
  "measured_at": "YYYY-MM-DD HH:mm",  // 報告上的測量日期時間，若無法辨識回傳 null
  "weight": 75.3,                      // 體重 (kg)
  "skeletal_muscle": 32.1,             // 骨骼肌重 (kg)
  "body_fat_mass": 15.2,               // 體脂肪重 (kg)
  "body_fat_pct": 20.1,                // 體脂率 (%)
  "bmi": 24.5,                         // BMI
  "total_body_water": 40.2,            // 總體水分 (L)
  "visceral_fat_level": 8,             // 內臟脂肪等級 (整數)
  "basal_metabolic_rate": 1650,        // 基礎代謝率 (kcal, 整數)
  "inbody_score": 75,                  // InBody 分數 (整數)
  "segmental_lean": {                  // 節段肌肉分析 (kg)，若報告上沒有則回傳 null
    "right_arm": 3.2,
    "left_arm": 3.1,
    "trunk": 25.0,
    "right_leg": 9.5,
    "left_leg": 9.4
  },
  "segmental_fat": {                   // 節段脂肪分析 (%)，若報告上沒有則回傳 null
    "right_arm": 18.5,
    "left_arm": 19.0,
    "trunk": 22.0,
    "right_leg": 25.0,
    "left_leg": 24.5
  }
}

重要注意事項：
- 數值請用數字（不是字串），找不到的欄位回傳 null
- 注意小數點：體重 75.3 不是 753，體脂率 20.1 不是 201
- 區分公斤 (kg) 和磅 (lbs)，所有數值統一用公斤
- InBody 報告有多種型號（270/370/570/770），版面不同但核心欄位相同
- 若照片模糊或部分遮擋導致無法確認某個數值，寧可回傳 null 也不要猜
- 只回傳 JSON，不要加任何說明文字`;

export async function extractFromPhoto(photoPath: string): Promise<{
  data: ExtractedData;
  rawResponse: string;
}> {
  const imageBuffer = readFileSync(photoPath);
  const base64 = imageBuffer.toString("base64");
  const ext = photoPath.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  const mediaType = `image/${ext}` as "image/jpeg" | "image/png";

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const rawText = textBlock?.type === "text" ? textBlock.text : "";

  // Extract JSON from response (may be wrapped in markdown code blocks)
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`AI 回傳格式錯誤，無法解析 JSON:\n${rawText}`);
  }

  const data = JSON.parse(jsonMatch[0]) as ExtractedData;
  return { data, rawResponse: rawText };
}
