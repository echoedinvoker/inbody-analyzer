import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq, and, gt } from "drizzle-orm";
import { db, schema } from "../db/index.ts";

export type SessionUser = {
  id: number;
  name: string;
  isAdmin: boolean;
  goal: string;
  competitionStart: string | null;
  competitionEnd: string | null;
};

type Env = {
  Variables: {
    user: SessionUser | null;
  };
};

export const sessionMiddleware = createMiddleware<Env>(async (c, next) => {
  const sessionId = getCookie(c, "sid");
  if (!sessionId) {
    c.set("user", null);
    return next();
  }

  const now = new Date().toISOString();
  const rows = await db
    .select({
      userId: schema.sessions.userId,
      name: schema.users.name,
      isAdmin: schema.users.isAdmin,
      goal: schema.users.goal,
      competitionStart: schema.users.competitionStart,
      competitionEnd: schema.users.competitionEnd,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(
      and(eq(schema.sessions.id, sessionId), gt(schema.sessions.expiresAt, now))
    )
    .limit(1);

  if (rows.length === 0) {
    deleteCookie(c, "sid");
    c.set("user", null);
    return next();
  }

  const row = rows[0]!;
  c.set("user", {
    id: row.userId,
    name: row.name,
    isAdmin: row.isAdmin ?? false,
    goal: row.goal ?? "maintain",
    competitionStart: row.competitionStart ?? null,
    competitionEnd: row.competitionEnd ?? null,
  });
  return next();
});

export function createSession(c: any, userId: number) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  db.insert(schema.sessions).values({ id, userId, expiresAt }).run();
  setCookie(c, "sid", id, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function destroySession(c: any) {
  const sessionId = getCookie(c, "sid");
  if (sessionId) {
    db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
  }
  deleteCookie(c, "sid");
}

export function requireAuth(c: any): SessionUser {
  const user = c.get("user");
  if (!user) throw new Error("unauthorized");
  return user;
}
