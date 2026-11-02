import type { LevelMap, LevelMapEntry, LevelMatch } from "@/lib/level-map";
import { formatPayLabel, type ParsedPay } from "@/lib/pay";

type Band = {
  levelMin: number;
  levelMax: number;
  anchor: number;
};

function hasBase(entry: LevelMapEntry): boolean {
  return entry.basePayMin != null && entry.basePayMax != null;
}

function levelGap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

function estimatedLabel(min: number, max: number): string {
  return min === max ? `about L${min} (estimated from pay)` : `about L${min}-${max} (estimated from pay)`;
}

function mentionsCompany(text: string, company: string): boolean {
  const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function companyEntries(company: string, map: LevelMap): LevelMapEntry[] {
  return map.entries.filter((entry) => entry.company.toLowerCase() === company.toLowerCase());
}

function resolveCompany(text: string, map: LevelMap, labeledCompany: string | null, matched: LevelMapEntry | null): string | null {
  if (matched) return matched.company;
  const labeled = labeledCompany?.trim();
  if (labeled) {
    const known = map.entries.find((entry) => entry.company.toLowerCase() === labeled.toLowerCase());
    if (known) return known.company;
  }
  const names = [...new Set(map.entries.map((entry) => entry.company))].sort((a, b) => b.length - a.length);
  return names.find((name) => mentionsCompany(text, name)) ?? null;
}

function baseBands(entries: LevelMapEntry[]): Band[] {
  const groups = new Map<string, LevelMapEntry[]>();
  for (const entry of entries) {
    if (!hasBase(entry)) continue;
    const key = `${entry.basePayMin}:${entry.basePayMax}`;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return [...groups.values()].map((group) => ({
    levelMin: Math.min(...group.map((entry) => entry.microsoftLevelMin)),
    levelMax: Math.max(...group.map((entry) => entry.microsoftLevelMax)),
    anchor: (group[0]!.basePayMin! + group[0]!.basePayMax!) / 2,
  }));
}

function medianBands(entries: LevelMapEntry[]): Band[] {
  return entries
    .filter((entry) => entry.medianTotalComp != null)
    .map((entry) => ({
      levelMin: entry.microsoftLevelMin,
      levelMax: entry.microsoftLevelMax,
      anchor: entry.medianTotalComp!,
    }));
}

function closestBand(bands: Band[], payMid: number, mode: "base" | "median"): Band | null {
  if (bands.length === 0) return null;
  const ranked = [...bands].sort((a, b) => Math.abs(a.anchor - payMid) - Math.abs(b.anchor - payMid) || a.levelMin - b.levelMin);
  const best = ranked[0]!;
  if (mode === "base") return best;
  const near = ranked.filter((band) => Math.abs(band.anchor - payMid) - Math.abs(best.anchor - payMid) <= 10_000);
  const levelMin = Math.min(...near.map((band) => band.levelMin));
  const levelMax = Math.max(...near.map((band) => band.levelMax));
  if (levelMax - levelMin > 2) return best;
  return { levelMin, levelMax, anchor: best.anchor };
}

function chooseComparison(
  pay: ParsedPay,
  companyRows: LevelMapEntry[],
  anchorRows: LevelMapEntry[],
): { mode: "base" | "median"; rows: LevelMapEntry[]; usedAnchor: boolean } | null {
  const companyBase = companyRows.some(hasBase);
  const companyMedian = companyRows.some((entry) => entry.medianTotalComp != null);
  const anchorBase = anchorRows.some(hasBase);
  const anchorMedian = anchorRows.some((entry) => entry.medianTotalComp != null);
  if (pay.payKind === "base") {
    if (companyBase) return { mode: "base", rows: companyRows, usedAnchor: false };
    if (anchorBase) return { mode: "base", rows: anchorRows, usedAnchor: true };
    return null;
  }
  if (pay.payKind === "total") {
    if (companyMedian) return { mode: "median", rows: companyRows, usedAnchor: false };
    if (anchorMedian) return { mode: "median", rows: anchorRows, usedAnchor: true };
    return null;
  }
  if (companyBase) return { mode: "base", rows: companyRows, usedAnchor: false };
  if (companyMedian) return { mode: "median", rows: companyRows, usedAnchor: false };
  if (anchorBase) return { mode: "base", rows: anchorRows, usedAnchor: true };
  if (anchorMedian) return { mode: "median", rows: anchorRows, usedAnchor: true };
  return null;
}

function sourceNote(usedAnchor: boolean, company: string | null, anchorCompany: string): string | null {
  if (!usedAnchor) return null;
  if (company && company.toLowerCase() !== anchorCompany.toLowerCase()) {
    return `Microsoft pay bands were used because ${company} has no matching pay data in the level map.`;
  }
  return "Microsoft pay bands were used because this company has no matching pay data in the level map.";
}

/**
 * When a company level token does not match, estimate a Microsoft-equivalent
 * band from posted pay. When a token does match, keep it and note pay that
 * is clearly closer to a different band.
 */
export function applyPayToMatch(
  match: LevelMatch,
  pay: ParsedPay,
  text: string,
  map: LevelMap,
  labeledCompany: string | null = null,
): LevelMatch {
  const base: LevelMatch = { ...match, levelFromPay: false, payNote: null, levelSourceNote: null };
  if (pay.payMin == null || pay.payMax == null) return base;
  const payMid = (pay.payMin + pay.payMax) / 2;
  const matched = match.entryId ? (map.entries.find((entry) => entry.id === match.entryId) ?? null) : null;
  const company = resolveCompany(text, map, labeledCompany, matched);
  const anchorRows = companyEntries(map.anchorCompany, map);
  const rows = company ? companyEntries(company, map) : [];
  const comparison = chooseComparison(pay, rows, anchorRows);
  if (!comparison) return base;
  const bands = comparison.mode === "base" ? baseBands(comparison.rows) : medianBands(comparison.rows);
  const estimated = closestBand(bands, payMid, comparison.mode);
  if (!estimated) return base;

  const tokenHit = match.entryId != null && match.microsoftLevelMin != null && match.microsoftLevelMax != null;
  if (!tokenHit) {
    const min = estimated.levelMin;
    const max = estimated.levelMax;
    return {
      ...base,
      levelRaw: match.levelRaw,
      microsoftLevel: min === max ? min : Math.round((min + max) / 2),
      microsoftLevelMin: min,
      microsoftLevelMax: max,
      levelLabel: estimatedLabel(min, max),
      confidence: "low",
      entryId: null,
      levelFromPay: true,
      levelSourceNote: sourceNote(comparison.usedAnchor, company, map.anchorCompany),
    };
  }

  const gap = levelGap(estimated.levelMin, estimated.levelMax, match.microsoftLevelMin!, match.microsoftLevelMax!);
  if (gap < 2) return base;
  const ownAnchor =
    comparison.mode === "base" && matched && hasBase(matched)
      ? (matched.basePayMin! + matched.basePayMax!) / 2
      : comparison.mode === "median" && matched?.medianTotalComp != null
        ? matched.medianTotalComp
        : null;
  if (ownAnchor != null && Math.abs(ownAnchor - payMid) - Math.abs(estimated.anchor - payMid) < 25_000) {
    return base;
  }
  const shown = formatPayLabel(pay) ?? "the posted range";
  const other =
    estimated.levelMin === estimated.levelMax ? `about L${estimated.levelMin}` : `about L${estimated.levelMin}-${estimated.levelMax}`;
  return {
    ...base,
    payNote: `Posted pay (${shown}) is closer to ${other} than to the level title match. The level title match was kept.`,
  };
}
