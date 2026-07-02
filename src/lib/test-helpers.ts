import { Hono } from "hono";
import { sign } from "hono/jwt";
import { db, schema } from "../db/index.ts";
import { sessionMiddleware } from "./session.ts";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export function makeTestApp(router: Hono) {
  const app = new Hono();
  app.onError((err, c) => {
    if (err.message === "unauthorized") return c.json({ error: "Unauthorized" }, 401);
    console.error(err);
    return c.json({ error: "Internal Server Error" }, 500);
  });
  app.use("*", sessionMiddleware);
  app.route("/", router);
  return app;
}

export async function authHeader(userId: number, name = "test") {
  const token = await sign({ sub: userId, name }, JWT_SECRET, "HS256");
  return { Authorization: `Bearer ${token}` };
}

export function makeUser(name: string) {
  return db.insert(schema.users).values({ name, goal: "cut" }).returning().get();
}

export function makeRoom(ownerId: number, opts?: Partial<{
  visibilityMode: "open" | "mirror";
  startDate: string;
  endDate: string;
  measurementInterval: number;
  streakInterval: number;
}>) {
  const slug = crypto.randomUUID().slice(0, 10);
  const room = db.insert(schema.rooms).values({
    name: `Room ${slug}`,
    slug,
    ownerId,
    mode: "cut",
    startDate: opts?.startDate ?? "2026-01-01",
    endDate: opts?.endDate ?? "2026-12-31",
    measurementInterval: opts?.measurementInterval ?? 14,
    streakInterval: opts?.streakInterval ?? 21,
    inviteCode: crypto.randomUUID().slice(0, 8),
    visibilityMode: opts?.visibilityMode ?? "mirror",
  }).returning().get();
  db.insert(schema.roomMembers).values({
    roomId: room.id,
    userId: ownerId,
    role: "owner",
  }).run();
  return room;
}

export function addMember(roomId: number, userId: number) {
  return db.insert(schema.roomMembers).values({
    roomId,
    userId,
    role: "member",
  }).returning().get();
}

export function makeConfirmedReport(userId: number, measuredAt: string, opts?: Partial<{
  weight: number;
  bodyFatPct: number;
  photoPath: string;
}>) {
  const report = db.insert(schema.reports).values({
    userId,
    measuredAt,
    confirmed: true,
    photoPath: opts?.photoPath ?? null,
  }).returning().get();
  db.insert(schema.measurements).values({
    reportId: report.id,
    weight: opts?.weight ?? 65,
    bodyFatPct: opts?.bodyFatPct ?? 18,
  }).run();
  return report;
}

export function submitToRoom(roomId: number, userId: number, reportId: number, hint?: string) {
  return db.insert(schema.roomSubmissions).values({
    roomId,
    userId,
    reportId,
    hint: hint ?? null,
  }).returning().get();
}

export function resetDb() {
  db.delete(schema.roomAdviceCache).run();
  db.delete(schema.roomStreaks).run();
  db.delete(schema.roomSubmissionRejections).run();
  db.delete(schema.roomSubmissions).run();
  db.delete(schema.roomMembers).run();
  db.delete(schema.rooms).run();
  db.delete(schema.measurements).run();
  db.delete(schema.adviceCache).run();
  db.delete(schema.narrativeCache).run();
  db.delete(schema.badges).run();
  db.delete(schema.streaks).run();
  db.delete(schema.sessions).run();
  db.delete(schema.userGoals).run();
  db.delete(schema.reports).run();
  db.delete(schema.competitionHistory).run();
  db.delete(schema.users).run();
}
