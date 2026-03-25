import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionMiddleware } from "./lib/session.ts";
import auth from "./routes/auth.tsx";
import reports from "./routes/reports.tsx";
import dashboard from "./routes/dashboard.tsx";
import history from "./routes/history.tsx";
import settings from "./routes/settings.tsx";
import leaderboard from "./routes/leaderboard.tsx";
import admin from "./routes/admin.tsx";
import webhook from "./routes/webhook.tsx";
import roomsApi from "./routes/rooms.ts";
import apiDashboard from "./routes/api-dashboard.ts";
import apiLeaderboard from "./routes/api-leaderboard.ts";
import apiReports from "./routes/api-reports.ts";

const app = new Hono();

// CORS for API endpoints (Nuxt frontend)
const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

app.use(
  "/api/*",
  cors({
    origin: corsOrigins,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// Global error handler: catch "unauthorized" and redirect to login
app.onError((err, c) => {
  // For API routes, return JSON error instead of redirect
  if (c.req.path.startsWith("/api/")) {
    if (err.message === "unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    console.error(err);
    return c.json({ error: "Internal Server Error" }, 500);
  }

  if (err.message === "unauthorized") {
    return c.redirect("/login");
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
});

// Global middleware
app.use("*", sessionMiddleware);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Routes (webhook first — no auth needed)
app.route("/", webhook);
app.route("/", auth);
app.route("/", reports);
app.route("/", dashboard);
app.route("/", history);
app.route("/", settings);
app.route("/", leaderboard);
app.route("/", admin);
app.route("/", roomsApi);
app.route("/", apiDashboard);
app.route("/", apiLeaderboard);
app.route("/", apiReports);

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
