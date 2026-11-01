import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const entrySchema = z.object({
  id: z.string(),
  company: z.string(),
  companyLevel: z.string(),
  companyTitle: z.string().optional(),
  microsoftLevel: z.number().int(),
  displayLabel: z.string(),
  icNickname: z.string().nullable().optional(),
  verification: z.enum(["anchor", "example-from-owner", "unverified-example"]),
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

export function loadLevelMap(): LevelMap {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data", "level-map.json");
  const parsed = mapSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  cached = parsed;
  return parsed;
}

export function clearLevelMapCache(): void {
  cached = null;
}

export type LevelMatch = {
  levelRaw: string | null;
  microsoftLevel: number | null;
  levelLabel: string | null;
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
      levelLabel: null,
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
    levelLabel: best.entry.displayLabel,
  };
}
