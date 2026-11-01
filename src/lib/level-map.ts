import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { levelAddInput, levelEditInput, levelRowIdInput } from "@/lib/schemas";

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
export type LevelMapOrigin = "researched" | "edited" | "added";
export type LevelMapRow = LevelMapEntry & { origin: LevelMapOrigin };
export type LevelMap = Omit<z.infer<typeof mapSchema>, "entries"> & {
  entries: LevelMapRow[];
  removed: LevelMapRow[];
};

type RowPatch = {
  companyLevel?: string;
  companyTitle?: string;
  microsoftLevelMin?: number;
  microsoftLevelMax?: number;
  confidence?: LevelMapEntry["confidence"];
  notes?: string;
};

type AddedRow = {
  id: string;
  company: string;
  companyLevel: string;
  companyTitle: string;
  microsoftLevelMin: number;
  microsoftLevelMax: number;
  confidence: LevelMapEntry["confidence"];
  notes: string;
  source: string;
};

type OverrideStore = {
  schemaVersion: 2;
  edits: Record<string, RowPatch>;
  added: AddedRow[];
  deleted: string[];
};

let cached: LevelMap | null = null;
let overridesPathOverride: string | null = null;

function overridesPath(): string {
  return overridesPathOverride ?? path.join(process.cwd(), "data", "level-map-overrides.json");
}

/** Tests point this at a temp file so they do not write the real overrides. */
export function setLevelMapOverridesPath(next: string | null): void {
  overridesPathOverride = next;
  clearLevelMapCache();
}

function emptyStore(): OverrideStore {
  return { schemaVersion: 2, edits: {}, added: [], deleted: [] };
}

function asPatch(value: unknown): RowPatch | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const patch: RowPatch = {};
  if (typeof row.companyLevel === "string") patch.companyLevel = row.companyLevel;
  if (typeof row.companyTitle === "string") patch.companyTitle = row.companyTitle;
  if (typeof row.microsoftLevelMin === "number") patch.microsoftLevelMin = row.microsoftLevelMin;
  if (typeof row.microsoftLevelMax === "number") patch.microsoftLevelMax = row.microsoftLevelMax;
  if (row.confidence === "high" || row.confidence === "medium" || row.confidence === "low") {
    patch.confidence = row.confidence;
  }
  if (typeof row.notes === "string") patch.notes = row.notes;
  return patch;
}

function asAdded(value: unknown): AddedRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.company !== "string" || typeof row.companyLevel !== "string") {
    return null;
  }
  if (typeof row.microsoftLevelMin !== "number" || typeof row.microsoftLevelMax !== "number") return null;
  if (row.confidence !== "high" && row.confidence !== "medium" && row.confidence !== "low") return null;
  return {
    id: row.id,
    company: row.company,
    companyLevel: row.companyLevel,
    companyTitle: typeof row.companyTitle === "string" ? row.companyTitle : "",
    microsoftLevelMin: row.microsoftLevelMin,
    microsoftLevelMax: row.microsoftLevelMax,
    confidence: row.confidence,
    notes: typeof row.notes === "string" ? row.notes : "",
    source: typeof row.source === "string" && row.source.trim() ? row.source : "Added on this machine",
  };
}

function readOverrides(): OverrideStore {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(/*turbopackIgnore: true*/ overridesPath(), "utf8"));
  } catch {
    return emptyStore();
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyStore();
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion === 2) {
    const edits: Record<string, RowPatch> = {};
    if (record.edits && typeof record.edits === "object" && !Array.isArray(record.edits)) {
      for (const [id, patch] of Object.entries(record.edits as Record<string, unknown>)) {
        const next = asPatch(patch);
        if (next) edits[id] = next;
      }
    }
    const added = Array.isArray(record.added)
      ? record.added.map(asAdded).filter((row): row is AddedRow => row !== null)
      : [];
    const deleted = Array.isArray(record.deleted)
      ? record.deleted.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    return { schemaVersion: 2, edits, added, deleted };
  }

  const edits: Record<string, RowPatch> = {};
  for (const [id, patch] of Object.entries(record)) {
    if (id === "schemaVersion" || id === "edits" || id === "added" || id === "deleted") continue;
    const next = asPatch(patch);
    if (next) edits[id] = next;
  }
  return { schemaVersion: 2, edits, added: [], deleted: [] };
}

function writeOverrides(store: OverrideStore): void {
  writeFileSync(/*turbopackIgnore: true*/ overridesPath(), `${JSON.stringify(store, null, 2)}\n`);
  clearLevelMapCache();
}

function formatDisplayLabel(min: number, max: number, icNickname?: string | null): string {
  if (min === max) {
    return `Microsoft L${min}${icNickname ? ` (${icNickname})` : ""}`;
  }
  return `Microsoft L${min}–${max}`;
}

function midpoint(min: number, max: number): number {
  return min === max ? min : Math.round((min + max) / 2);
}

function applyPatch(entry: LevelMapEntry, patch: RowPatch): LevelMapEntry {
  const microsoftLevelMin = patch.microsoftLevelMin ?? entry.microsoftLevelMin;
  const microsoftLevelMax = patch.microsoftLevelMax ?? entry.microsoftLevelMax;
  const confidence = patch.confidence ?? entry.confidence;
  const next = {
    ...entry,
    companyLevel: patch.companyLevel ?? entry.companyLevel,
    companyTitle: patch.companyTitle ?? entry.companyTitle,
    microsoftLevelMin,
    microsoftLevelMax,
    microsoftLevel: midpoint(microsoftLevelMin, microsoftLevelMax),
    confidence,
    notes: patch.notes ?? entry.notes,
    displayLabel: formatDisplayLabel(microsoftLevelMin, microsoftLevelMax, entry.icNickname),
    verification:
      confidence === "high" && entry.verification === "unverified-example" ? "reviewed" : entry.verification,
  };
  return entrySchema.parse(next);
}

function sameAsResearched(entry: LevelMapEntry, patch: RowPatch): boolean {
  const title = patch.companyTitle ?? entry.companyTitle ?? "";
  const baseTitle = entry.companyTitle ?? "";
  return (
    (patch.companyLevel ?? entry.companyLevel) === entry.companyLevel &&
    title === baseTitle &&
    (patch.microsoftLevelMin ?? entry.microsoftLevelMin) === entry.microsoftLevelMin &&
    (patch.microsoftLevelMax ?? entry.microsoftLevelMax) === entry.microsoftLevelMax &&
    (patch.confidence ?? entry.confidence) === entry.confidence &&
    (patch.notes ?? entry.notes) === entry.notes
  );
}

function addedToEntry(row: AddedRow): LevelMapEntry {
  return entrySchema.parse({
    id: row.id,
    company: row.company,
    companyLevel: row.companyLevel,
    companyTitle: row.companyTitle,
    microsoftLevelMin: row.microsoftLevelMin,
    microsoftLevelMax: row.microsoftLevelMax,
    microsoftLevel: midpoint(row.microsoftLevelMin, row.microsoftLevelMax),
    displayLabel: formatDisplayLabel(row.microsoftLevelMin, row.microsoftLevelMax, null),
    icNickname: null,
    confidence: row.confidence,
    verification: row.confidence === "high" ? "reviewed" : "unverified-example",
    source: row.source,
    notes: row.notes,
  });
}

function readBase(): z.infer<typeof mapSchema> {
  const file = path.join(process.cwd(), "data", "level-map.json");
  return mapSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function loadLevelMap(): LevelMap {
  if (cached) return cached;
  const base = readBase();
  const store = readOverrides();
  const removed = new Set(store.deleted);
  const entries: LevelMapRow[] = [];
  const removedRows: LevelMapRow[] = [];
  for (const entry of base.entries) {
    if (removed.has(entry.id)) {
      removedRows.push({ ...entry, origin: "researched" });
      continue;
    }
    const patch = store.edits[entry.id];
    if (!patch) {
      entries.push({ ...entry, origin: "researched" });
      continue;
    }
    entries.push({ ...applyPatch(entry, patch), origin: "edited" });
  }
  for (const row of store.added) {
    if (removed.has(row.id)) continue;
    entries.push({ ...addedToEntry(row), origin: "added" });
  }
  cached = { ...base, entries, removed: removedRows };
  return cached;
}

function requireRow(id: string): LevelMapRow {
  const entry = loadLevelMap().entries.find((item) => item.id === id);
  if (!entry) throw new AppError("Level row not found.", 404);
  return entry;
}

function slug(value: string): string {
  const next = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return next || "row";
}

export function saveLevelMapOverride(input: unknown): LevelMapRow {
  const parsed = levelEditInput.parse(input);
  const store = readOverrides();
  const addedIndex = store.added.findIndex((row) => row.id === parsed.id);
  if (addedIndex >= 0) {
    const current = store.added[addedIndex]!;
    store.added[addedIndex] = {
      ...current,
      companyLevel: parsed.companyLevel,
      companyTitle: parsed.companyTitle,
      microsoftLevelMin: parsed.microsoftLevelMin,
      microsoftLevelMax: parsed.microsoftLevelMax,
      confidence: parsed.confidence,
      notes: parsed.notes,
    };
    writeOverrides(store);
    return requireRow(parsed.id);
  }

  const base = readBase().entries.find((entry) => entry.id === parsed.id);
  if (!base || store.deleted.includes(parsed.id)) {
    throw new AppError("Level row not found.", 404);
  }
  const patch: RowPatch = {
    companyLevel: parsed.companyLevel,
    companyTitle: parsed.companyTitle,
    microsoftLevelMin: parsed.microsoftLevelMin,
    microsoftLevelMax: parsed.microsoftLevelMax,
    confidence: parsed.confidence,
    notes: parsed.notes,
  };
  if (sameAsResearched(base, patch)) {
    delete store.edits[parsed.id];
  } else {
    store.edits[parsed.id] = patch;
  }
  writeOverrides(store);
  return requireRow(parsed.id);
}

export function addLevelMapRow(input: unknown): LevelMapRow {
  const parsed = levelAddInput.parse(input);
  const store = readOverrides();
  const base = readBase();
  const taken = new Set<string>([
    ...base.entries.map((entry) => entry.id),
    ...store.added.map((row) => row.id),
  ]);
  const baseId = `user-${slug(parsed.company)}-${slug(parsed.companyLevel)}`;
  let id = baseId;
  let suffix = 2;
  while (taken.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  store.added.push({
    id,
    company: parsed.company,
    companyLevel: parsed.companyLevel,
    companyTitle: parsed.companyTitle,
    microsoftLevelMin: parsed.microsoftLevelMin,
    microsoftLevelMax: parsed.microsoftLevelMax,
    confidence: parsed.confidence,
    notes: parsed.notes,
    source: "Added on this machine",
  });
  store.deleted = store.deleted.filter((existing) => existing !== id);
  writeOverrides(store);
  return requireRow(id);
}

export function deleteLevelMapRow(input: unknown): void {
  const { id } = levelRowIdInput.parse(input);
  const store = readOverrides();
  const addedIndex = store.added.findIndex((row) => row.id === id);
  if (addedIndex >= 0) {
    store.added.splice(addedIndex, 1);
    writeOverrides(store);
    return;
  }
  const base = readBase().entries.find((entry) => entry.id === id);
  if (!base || store.deleted.includes(id)) {
    throw new AppError("Level row not found.", 404);
  }
  delete store.edits[id];
  store.deleted.push(id);
  writeOverrides(store);
}

export function resetLevelMapRow(input: unknown): LevelMapRow {
  const { id } = levelRowIdInput.parse(input);
  const store = readOverrides();
  if (store.added.some((row) => row.id === id)) {
    throw new AppError("This row was added on this machine, so there is no researched value to restore.", 400);
  }
  const base = readBase().entries.find((entry) => entry.id === id);
  if (!base) throw new AppError("Level row not found.", 404);
  delete store.edits[id];
  store.deleted = store.deleted.filter((existing) => existing !== id);
  writeOverrides(store);
  return requireRow(id);
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
 * Map a posting to a Microsoft-equivalent level using the researched map
 * plus any overrides saved on this machine. A row is used only when the
 * posting also names that company, so a bare "L64" at an unmapped employer
 * is not silently treated as Microsoft.
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
