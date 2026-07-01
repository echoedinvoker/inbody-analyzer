export function isRoomEnded(endDate: string, today?: string): boolean {
  const t = today ?? new Date().toISOString().slice(0, 10);
  return endDate <= t;
}

export function applyMirrorFilter<T extends { measuredAt: string | null }>(
  rows: T[],
  opts: { isMe: boolean; isEnded: boolean; myLatestDate: string },
): T[] {
  if (opts.isMe || opts.isEnded) return rows;
  return rows.filter((row, idx) => {
    if (idx === 0) return true;
    if (!opts.myLatestDate) return false;
    return opts.myLatestDate >= (row.measuredAt?.slice(0, 10) ?? "");
  });
}

export function applyDateMirrorFilter(
  dates: string[],
  opts: { isEnded: boolean; myLatestDate: string },
): number {
  if (opts.isEnded) return dates.length;
  return dates.filter((date, idx) => {
    if (idx === 0) return true;
    return opts.myLatestDate >= date;
  }).length;
}

export function resolveRankType(opts: {
  isMirror: boolean; isEnded: boolean;
  myLatestDate: string; maxOtherDate: string;
}): { rankType: "real" | "estimated"; shouldComputeRange: boolean } {
  if (!opts.isMirror || opts.isEnded) return { rankType: "real", shouldComputeRange: false };
  const isReal = opts.myLatestDate >= opts.maxOtherDate;
  return { rankType: isReal ? "real" : "estimated", shouldComputeRange: !isReal };
}

export function computeHasHidden<T extends { measuredAt: string | null }>(
  rows: T[],
  opts: { isMirror: boolean; isEnded: boolean; isMe: boolean; myLatestDate: string },
): boolean {
  if (!opts.isMirror || opts.isEnded || opts.isMe) return false;
  return rows.some((row, idx) => {
    if (idx === 0) return false;
    return (row.measuredAt?.slice(0, 10) ?? "") > opts.myLatestDate;
  });
}

export function classifyMember(
  actualCount: number,
  minSubs: number,
): "no_participation" | "below_minimum" | "qualified" {
  if (actualCount < 2) return "no_participation";
  if (actualCount < minSubs) return "below_minimum";
  return "qualified";
}

export function applyMultiplier(
  rawDiff: number, multiplier: number, lowerIsBetter: boolean
): { value: number; isImprovement: boolean } {
  const isImprovement = lowerIsBetter ? rawDiff < 0 : rawDiff > 0;
  if (multiplier === 1.0 || rawDiff === 0) return { value: rawDiff, isImprovement };
  return {
    value: isImprovement ? rawDiff * multiplier : rawDiff / multiplier,
    isImprovement,
  };
}
