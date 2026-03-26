import { Hono } from "hono";
import { validateSignature } from "@line/bot-sdk";
import { saveConfig } from "../lib/config.ts";
import { replyMessage, buildRankingText, buildMyStatsText } from "../lib/line-notify.ts";

const webhook = new Hono();

webhook.post("/webhook/line", async (c) => {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    console.warn("LINE_CHANNEL_SECRET not set, skipping webhook");
    return c.json({ ok: true });
  }

  const rawBody = await c.req.arrayBuffer();
  const bodyBuffer = Buffer.from(rawBody);
  const signature = c.req.header("x-line-signature") || "";

  if (!validateSignature(bodyBuffer, secret, signature)) {
    return c.text("Invalid signature", 403);
  }

  const body = JSON.parse(bodyBuffer.toString());
  const events = body.events || [];

  for (const event of events) {
    // Auto-capture group ID
    if (event.source?.type === "group") {
      saveConfig("line_group_id", event.source.groupId);
    }

    // Handle text message commands
    if (event.type === "message" && event.message?.type === "text" && event.replyToken) {
      const text = (event.message.text as string).trim();
      const lineUserId = event.source?.userId || "";

      if (text === "/排名" || text === "排名") {
        await replyMessage(event.replyToken, buildRankingText());
      } else if (text === "/我的" || text === "我的") {
        await replyMessage(event.replyToken, buildMyStatsText(lineUserId));
      }
    }
  }

  return c.json({ ok: true });
});

export default webhook;
