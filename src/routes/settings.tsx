import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth, type SessionUser } from "../lib/session.ts";
import { Layout } from "../views/layout.tsx";

const settings = new Hono();

settings.get("/settings", (c) => {
  const user = requireAuth(c);
  const msg = c.req.query("msg");

  const goals = db
    .select()
    .from(schema.userGoals)
    .where(eq(schema.userGoals.userId, user.id))
    .get();

  return c.html(
    <Layout title="設定" user={user}>
      {msg && <div class="flash flash-success">{msg}</div>}
      <h2>個人設定</h2>

      <form method="post" action="/settings">
        <fieldset>
          <legend>目標</legend>
          <label>
            目標方向
            <select name="goal">
              <option value="cut" selected={user.goal === "cut"}>
                減脂
              </option>
              <option value="bulk" selected={user.goal === "bulk"}>
                增肌
              </option>
              <option value="maintain" selected={user.goal === "maintain"}>
                維持體態
              </option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>目標數值（選填）</legend>
          <label>
            目標體重 (kg)
            <input
              type="number"
              step="0.1"
              name="target_weight"
              value={goals?.targetWeight ?? ""}
              placeholder="例：70"
            />
          </label>
          <label>
            目標體脂率 (%)
            <input
              type="number"
              step="0.1"
              name="target_body_fat_pct"
              value={goals?.targetBodyFatPct ?? ""}
              placeholder="例：15"
            />
          </label>
          <label>
            目標骨骼肌 (kg)
            <input
              type="number"
              step="0.1"
              name="target_skeletal_muscle"
              value={goals?.targetSkeletalMuscle ?? ""}
              placeholder="例：35"
            />
          </label>
        </fieldset>

        <button type="submit">儲存</button>
      </form>
    </Layout>
  );
});

settings.post("/settings", async (c) => {
  const user = requireAuth(c);
  const body = await c.req.parseBody();

  const goal = String(body.goal || "maintain");
  const num = (k: string) => {
    const v = body[k];
    if (!v || v === "") return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };

  // Update user goal
  db.update(schema.users)
    .set({ goal: goal as "cut" | "bulk" | "maintain" })
    .where(eq(schema.users.id, user.id))
    .run();

  // Upsert user goals
  const existing = db
    .select()
    .from(schema.userGoals)
    .where(eq(schema.userGoals.userId, user.id))
    .get();

  const values = {
    targetWeight: num("target_weight"),
    targetBodyFatPct: num("target_body_fat_pct"),
    targetSkeletalMuscle: num("target_skeletal_muscle"),
  };

  if (existing) {
    db.update(schema.userGoals)
      .set(values)
      .where(eq(schema.userGoals.userId, user.id))
      .run();
  } else {
    db.insert(schema.userGoals)
      .values({ userId: user.id, ...values })
      .run();
  }

  return c.redirect("/settings?msg=設定已儲存");
});

export default settings;
