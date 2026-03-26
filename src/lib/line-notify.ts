import { messagingApi } from "@line/bot-sdk";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { getConfig, getCompetitionMode } from "./config.ts";
import { getStreak } from "./streak.ts";
import { getDisplayName, getCompetitionMeasurements } from "./competition.ts";
import { predictAll } from "./predict.ts";
import { calculatePeriodMVP } from "./mvp.ts";

const { MessagingApiClient } = messagingApi;

/**
 * Find users whose streak deadline is within `daysBefore` days.
 */
function findUsersDueSoon(daysBefore: number): { userId: number; name: string; streak: number; deadline: string }[] {
  const allUsers = db.select().from(schema.users).all().filter((u) => !u.isDemo);
  const results: { userId: number; name: string; streak: number; deadline: string }[] = [];

  // Get today in UTC+8
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayStr = utc8.toISOString().slice(0, 10);

  // Calculate the cutoff date
  const cutoff = new Date(todayStr + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() + daysBefore);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  for (const user of allUsers) {
    const streakRow = db
      .select()
      .from(schema.streaks)
      .where(eq(schema.streaks.userId, user.id))
      .get();

    if (!streakRow || !streakRow.streakDeadline) continue;

    // Due soon: deadline is between today and cutoff (inclusive)
    if (streakRow.streakDeadline >= todayStr && streakRow.streakDeadline <= cutoffStr) {
      results.push({
        userId: user.id,
        name: user.name,
        streak: streakRow.currentStreak ?? 0,
        deadline: streakRow.streakDeadline,
      });
    }
  }

  return results;
}

/**
 * Send measurement reminder to LINE group.
 * Returns info about what was sent, or null if skipped.
 */
export async function sendMeasurementReminder(): Promise<{ sent: boolean; message: string } | null> {
  const groupId = getConfig("line_group_id");
  if (!groupId) return { sent: false, message: "No LINE group ID configured" };

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { sent: false, message: "LINE_CHANNEL_ACCESS_TOKEN not set" };

  const reminderDays = Number(getConfig("reminder_days_before") || "2");
  const dueUsers = findUsersDueSoon(reminderDays);
  if (dueUsers.length === 0) return { sent: false, message: "No users due soon" };

  const client = new MessagingApiClient({ channelAccessToken: token });

  const names = dueUsers.map((u) => u.name).join("、");
  const streakInfo = dueUsers
    .filter((u) => u.streak > 0)
    .map((u) => `${u.name} \u{1F525}${u.streak}連`)
    .join("  ");

  let message = `\u{1F4E2} 量測提醒\n\n`;
  message += `${names}，你的 InBody 量測期限快到了！\n`;
  if (streakInfo) message += `\n${streakInfo}\n別讓連勝中斷 \u{1F4AA}`;
  message += `\n\n\u{1F449} https://liff.line.me/2009579829-XlKrJJI0`;

  await client.pushMessage({
    to: groupId,
    messages: [{ type: "text", text: message }],
  });

  return { sent: true, message: `Reminder sent to ${dueUsers.length} users: ${names}` };
}

/**
 * Send a test message to the LINE group.
 */
export async function sendTestMessage(): Promise<{ sent: boolean; message: string }> {
  const groupId = getConfig("line_group_id");
  if (!groupId) return { sent: false, message: "No LINE group ID configured" };

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { sent: false, message: "LINE_CHANNEL_ACCESS_TOKEN not set" };

  const client = new MessagingApiClient({ channelAccessToken: token });

  await client.pushMessage({
    to: groupId,
    messages: [{ type: "text", text: "\u{1F916} InBody 比賽小幫手測試訊息 — 連線成功！" }],
  });

  return { sent: true, message: "Test message sent" };
}

/** Get LINE client (returns null if not configured) */
function getClient(): InstanceType<typeof MessagingApiClient> | null {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  return new MessagingApiClient({ channelAccessToken: token });
}

/** Push a text message to the LINE group */
export async function pushToGroup(text: string): Promise<boolean> {
  const groupId = getConfig("line_group_id");
  const client = getClient();
  if (!groupId || !client) return false;
  try {
    await client.pushMessage({ to: groupId, messages: [{ type: "text", text }] });
    return true;
  } catch (e: any) {
    console.error("LINE push failed:", e.message);
    return false;
  }
}

/** Reply to a specific LINE event */
export async function replyMessage(replyToken: string, text: string): Promise<boolean> {
  const client = getClient();
  if (!client) return false;
  try {
    await client.replyMessage({ replyToken, messages: [{ type: "text", text }] });
    return true;
  } catch (e: any) {
    console.error("LINE reply failed:", e.message);
    return false;
  }
}

/** Build ranking text for /排名 command */
export function buildRankingText(): string {
  const mode = getCompetitionMode();
  const predictions = predictAll();
  const mvp = calculatePeriodMVP();
  const unit = mode === "bulk" ? "kg" : "%";
  const label = mode === "bulk" ? "骨骼肌" : "體脂率";

  if (predictions.length === 0) {
    return "\u{1F4CA} 目前還沒有足夠數據產生排名\n\n至少需要 2 筆量測紀錄";
  }

  let text = `\u{1F3C6} ${mode === "bulk" ? "增肌" : "減脂"}排行榜\n\n`;

  predictions.forEach((p, i) => {
    const medal = i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : i === 2 ? "\u{1F949}" : `${i + 1}.`;
    const sign = p.predictedChange > 0 ? "+" : "";
    const name = getDisplayName(p.userId, p.name);
    text += `${medal} ${name}  ${sign}${p.predictedChange}${unit}\n`;
  });

  if (mvp) {
    const sign = mvp.gain > 0 ? "+" : "";
    text += `\n\u{2B50} 本期 MVP：${mvp.name}（${sign}${mvp.gain}${unit}）`;
  }

  text += `\n\n\u{1F449} https://liff.line.me/2009579829-XlKrJJI0`;
  return text;
}

/** Build personal stats text for /我的 command */
export function buildMyStatsText(lineUserId: string): string {
  // Find user by LINE user ID
  const user = db.select().from(schema.users).where(eq(schema.users.lineUserId, lineUserId)).get();
  if (!user) return "\u{274C} 找不到你的帳號\n\n請先用 LIFF 連結登入一次：\nhttps://liff.line.me/2009579829-XlKrJJI0";

  const ms = getCompetitionMeasurements(user.id);
  const streak = getStreak(user.id);
  const name = getDisplayName(user.id, user.name);

  if (ms.length === 0) {
    return `\u{1F464} ${name}\n\n本屆還沒有量測紀錄\n\n\u{1F449} https://liff.line.me/2009579829-XlKrJJI0`;
  }

  const latest = ms[ms.length - 1]!;
  let text = `\u{1F464} ${name}\n\n`;
  text += `\u{1F4CA} 最新數據（${latest.measuredAt.slice(0, 10)}）\n`;
  if (latest.weight != null) text += `  體重：${latest.weight} kg\n`;
  if (latest.skeletalMuscle != null) text += `  骨骼肌：${latest.skeletalMuscle} kg\n`;
  if (latest.bodyFatPct != null) text += `  體脂率：${latest.bodyFatPct}%\n`;

  if (ms.length >= 2) {
    const first = ms[0]!;
    const muscleDiff = latest.skeletalMuscle != null && first.skeletalMuscle != null
      ? Math.round((latest.skeletalMuscle - first.skeletalMuscle) * 10) / 10 : null;
    const fatDiff = latest.bodyFatPct != null && first.bodyFatPct != null
      ? Math.round((latest.bodyFatPct - first.bodyFatPct) * 10) / 10 : null;

    text += `\n\u{1F4C8} 本屆變化\n`;
    if (muscleDiff != null) text += `  骨骼肌：${muscleDiff > 0 ? "+" : ""}${muscleDiff} kg\n`;
    if (fatDiff != null) text += `  體脂率：${fatDiff > 0 ? "+" : ""}${fatDiff}%\n`;
  }

  if (streak.currentStreak > 0 || streak.deadline) {
    text += `\n\u{1F525} Streak：連續 ${streak.currentStreak} 期`;
    if (streak.deadline) text += `（期限 ${streak.deadline}）`;
    text += "\n";
  }

  text += `\n本屆量測：${ms.length} 筆`;
  text += `\n\n\u{1F449} https://liff.line.me/2009579829-XlKrJJI0`;
  return text;
}

/** Notify group when someone uploads a new report */
export async function notifyNewUpload(userId: number, userName: string): Promise<void> {
  const name = getDisplayName(userId, userName);
  const ms = getCompetitionMeasurements(userId);
  const count = ms.length;

  let text = `\u{1F389} ${name} 上傳了新數據！（第 ${count} 筆）`;

  // Check if this upload changed the MVP
  const mvp = calculatePeriodMVP();
  if (mvp && mvp.userId === userId) {
    const unit = mvp.metric === "skeletalMuscle" ? "kg" : "%";
    const sign = mvp.gain > 0 ? "+" : "";
    text += `\n\u{2B50} 順便搶下本期 MVP（${sign}${mvp.gain}${unit}）`;
  }

  await pushToGroup(text);
}

/** Notify group with final competition results */
export async function notifyCompetitionEnd(resultsJson: string, competitionName: string): Promise<void> {
  const results = JSON.parse(resultsJson) as { userId: number; name: string; rank: number; change: number }[];
  if (results.length === 0) return;

  const mode = getCompetitionMode();
  const unit = mode === "bulk" ? "kg" : "%";

  let text = `\u{1F3C1} ${competitionName} 結束！\n\n\u{1F3C6} 最終排名：\n\n`;

  results.forEach((r) => {
    const medal = r.rank === 1 ? "\u{1F947}" : r.rank === 2 ? "\u{1F948}" : r.rank === 3 ? "\u{1F949}" : `${r.rank}.`;
    const sign = r.change > 0 ? "+" : "";
    const name = getDisplayName(r.userId, r.name);
    text += `${medal} ${name}  ${sign}${r.change}${unit}\n`;
  });

  if (results.length >= 2) {
    const winner = results[0]!;
    const loser = results[results.length - 1]!;
    text += `\n\u{1F95B} ${loser.name} 請 ${winner.name} 喝乳清！`;
  }

  await pushToGroup(text);
}
