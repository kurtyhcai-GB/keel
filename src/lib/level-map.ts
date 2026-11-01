import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const entrySchema = z.object({
  id: z.string(),
  company: z.string(),
  companyLevel: z.string(),
  companyTitle: z.string().optional(),
  microsoftLevel: z.number().int(),
  microsoftLevelMin: z.number().int(),
  microsoftLevelMax: z.number().int(),
  displayLabel: z.string(),
  icNickname: z.string().nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]),
  verification: z.enum(["anchor", "reviewed", "unverified-example", "example-from-owner"]),
  source: z.string(),
  notes: z.string(),
});

const mapSchema = z.object({
  schemaVersion: z.number(),
  anchorCompany: z.string(),
  disclaimer: z.string(),
  entries: z.array(entrySchema).min(1),
});

export type LevelMapEntry = z.infer<typeof entrySchema>;
export type LevelMap = z.infer<typeof mapSchema>;

let cached: LevelMap | null = null;

function overridesPath(): string {
  return path.join(process.cwd(), "data", "level-map-overrides.json");
}

function readOverrides(): Record<string, Partial<LevelMapEntry>> {
  try {
    return JSON.parse(readFileSync(overridesPath(), "utf8")) as Record<string, Partial<LevelMapEntry>>;
  } catch {
    return {};
  }
}

export function loadLevelMap(): LevelMap {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data", "level-map.json");
  const base = mapSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const overrides = readOverrides();
  const entries = base.entries.map((entry) => {
    const patch = overrides[entry.id];
    if (!patch) return entry;
    const microsoftLevelMin = patch.microsoftLevelMin ?? entry.microsoftLevelMin;
    const microsoftLevelMax = patch.microsoftLevelMax ?? entry.microsoftLevelMax;
    const confidence = patch.confidence ?? entry.confidence;
    const next = {
      ...entry,
      ...patch,
      microsoftLevelMin,
      microsoftLevelMax,
      microsoftLevel:
        microsoftLevelMin === microsoftLevelMax
          ? microsoftLevelMin
          : Math.round((microsoftLevelMin + microsoftLevelMax) / 2),
      confidence,
      displayLabel:
        microsoftLevelMin === microsoftLevelMax
          ? `Microsoft L${microsoftLevelMin}${entry.icNickname ? ` (${entry.icNickname})` : ""}`
          : `Microsoft L${microsoftLevelMin}–${microsoftLevelMax}`,
      verification:
        confidence === "high" && entry.verification === "unverified-example" ? "reviewed" : entry.verification,
    };
    return entrySchema.parse(next);
  });
  cached = { ...base, entries };
  return cached;
}

export function saveLevelMapOverride(input: {
  id: string;
  microsoftLevelMin: number;
  microsoftLevelMax: number;
  notes: string;
  confidence: LevelMapEntry["confidence"];
}): LevelMapEntry {
  const current = loadLevelMap();
  const entry = current.entries.find((item) => item.id === input.id);
  if (!entry) {
    throw new Error("Level row not found.");
  }
  const overrides = readOverrides();
  overrides[input.id] = {
    microsoftLevelMin: input.microsoftLevelMin,
    microsoftLevelMax: input.microsoftLevelMax,
    notes: input.notes,
    confidence: input.confidence,
  };
  writeFileSync(overridesPath(), JSON.stringify(overrides, null, 2));
  clearLevelMapCache();
  const updated = loadLevelMap().entries.find((item) => item.id === input.id);
  if (!updated) throw new Error("Level row not found.");
  return updated;
}

export function clearLevelMapCache(): void {
  cached = null;
}

export type LevelMatch = {
  levelRaw: string | null;
  microsoftLevel: number | null;
  microsoftLevelMin: number | null;
  microsoftLevelMax: number | null;
  levelLabel: string | null;
  confidence: LevelMapEntry["confidence"] | null;
  entryId: string | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Map a posting to a Microsoft-equivalent level using data/level-map.json.
 * A row is used only when the posting also names that company, so a bare
 * "L64" at an unmapped employer is not silently treated as Microsoft.
 */
export function matchLevel(text: string, map: LevelMap): LevelMatch {
  const lower = text.toLowerCase();
  const candidates: Array<{ entry: LevelMapEntry; distance: number; raw: string }> = [];

  for (const entry of map.entries) {
    const companyIndex = lower.indexOf(entry.company.toLowerCase());
    if (companyIndex < 0) continue;
    const token = entry.companyLevel;
    const patterns = /^\d+$/.test(token)
      ? [new RegExp(`\\bL\\s*${token}\\b`, "i"), new RegExp(`\\blevel\\s*${token}\\b`, "i")]
      : [new RegExp(`\\b${escapeRegExp(token)}\\b`, "i")];
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (!match || match.index === undefined) continue;
      candidates.push({
        entry,
        distance: Math.abs(companyIndex - match.index),
        raw: match[0],
      });
    }
  }

  if (candidates.length === 0) {
    const generic = text.match(/\b(?:L\s*\d{1,2}|E\s*\d{1,2}|ICT\s*\d|level\s+\d{2})\b/i);
    return {
      levelRaw: generic?.[0]?.replace(/\s+/g, " ") ?? null,
      microsoftLevel: null,
      microsoftLevelMin: null,
      microsoftLevelMax: null,
      levelLabel: null,
      confidence: null,
      entryId: null,
    };
  }

  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.entry.companyLevel.length - a.entry.companyLevel.length;
  });
  const best = candidates[0]!;
  return {
    levelRaw: best.raw,
    microsoftLevel: best.entry.microsoftLevel,
    microsoftLevelMin: best.entry.microsoftLevelMin,
    microsoftLevelMax: best.entry.microsoftLevelMax,
    levelLabel: best.entry.displayLabel,
    confidence: best.entry.confidence,
    entryId: best.entry.id,
  };
}
