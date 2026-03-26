import { Hono } from "hono";
import { eq, and, isNull, count, desc } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { requireAuth } from "../lib/session.ts";
import { nanoid } from "../lib/nanoid.ts";
import { getStreak } from "../lib/streak.ts";

const rooms = new Hono();

// GET /api/rooms — list my rooms
rooms.get("/api/rooms", (c) => {
  const user = requireAuth(c);

  const myRooms = db
    .select({
      id: schema.rooms.id,
      name: schema.rooms.name,
      slug: schema.rooms.slug,
      mode: schema.rooms.mode,
      startDate: schema.rooms.startDate,
      endDate: schema.rooms.endDate,
      isActive: schema.rooms.isActive,
      role: schema.roomMembers.role,
    })
    .from(schema.roomMembers)
    .innerJoin(schema.rooms, eq(schema.roomMembers.roomId, schema.rooms.id))
    .where(
      and(
        eq(schema.roomMembers.userId, user.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .all();

  // Get member counts for each room
  const result = myRooms.map((room) => {
    const memberCount = db
      .select({ count: count() })
      .from(schema.roomMembers)
      .where(
        and(
          eq(schema.roomMembers.roomId, room.id),
          isNull(schema.roomMembers.leftAt)
        )
      )
      .get();

    const now = new Date();
    const end = new Date(room.endDate);
    const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    // Streak (global)
    const streak = getStreak(user.id);

    // User's report count in this room's date range
    const userReports = db
      .select({ measuredAt: schema.reports.measuredAt })
      .from(schema.reports)
      .where(
        and(
          eq(schema.reports.userId, user.id),
          eq(schema.reports.confirmed, true)
        )
      )
      .all()
      .filter((r) => {
        const date = r.measuredAt?.slice(0, 10) || "";
        return date >= room.startDate && date <= room.endDate;
      });

    return {
      ...room,
      memberCount: memberCount?.count ?? 0,
      daysLeft,
      streak: streak ? { current: streak.currentStreak } : null,
      reportCount: userReports.length,
    };
  });

  return c.json(result);
});

// POST /api/rooms — create a new room
rooms.post("/api/rooms", async (c) => {
  const user = requireAuth(c);
  const body = await c.req.json();

  const { name, mode, startDate, endDate, measurementInterval, maxMembers, visibilityMode, minSubmissions } = body;

  if (!name || !mode || !startDate || !endDate) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  if (!["cut", "bulk"].includes(mode)) {
    return c.json({ error: "Invalid mode" }, 400);
  }

  if (visibilityMode && !["open", "mirror"].includes(visibilityMode)) {
    return c.json({ error: "Invalid visibility mode" }, 400);
  }

  const slug = nanoid(10);
  const inviteCode = nanoid(6).toUpperCase();

  const room = db
    .insert(schema.rooms)
    .values({
      name,
      slug,
      ownerId: user.id,
      mode,
      startDate,
      endDate,
      measurementInterval: measurementInterval ?? 14,
      maxMembers: maxMembers ?? 50,
      visibilityMode: visibilityMode ?? "open",
      minSubmissions: minSubmissions ?? 3,
      inviteCode,
    })
    .returning()
    .get();

  // Add owner as first member
  db.insert(schema.roomMembers)
    .values({
      roomId: room.id,
      userId: user.id,
      role: "owner",
    })
    .run();

  return c.json({
    id: room.id,
    slug: room.slug,
    name: room.name,
    inviteCode: room.inviteCode,
    inviteUrl: `${c.req.header("origin") || "https://inbody-battle.pages.dev"}/rooms/${room.slug}/join?code=${room.inviteCode}`,
  }, 201);
});

// GET /api/rooms/:slug — room details
rooms.get("/api/rooms/:slug", (c) => {
  const user = requireAuth(c);
  const { slug } = c.req.param();

  const room = db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, slug))
    .get();

  if (!room) return c.json({ error: "Room not found" }, 404);

  // Check if user is a member
  const membership = db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        eq(schema.roomMembers.userId, user.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .get();

  const memberCount = db
    .select({ count: count() })
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .get();

  const now = new Date();
  const end = new Date(room.endDate);
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return c.json({
    id: room.id,
    name: room.name,
    slug: room.slug,
    mode: room.mode,
    startDate: room.startDate,
    endDate: room.endDate,
    measurementInterval: room.measurementInterval,
    maxMembers: room.maxMembers,
    isActive: room.isActive,
    visibilityMode: room.visibilityMode,
    minSubmissions: room.minSubmissions,
    inviteCode: membership?.role === "owner" ? room.inviteCode : undefined,
    isMember: !!membership,
    isOwner: membership?.role === "owner",
    memberCount: memberCount?.count ?? 0,
    daysLeft,
  });
});

// POST /api/rooms/:slug/join — join a room
rooms.post("/api/rooms/:slug/join", async (c) => {
  const user = requireAuth(c);
  const { slug } = c.req.param();
  const body = await c.req.json();
  const { inviteCode } = body;

  if (!inviteCode) {
    return c.json({ error: "Invite code required" }, 400);
  }

  const room = db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, slug))
    .get();

  if (!room) return c.json({ error: "Room not found" }, 404);
  if (!room.isActive) return c.json({ error: "Room is no longer active" }, 400);
  if (room.inviteCode !== inviteCode) return c.json({ error: "Invalid invite code" }, 403);

  // Check if already a member (including soft-deleted)
  const existing = db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        eq(schema.roomMembers.userId, user.id)
      )
    )
    .get();

  if (existing && !existing.leftAt) {
    return c.json({ error: "Already a member" }, 400);
  }

  // Check max members
  const memberCount = db
    .select({ count: count() })
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .get();

  if ((memberCount?.count ?? 0) >= (room.maxMembers ?? 50)) {
    return c.json({ error: "Room is full" }, 400);
  }

  if (existing?.leftAt) {
    // Re-join: clear leftAt
    db.update(schema.roomMembers)
      .set({ leftAt: null, joinedAt: new Date().toISOString() })
      .where(eq(schema.roomMembers.id, existing.id))
      .run();
  } else {
    db.insert(schema.roomMembers)
      .values({
        roomId: room.id,
        userId: user.id,
        role: "member",
      })
      .run();
  }

  return c.json({ ok: true, roomSlug: room.slug });
});

// POST /api/rooms/:slug/leave — leave a room (soft delete)
rooms.post("/api/rooms/:slug/leave", (c) => {
  const user = requireAuth(c);
  const { slug } = c.req.param();

  const room = db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, slug))
    .get();

  if (!room) return c.json({ error: "Room not found" }, 404);

  const membership = db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        eq(schema.roomMembers.userId, user.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .get();

  if (!membership) return c.json({ error: "Not a member" }, 400);
  if (membership.role === "owner") return c.json({ error: "Owner cannot leave" }, 400);

  db.update(schema.roomMembers)
    .set({ leftAt: new Date().toISOString() })
    .where(eq(schema.roomMembers.id, membership.id))
    .run();

  return c.json({ ok: true });
});

// GET /api/rooms/:slug/members — list room members
rooms.get("/api/rooms/:slug/members", (c) => {
  const user = requireAuth(c);
  const { slug } = c.req.param();

  const room = db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, slug))
    .get();

  if (!room) return c.json({ error: "Room not found" }, 404);

  // Verify requester is a member
  const membership = db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        eq(schema.roomMembers.userId, user.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .get();

  if (!membership) return c.json({ error: "Not a member" }, 403);

  const members = db
    .select({
      userId: schema.roomMembers.userId,
      name: schema.users.name,
      role: schema.roomMembers.role,
      isGhost: schema.roomMembers.isGhost,
      joinedAt: schema.roomMembers.joinedAt,
    })
    .from(schema.roomMembers)
    .innerJoin(schema.users, eq(schema.roomMembers.userId, schema.users.id))
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .all();

  // Filter ghost members: only show ghosts to themselves
  const filtered = members.map((m) => ({
    ...m,
    // Hide ghost members from other users
    name: m.isGhost && m.userId !== user.id ? "👻" : m.name,
    isGhost: m.userId === user.id ? m.isGhost : undefined,
  }));

  return c.json(filtered);
});

// GET /api/rooms/:slug/available-reports — reports available for submission (mirror mode)
rooms.get("/api/rooms/:slug/available-reports", (c) => {
  const user = requireAuth(c);
  const { slug } = c.req.param();

  const room = db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, slug))
    .get();

  if (!room) return c.json({ error: "Room not found" }, 404);

  const membership = db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        eq(schema.roomMembers.userId, user.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .get();

  if (!membership) return c.json({ error: "Not a member" }, 403);

  // Get already submitted report IDs for this room
  const submitted = db
    .select({ reportId: schema.roomSubmissions.reportId })
    .from(schema.roomSubmissions)
    .where(
      and(
        eq(schema.roomSubmissions.roomId, room.id),
        eq(schema.roomSubmissions.userId, user.id)
      )
    )
    .all();

  const submittedIds = new Set(submitted.map((s) => s.reportId));

  // Get latest submitted report's measuredAt for date ordering constraint
  const latestSubmitted = db
    .select({ measuredAt: schema.reports.measuredAt })
    .from(schema.roomSubmissions)
    .innerJoin(schema.reports, eq(schema.roomSubmissions.reportId, schema.reports.id))
    .where(
      and(
        eq(schema.roomSubmissions.roomId, room.id),
        eq(schema.roomSubmissions.userId, user.id)
      )
    )
    .orderBy(desc(schema.reports.measuredAt))
    .limit(1)
    .all();

  const latestDate = latestSubmitted[0]?.measuredAt?.slice(0, 10) || "";

  // Get all confirmed reports within room date range, not yet submitted
  const reports = db
    .select({
      id: schema.reports.id,
      measuredAt: schema.reports.measuredAt,
      photoPath: schema.reports.photoPath,
      isInbody: schema.reports.isInbody,
      deviceType: schema.reports.deviceType,
      weight: schema.measurements.weight,
      skeletalMuscle: schema.measurements.skeletalMuscle,
      bodyFatPct: schema.measurements.bodyFatPct,
      inbodyScore: schema.measurements.inbodyScore,
    })
    .from(schema.reports)
    .leftJoin(schema.measurements, eq(schema.measurements.reportId, schema.reports.id))
    .where(
      and(
        eq(schema.reports.userId, user.id),
        eq(schema.reports.confirmed, true)
      )
    )
    .orderBy(schema.reports.measuredAt)
    .all();

  const available = reports
    .filter((r) => {
      const date = r.measuredAt?.slice(0, 10) || "";
      // Must be within room date range
      if (date < room.startDate || date > room.endDate) return false;
      // Must not already be submitted
      if (submittedIds.has(r.id)) return false;
      // Must be after latest submitted date (date ordering)
      if (latestDate && date <= latestDate) return false;
      return true;
    })
    .map((r) => ({
      id: r.id,
      measuredAt: r.measuredAt,
      photoUrl: r.photoPath ? `/photos/${r.photoPath}` : null,
      isInbody: r.isInbody,
      deviceType: r.deviceType,
      weight: r.weight,
      skeletalMuscle: r.skeletalMuscle,
      bodyFatPct: r.bodyFatPct,
      inbodyScore: r.inbodyScore,
    }));

  return c.json({
    available,
    submittedCount: submittedIds.size,
    latestSubmittedDate: latestDate || null,
  });
});

// POST /api/rooms/:slug/submit — submit a report to a room (mirror mode)
rooms.post("/api/rooms/:slug/submit", async (c) => {
  const user = requireAuth(c);
  const { slug } = c.req.param();
  const body = await c.req.json();
  const { reportId } = body;

  if (!reportId) return c.json({ error: "reportId required" }, 400);

  const room = db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, slug))
    .get();

  if (!room) return c.json({ error: "Room not found" }, 404);
  if (room.visibilityMode !== "mirror") {
    return c.json({ error: "This room uses open mode, not manual submission" }, 400);
  }

  const membership = db
    .select()
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, room.id),
        eq(schema.roomMembers.userId, user.id),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .get();

  if (!membership) return c.json({ error: "Not a member" }, 403);

  // Verify report belongs to user and is confirmed
  const report = db
    .select()
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.id, reportId),
        eq(schema.reports.userId, user.id),
        eq(schema.reports.confirmed, true)
      )
    )
    .get();

  if (!report) return c.json({ error: "Report not found or not confirmed" }, 404);

  // Check date within room range
  const reportDate = report.measuredAt?.slice(0, 10) || "";
  if (reportDate < room.startDate || reportDate > room.endDate) {
    return c.json({ error: "Report date is outside room competition period" }, 400);
  }

  // Check not already submitted
  const existing = db
    .select()
    .from(schema.roomSubmissions)
    .where(
      and(
        eq(schema.roomSubmissions.roomId, room.id),
        eq(schema.roomSubmissions.reportId, reportId)
      )
    )
    .get();

  if (existing) return c.json({ error: "Already submitted to this room" }, 400);

  // Check date ordering: must be after latest submitted report
  const latestSubmitted = db
    .select({ measuredAt: schema.reports.measuredAt })
    .from(schema.roomSubmissions)
    .innerJoin(schema.reports, eq(schema.roomSubmissions.reportId, schema.reports.id))
    .where(
      and(
        eq(schema.roomSubmissions.roomId, room.id),
        eq(schema.roomSubmissions.userId, user.id)
      )
    )
    .orderBy(desc(schema.reports.measuredAt))
    .limit(1)
    .all();

  const latestDate = latestSubmitted[0]?.measuredAt?.slice(0, 10) || "";
  if (latestDate && reportDate <= latestDate) {
    return c.json({ error: "Report must be newer than your latest submission" }, 400);
  }

  // Submit
  db.insert(schema.roomSubmissions)
    .values({
      roomId: room.id,
      userId: user.id,
      reportId,
    })
    .run();

  // Count total submissions after this one
  const myCount = db
    .select({ count: count() })
    .from(schema.roomSubmissions)
    .where(
      and(
        eq(schema.roomSubmissions.roomId, room.id),
        eq(schema.roomSubmissions.userId, user.id)
      )
    )
    .get();

  return c.json({
    ok: true,
    submissionCount: myCount?.count ?? 0,
  });
});

export default rooms;
