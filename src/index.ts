import { Hono } from "hono";
import { sessionMiddleware } from "./lib/session.ts";
import auth from "./routes/auth.tsx";
import reports from "./routes/reports.tsx";
import dashboard from "./routes/dashboard.tsx";
import history from "./routes/history.tsx";
import settings from "./routes/settings.tsx";
import leaderboard from "./routes/leaderboard.tsx";
import admin from "./routes/admin.tsx";

const app = new Hono();

// Global middleware
app.use("*", sessionMiddleware);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes
app.route("/", auth);
app.route("/", reports);
app.route("/", dashboard);
app.route("/", history);
app.route("/", settings);
app.route("/", leaderboard);
app.route("/", admin);

// Home redirect
app.get("/", (c) => {
  const user = c.get("user");
  return user ? c.redirect("/dashboard") : c.redirect("/login");
});

const port = Number(process.env.PORT) || 3000;
console.log(`InBody Analyzer running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
