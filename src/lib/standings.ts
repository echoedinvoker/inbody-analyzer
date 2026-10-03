import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { metricDiff, diffDecimals, rankKey, competitionRanks, winnerCutoff, zoneOf, applyMultiplier, type MetricKey } from "./room-utils.ts";

export type StandingEntry = {
  userId: number | null;
  name: string;
  rank: number;
  zone: "winner" | "loser";
  forfeited: boolean;
  forfeitId: number | null;
  entryKey: string;
};

export function computeFinalStandings(roomId: number): StandingEntry[] {
  const room = db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId)).get();
  if (!room) return [];

  const metric: MetricKey = room.mode === "bulk" ? "skeletalMuscle" : "bodyFatPct";
  const lowerIsBetter = metric === "bodyFatPct";
  const dec = diffDecimals(metric);

  const members = db
    .select({
      userId: schema.roomMembers.userId,
      name: schema.users.name,
      isGhost: schema.roomMembers.isGhost,
      weightMultiplier: schema.roomMembers.weightMultiplier,
    })
    .from(schema.roomMembers)
    .innerJoin(schema.users, eq(schema.roomMembers.userId, schema.users.id))
    .where(and(
      eq(schema.roomMembers.roomId, roomId),
      isNull(schema.roomMembers.leftAt)
    ))
    .all();

  const forfeitRows = db
    .select({
      id: schema.roomForfeits.id,
      userId: schema.roomForfeits.userId,
      name: schema.roomForfeits.name,
      userName: schema.users.name,
    })
    .from(schema.roomForfeits)
    .leftJoin(schema.users, eq(schema.roomForfeits.userId, schema.users.id))
    .where(eq(schema.roomForfeits.roomId, roomId))
    .all();

  const activeMemberIds = new Set(members.map(m => m.userId));
  const forfeitedUserIds = new Set<number>();
  for (const f of forfeitRows) {
    if (f.userId != null && activeMemberIds.has(f.userId)) {
      forfeitedUserIds.add(f.userId);
    }
  }

  const scored: Array<{ userId: number; name: string; sortKey: number }> = [];

  for (const m of members) {
    if (m.isGhost) continue;
    if (forfeitedUserIds.has(m.userId)) continue;

    const isMirror = room.visibilityMode === "mirror";
    let rows;
    if (isMirror) {
      rows = db
        .select({
          measuredAt: schema.reports.measuredAt,
          bodyFatPct: schema.measurements.bodyFatPct,
          skeletalMuscle: schema.measurements.skeletalMuscle,
          inbodyScore: schema.measurements.inbodyScore,
        })
        .from(schema.roomSubmissions)
        .innerJoin(schema.reports, eq(schema.roomSubmissions.reportId, schema.reports.id))
        .innerJoin(schema.measurements, eq(schema.measurements.reportId, schema.reports.id))
        .where(and(
          eq(schema.roomSubmissions.roomId, roomId),
          eq(schema.roomSubmissions.userId, m.userId)
        ))
        .orderBy(schema.reports.measuredAt)
        .all();
    } else {
      rows = db
        .select({
          measuredAt: schema.reports.measuredAt,
          bodyFatPct: schema.measurements.bodyFatPct,
          skeletalMuscle: schema.measurements.skeletalMuscle,
          inbodyScore: schema.measurements.inbodyScore,
        })
        .from(schema.measurements)
        .innerJoin(schema.reports, eq(schema.measurements.reportId, schema.reports.id))
        .where(and(
          eq(schema.reports.userId, m.userId),
          eq(schema.reports.confirmed, true)
        ))
        .orderBy(schema.reports.measuredAt)
        .all()
        .filter(r => {
          const date = r.measuredAt?.slice(0, 10) || "";
          return date >= room.startDate && date <= room.endDate;
        });
    }

    if (rows.length < 2) continue;
    const firstVal = rows[0]![metric] as number | null;
    const lastVal = rows[rows.length - 1]![metric] as number | null;
    if (firstVal == null || lastVal == null) continue;

    const multiplier = m.weightMultiplier ?? 1.0;
    const rawDiffVal = metricDiff(metric, firstVal, lastVal);
    if (rawDiffVal == null) continue;
    const rawRounded = rankKey(rawDiffVal, dec);
    const { value: weightedDiff } = applyMultiplier(rawRounded, multiplier, lowerIsBetter);
    const sortKey = rankKey(weightedDiff, dec);

    scored.push({ userId: m.userId, name: m.name, sortKey });
  }

  scored.sort((a, b) => {
    const cmp = lowerIsBetter ? a.sortKey - b.sortKey : b.sortKey - a.sortKey;
    if (cmp !== 0) return cmp;
    return a.userId - b.userId;
  });

  const ranks = competitionRanks(scored.map(s => s.sortKey));

  const activeForfeitEntries = forfeitRows.filter(f => {
    if (f.userId != null) {
      if (!activeMemberIds.has(f.userId)) return false;
      const member = members.find(m => m.userId === f.userId);
      return member && !member.isGhost;
    }
    return true;
  });

  const forfeitRank = scored.length + 1;
  const totalParticipants = scored.length + activeForfeitEntries.length;

  const result: StandingEntry[] = [
    ...scored.map((s, i) => ({
      userId: s.userId as number | null,
      name: s.name,
      rank: ranks[i],
      zone: zoneOf(ranks[i], totalParticipants),
      forfeited: false,
      forfeitId: null,
      entryKey: `u:${s.userId}`,
    })),
    ...activeForfeitEntries.map(f => ({
      userId: f.userId as number | null,
      name: (f.userId ? f.userName : f.name) as string,
      rank: forfeitRank,
      zone: zoneOf(forfeitRank, totalParticipants),
      forfeited: true,
      forfeitId: f.userId ? null : f.id,
      entryKey: f.userId ? `u:${f.userId}` : `f:${f.id}`,
    })),
  ];

  return result;
}
