import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { eq, and, gt } from "drizzle-orm";
import { db, schema } from "../db/index.ts";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export type SessionUser = {
  id: number;
  name: string;
  isAdmin: boolean;
  isDemo: boolean;
  isGhost: boolean;
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
  // Try JWT first (for new Nuxt frontend)
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = await verify(token, JWT_SECRET, "HS256") as { sub: number; name: string };
      const user = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, payload.sub))
        .get();

      if (user) {
        c.set("user", {
          id: user.id,
          name: user.name,
          isAdmin: user.isAdmin ?? false,
          isDemo: user.isDemo ?? false,
          isGhost: user.isGhost ?? false,
          goal: user.goal ?? "maintain",
          competitionStart: user.competitionStart ?? null,
          competitionEnd: user.competitionEnd ?? null,
        });
        return next();
      }
    } catch {
      // Invalid JWT, fall through to cookie session
    }
  }

  // Fall back to cookie session (for existing SSR frontend)
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
      isDemo: schema.users.isDemo,
      isGhost: schema.users.isGhost,
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
    isDemo: row.isDemo ?? false,
    isGhost: row.isGhost ?? false,
    goal: row.goal ?? "maintain",
    competitionStart: row.competitionStart ?? null,
    competitionEnd: row.competitionEnd ?? null,
  });
  return next();
});

// Sign a JWT for a user (30 days expiry)
export async function signJwt(userId: number, name: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { sub: userId, name, iat: now, exp: now + 30 * 24 * 60 * 60 },
    JWT_SECRET
  );
}

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
