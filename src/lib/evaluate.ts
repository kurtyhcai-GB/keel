import { AppError } from "@/lib/errors";
import {
  detectWorkModes,
  findLocationAndWorksiteMismatches,
  locationsMatch,
  overallFit,
  ruledOutReason as joinReasons,
  scorePreferences,
} from "@/lib/fit";
import { loadPrompt, parseModelJson, resolveProvider } from "@/lib/ai";
import { loadLevelMap, matchLevel, type LevelMap, type LevelMatch } from "@/lib/level-map";
import { applyPayToMatch } from "@/lib/level-pay";
import { HOURS_PER_YEAR, parsePay, type ParsedPay, type PayKind, type StoredPayRange } from "@/lib/pay";
import type {
  CitedFact,
  EvaluationDraft,
  PreferenceMismatch,
  PreferenceView,
  ScorePoint,
} from "@/lib/types";
import { z } from "zod";

export const DEFAULT_SKILLS_WEIGHT = 65;
export const SCORE_WEIGHTS = {
  skills: DEFAULT_SKILLS_WEIGHT / 100,
  preferences: (100 - DEFAULT_SKILLS_WEIGHT) / 100,
} as const;

export function blendOverall(
  skillsScore: number,
  preferencesScore: number | null,
  skillsWeight = DEFAULT_SKILLS_WEIGHT,
): number {
  const skills = clampScore(skillsScore);
  if (preferencesScore == null) return skills;
  const weight = Math.max(0, Math.min(100, Math.round(skillsWeight)));
  return clampScore(skills * (weight / 100) + clampScore(preferencesScore) * ((100 - weight) / 100));
}

const pointSchema = z.object({
  text: z.string().min(1),
  factIds: z.array(z.string()).default([]),
});

/** Optional text. A non-string becomes null so one bad field cannot fail the evaluation. */
const looseString = z.preprocess((value) => {
  if (value == null) return value;
  if (typeof value === "string") return value;
  return null;
}, z.string().nullish()).catch(null);

const looseInt = z.preprocess((value) => {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}, z.number().int().nullish()).catch(null);

const looseOptionalScore = z.preprocess((value) => {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}, z.number().nullish()).catch(null);

function payToken(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const text = value
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ");
  return text || null;
}

/** year/yearly/annual/per year -> year; hour/hourly/per hour -> hour; anything else -> null. */
function normalizePayPeriod(value: unknown): "year" | "hour" | null {
  const text = payToken(value);
  if (text == null) return null;
  if (["year", "yearly", "annual", "annually", "per year", "a year"].includes(text)) return "year";
  if (["hour", "hourly", "per hour", "an hour"].includes(text)) return "hour";
  return null;
}

/** base/base pay/base salary -> base; total/total comp/TC -> total; anything else -> null. */
function normalizePayKind(value: unknown): "base" | "total" | null {
  const text = payToken(value);
  if (text == null) return null;
  if (["base", "base pay", "base salary"].includes(text)) return "base";
  if (["total", "total comp", "total compensation", "tc"].includes(text)) return "total";
  return null;
}

/** us/u.s./united states/national -> us; location/local/metro -> location; anything else -> other. */
function normalizePayScope(value: unknown): "us" | "location" | "other" | null {
  if (value == null || value === "") return null;
  const text = payToken(value);
  if (text == null) return "other";
  if (["us", "usa", "united states", "national"].includes(text)) return "us";
  if (["location", "local", "metro"].includes(text)) return "location";
  return "other";
}

/**
 * JSON numbers, or strings like "$119,800" and "120k". Unparseable values stay
 * as-is so the number schema fails and `.catch(null)` clears the field.
 */
function coerceMoney(value: unknown): unknown {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith("-") || /^\(.*\)$/.test(trimmed);
  let body = trimmed.replace(/[()]/g, "").replace(/[$£€,\s]/g, "").replace(/usd|cad|eur|gbp/gi, "");
  let multiplier = 1;
  const suffix = body.match(/[kKmM]$/);
  if (suffix) {
    multiplier = suffix[0].toLowerCase() === "k" ? 1000 : 1_000_000;
    body = body.slice(0, -1);
  }
  if (!/^\d+(\.\d+)?$/.test(body)) return value;
  const amount = Number(body) * multiplier;
  if (!Number.isFinite(amount)) return value;
  return negative ? -Math.abs(amount) : amount;
}

const looseMoney = z.preprocess(coerceMoney, z.number().nullish()).catch(null);
const loosePayPeriod = z.preprocess(normalizePayPeriod, z.enum(["year", "hour"]).nullish()).catch(null);
const loosePayKind = z.preprocess(normalizePayKind, z.enum(["base", "total"]).nullish()).catch(null);
const loosePayScope = z.preprocess(normalizePayScope, z.enum(["us", "location", "other"]).nullish()).catch(null);

const payRangeSchema = z.object({
  min: looseMoney,
  max: looseMoney,
  currency: looseString,
  period: loosePayPeriod,
  kind: loosePayKind,
  scope: loosePayScope,
  label: looseString,
});

/** Keep ranges that have both ends. A bad entry is dropped; it does not fail the array. */
const loosePayRanges = z.preprocess((value) => {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const kept: Array<z.infer<typeof payRangeSchema>> = [];
  for (const item of value) {
    const parsed = payRangeSchema.safeParse(item);
    if (!parsed.success || parsed.data.min == null || parsed.data.max == null) continue;
    kept.push(parsed.data);
  }
  return kept;
}, z.array(payRangeSchema).nullable()).catch(null);

function loosePoints() {
  return z.preprocess((value) => {
    if (value == null) return [];
    if (!Array.isArray(value)) return [];
    const kept: Array<z.infer<typeof pointSchema>> = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const record = item as { text?: unknown; factIds?: unknown };
      const factIds = Array.isArray(record.factIds) ? record.factIds.filter((id): id is string => typeof id === "string") : [];
      const parsed = pointSchema.safeParse({ text: record.text, factIds });
      if (parsed.success) kept.push(parsed.data);
    }
    return kept;
  }, z.array(pointSchema)).catch([]);
}

const modelSchema = z.object({
  title: looseString,
  company: looseString,
  requisitionId: looseString,
  location: looseString,
  worksite: looseString,
  levelRaw: looseString,
  microsoftLevel: looseInt,
  levelLabel: looseString,
  payMin: looseMoney,
  payMax: looseMoney,
  payCurrency: looseString,
  payPeriod: loosePayPeriod,
  payRaw: looseString,
  payKind: loosePayKind,
  payRanges: loosePayRanges,
  skillsScore: z.number(),
  preferencesScore: looseOptionalScore,
  overallScore: z.number(),
  summary: z.string().min(1),
  strengths: loosePoints(),
  gaps: loosePoints(),
  dealBreakers: loosePoints(),
});

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function labeledLine(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const match = text.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, "im"));
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function parseWorksite(text: string): string | null {
  const hybridDays =
    text.match(/hybrid[^.\n]{0,48}?(\d+)\s*days?/i) ||
    text.match(/(\d+)\s*days?[^.\n]{0,48}?hybrid/i) ||
    text.match(/(\d+)\s*days?\s+in\s+(?:the\s+)?office/i);
  if (/hybrid/i.test(text) || hybridDays) {
    return hybridDays?.[1] ? `Hybrid: ${hybridDays[1]} days` : "Hybrid";
  }
  const remote = /\bremote\b/i.test(text);
  const onsite = /on-?site|in[- ]office/i.test(text);
  if (remote && onsite) return "Hybrid";
  if (remote) return "Remote";
  if (onsite) return "On-site";
  return null;
}

function cityTokens(text: string): string[] {
  const found: string[] = [];
  const pattern = /\b([A-Z][a-zA-Z]+(?:[ .'-][A-Z][a-zA-Z]+){0,3},\s*[A-Z]{2})\b/g;
  for (const match of text.matchAll(pattern)) {
    found.push(match[1].replace(/\s+/g, " "));
  }
  if (/\bWashington,?\s+D\.?C\.?\b/i.test(text)) found.push("Washington, DC");
  return found;
}

function uniqueCities(cities: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const city of cities) {
    const key = city.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(city);
  }
  return unique;
}

function proseCities(text: string): string[] {
  const snippets: string[] = [];
  const hub = text.match(/hub locations?\s*[-–:]\s*([^\n]+)/i);
  if (hub?.[1]) snippets.push(hub[1]);
  for (const match of text.matchAll(/\blocated\b[^\n.]{0,160}/gi)) {
    snippets.push(match[0]);
  }
  return uniqueCities(snippets.flatMap(cityTokens));
}

function chooseLocation(text: string, preferences: PreferenceView | null | undefined): string | null {
  const labeled = labeledLine(text, ["location", "city"]);
  const labeledCities = labeled ? cityTokens(labeled) : [];
  if (labeled && labeledCities.length <= 1) return labeled;
  const pool = labeledCities.length > 1 ? labeledCities : proseCities(text);
  if (pool.length === 0) return labeled;
  const preferred = preferences?.locations ?? [];
  return pool.find((city) => locationsMatch(city, preferred)) ?? pool[0] ?? labeled;
}

export function parsePosting(text: string, map: LevelMap, preferences?: PreferenceView | null) {
  const title =
    labeledLine(text, ["title", "role", "position"]) ??
    text
      .split(/\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !/^(company|employer|location|worksite|job id|level)\b/i.test(line)) ??
    null;
  const company = labeledLine(text, ["company", "employer"]);
  const pay = parsePay(text);
  const level = applyPayToMatch(matchLevel(text, map), pay, text, map, company);
  return {
    title: title?.slice(0, 160) ?? null,
    company,
    requisitionId:
      text.match(
        /(?:requisition(?:\s*id)?|req(?:uisition)?\s*id|job\s*id|job\s*#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{2,})/i,
      )?.[1] ?? null,
    location: chooseLocation(text, preferences),
    worksite: parseWorksite(text),
    payMin: pay.payMin,
    payMax: pay.payMax,
    payCurrency: pay.payCurrency,
    payPeriod: pay.payPeriod,
    payRaw: pay.payRaw,
    payRanges: pay.payRanges,
    ...level,
  };
}

/**
 * Location outside the saved list, or hybrid/on-site when the user wants remote
 * only, pauses evaluation. Seattle-area cities count as one metro. These pauses
 * are not score penalties.
 */
export function findPreferencePauses(input: {
  jobText: string;
  preferences: PreferenceView | null;
  levelMap?: LevelMap;
}): PreferenceMismatch[] {
  const parsed = parsePosting(input.jobText, input.levelMap ?? loadLevelMap(), input.preferences);
  const modes = detectWorkModes(parsed.worksite, input.jobText);
  return findLocationAndWorksiteMismatches({
    location: parsed.location,
    modes,
    preferences: input.preferences,
  });
}

export function ruledOutReason(mismatches: PreferenceMismatch[]): string {
  return joinReasons(mismatches);
}

function baselineBlob(facts: CitedFact[]): string {
  return facts
    .map((fact) =>
      [fact.title, fact.company, fact.summary, fact.impact, fact.skills.join(" "), fact.sourceExcerpt]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n")
    .toLowerCase();
}

function factLabel(fact: CitedFact): string {
  if (fact.title && fact.company) return `${fact.title} at ${fact.company}`;
  return fact.title || fact.company || fact.id;
}

export function scoreLocally(input: {
  jobText: string;
  facts: CitedFact[];
  preferences: PreferenceView | null;
  levelMap?: LevelMap;
  acknowledgedMismatches?: PreferenceMismatch[];
}): EvaluationDraft {
  const map = input.levelMap ?? loadLevelMap();
  const parsed = parsePosting(input.jobText, map, input.preferences);
  const warnings: string[] = [];
  const blob = baselineBlob(input.facts);
  const phrases = [
    ...new Set(
      input.facts
        .flatMap((fact) => fact.skills)
        .map((skill) => skill.trim().toLowerCase())
        .filter((skill) => skill.length >= 3),
    ),
  ];
  const hits = phrases.filter((phrase) => input.jobText.toLowerCase().includes(phrase));
  const skillsScore = phrases.length === 0 ? 0 : clampScore((100 * hits.length) / phrases.length);
  if (input.facts.length === 0) {
    warnings.push("The baseline has no facts yet, so the skills score is 0.");
  } else if (phrases.length === 0) {
    warnings.push("The baseline facts have no skills to compare.");
  }

  const strengths: ScorePoint[] = hits.map((phrase) => {
    const factIds = input.facts
      .filter((fact) =>
        fact.skills.some((skill) => skill.toLowerCase() === phrase) ||
        `${fact.summary} ${fact.impact ?? ""}`.toLowerCase().includes(phrase),
      )
      .map((fact) => fact.id);
    const cited = input.facts.filter((fact) => factIds.includes(fact.id)).map(factLabel);
    return {
      text: `The baseline records "${phrase}"${cited.length ? ` (${cited.join("; ")})` : ""}.`,
      factIds,
    };
  });

  const gaps: ScorePoint[] = input.jobText
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+\S/.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, "").trim())
    .filter((line) => line.length >= 3)
    .filter((line) => {
      const lower = line.toLowerCase();
      if (blob.includes(lower)) return false;
      if (phrases.some((phrase) => lower.includes(phrase))) return false;
      return true;
    })
    .slice(0, 6)
    .map((line) => ({
      text: `The posting says "${line}". The baseline does not record it.`,
      factIds: [],
    }));

  const acknowledged = input.acknowledgedMismatches ?? findPreferencePauses({
    jobText: input.jobText,
    preferences: input.preferences,
    levelMap: map,
  });
  let preferencesScore: number | null = null;
  let dealBreakers: ScorePoint[] = [];
  let preferenceParts: EvaluationDraft["preferenceParts"] = [];
  if (!input.preferences) {
    warnings.push("Preferences are not set, so the overall score follows the skills score only.");
  } else {
    const preferenceScore = scorePreferences({
      location: parsed.location,
      modes: detectWorkModes(parsed.worksite, input.jobText),
      jobText: input.jobText,
      microsoftLevelMin: parsed.microsoftLevelMin,
      microsoftLevelMax: parsed.microsoftLevelMax,
      levelLabel: parsed.levelLabel,
      preferences: input.preferences,
      mismatches: acknowledged,
      levelFromPay: parsed.levelFromPay,
      payNote: parsed.payNote,
      levelSourceNote: parsed.levelSourceNote,
    });
    preferencesScore = preferenceScore.preferencesScore;
    dealBreakers = preferenceScore.dealBreakers;
    preferenceParts = preferenceScore.parts;
    warnings.push(...preferenceScore.warnings);
  }
  if (parsed.payNote) warnings.push(parsed.payNote);
  if (parsed.levelFromPay) {
    warnings.push("The Microsoft-equivalent level was estimated from posted pay, not from a level title.");
  }

  const skillsWeight = input.preferences?.skillsWeight ?? DEFAULT_SKILLS_WEIGHT;
  const overallScore = overallFit(skillsScore, preferencesScore, skillsWeight, dealBreakers.length);

  const summary = [
    `Skills and experience match is ${skillsScore} out of 100 against ${input.facts.length} baseline fact${input.facts.length === 1 ? "" : "s"}.`,
    preferencesScore == null
      ? "Preferences are not set, so the overall score follows skills only."
      : `Preferences match is ${preferencesScore} out of 100. Overall is ${overallScore}, using your ${skillsWeight}/${100 - skillsWeight} skills-to-preferences weight.`,
    "This local score only restates the baseline and the posting. It does not add employers or scope.",
  ].join(" ");

  return {
    ...parsed,
    skillsScore,
    preferencesScore,
    overallScore,
    summary,
    strengths,
    gaps,
    dealBreakers,
    preferenceParts,
    warnings,
    mismatches: acknowledged,
    provider: "local",
    model: null,
  };
}

function knownIds(facts: CitedFact[]): Set<string> {
  return new Set(facts.map((fact) => fact.id));
}

function keepKnown(points: ScorePoint[], ids: Set<string>, dropIfEmpty: boolean, warnings: string[]): ScorePoint[] {
  const kept: ScorePoint[] = [];
  for (const point of points) {
    const factIds = point.factIds.filter((id) => ids.has(id));
    if (dropIfEmpty && factIds.length === 0) {
      warnings.push("A model claim was removed because it did not cite a baseline fact.");
      continue;
    }
    if (factIds.length !== point.factIds.length) {
      warnings.push("A citation was removed because that fact id is not in the baseline.");
    }
    kept.push({ text: point.text, factIds });
  }
  return kept;
}

function blankLevel(): LevelMatch {
  return {
    levelRaw: null,
    microsoftLevel: null,
    microsoftLevelMin: null,
    microsoftLevelMax: null,
    levelLabel: null,
    confidence: null,
    entryId: null,
    levelFromPay: false,
    payNote: null,
    levelSourceNote: null,
  };
}

function kindFromRaw(payRaw: string | null, explicit: PayKind | null): PayKind | null {
  if (explicit) return explicit;
  if (!payRaw) return null;
  if (/base pay|base salary/i.test(payRaw)) return "base";
  if (/total compensation|total comp/i.test(payRaw)) return "total";
  return null;
}

function mergedPay(
  value: {
    payMin?: number | null;
    payMax?: number | null;
    payCurrency?: string | null;
    payPeriod?: "year" | "hour" | null;
    payRaw?: string | null;
    payKind?: PayKind | null;
    payRanges?: Array<{
      min: number;
      max: number;
      currency?: string | null;
      period?: "year" | "hour" | null;
      kind?: PayKind | null;
      scope?: "us" | "location" | "other" | null;
      label?: string | null;
    }> | null;
  },
  local: EvaluationDraft,
): ParsedPay {
  let payMin = value.payMin ?? local.payMin;
  let payMax = value.payMax ?? local.payMax;
  let payPeriod = value.payPeriod ?? (local.payPeriod === "hour" || local.payPeriod === "year" ? local.payPeriod : null);
  if (payPeriod === "hour" && payMin != null) {
    payMin = Math.round(payMin * HOURS_PER_YEAR);
    payMax = payMax == null ? null : Math.round(payMax * HOURS_PER_YEAR);
    payPeriod = "year";
  }
  const payRaw = value.payRaw ?? local.payRaw;
  const sourceRanges = value.payRanges ?? local.payRanges ?? [];
  const payRanges: StoredPayRange[] = sourceRanges.map((range) => {
    const hourly = range.period === "hour";
    const scale = hourly ? HOURS_PER_YEAR : 1;
    const kind = range.kind === "base" || range.kind === "total" ? range.kind : null;
    const scope = range.scope === "us" || range.scope === "location" || range.scope === "other" ? range.scope : "other";
    return {
      min: Math.round(range.min * scale),
      max: Math.round(range.max * scale),
      currency: range.currency ?? "USD",
      period: "year" as const,
      kind,
      scope,
      label: range.label ?? "",
    };
  });
  return {
    payMin: payMin ?? null,
    payMax: payMax ?? null,
    payCurrency: value.payCurrency ?? local.payCurrency ?? (payMin != null ? "USD" : null),
    payPeriod: payMin != null ? "year" : null,
    payRaw: payRaw ?? null,
    payKind: kindFromRaw(payRaw ?? null, value.payKind ?? null),
    payRanges,
  };
}

function mergedLevelBand(
  merged: {
    company: string | null;
    levelRaw: string | null;
    levelLabel: string | null;
    microsoftLevel: number | null;
    microsoftLevelMin: number | null;
    microsoftLevelMax: number | null;
    levelFromPay?: boolean;
    payNote?: string | null;
  },
  pay: ParsedPay,
  map: LevelMap,
): LevelMatch {
  const probe = [merged.company, merged.levelRaw, merged.levelLabel].filter(Boolean).join("\n");
  const token = probe ? matchLevel(probe, map) : blankLevel();
  const withPay = applyPayToMatch(token, pay, probe, map, merged.company);
  const modelLevel = merged.microsoftLevel;
  const tokenHit = token.entryId != null && token.microsoftLevelMin != null && token.microsoftLevelMax != null;
  if (
    tokenHit &&
    (modelLevel == null || (modelLevel >= token.microsoftLevelMin! && modelLevel <= token.microsoftLevelMax!))
  ) {
    return {
      ...token,
      levelLabel: merged.levelLabel ?? token.levelLabel,
      microsoftLevel: modelLevel ?? token.microsoftLevel,
      payNote: withPay.payNote,
      levelFromPay: false,
      levelSourceNote: null,
    };
  }
  if (modelLevel != null) {
    return {
      ...blankLevel(),
      microsoftLevel: modelLevel,
      microsoftLevelMin: modelLevel,
      microsoftLevelMax: modelLevel,
      levelLabel: merged.levelLabel,
      levelRaw: merged.levelRaw,
    };
  }
  if (withPay.levelFromPay) return { ...withPay, levelRaw: merged.levelRaw ?? withPay.levelRaw };
  return {
    ...blankLevel(),
    levelRaw: merged.levelRaw,
    microsoftLevel: merged.microsoftLevel,
    microsoftLevelMin: merged.microsoftLevelMin,
    microsoftLevelMax: merged.microsoftLevelMax,
    levelLabel: merged.levelLabel,
    levelFromPay: merged.levelFromPay ?? false,
    payNote: merged.payNote ?? null,
  };
}

function combineMismatches(prior: PreferenceMismatch[], detected: PreferenceMismatch[]): PreferenceMismatch[] {
  const seen = new Set(prior.map((item) => item.kind));
  return [...prior, ...detected.filter((item) => !seen.has(item.kind))];
}

export function normalizeModelEvaluation(
  raw: unknown,
  input: {
    facts: CitedFact[];
    preferences: PreferenceView | null;
    jobText: string;
    acknowledgedMismatches?: PreferenceMismatch[];
  },
  local: EvaluationDraft,
  meta: { provider: string; model: string },
): EvaluationDraft {
  const parsed = modelSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => (issue.path.length > 0 ? issue.path.join(".") : "(root)"))),
    ];
    const message = `The model returned JSON that did not match the evaluation schema (${fields.join(", ")}).`;
    console.error(message);
    throw new AppError(message, 502);
  }
  const warnings: string[] = [];
  const ids = knownIds(input.facts);
  const strengths = keepKnown(parsed.data.strengths, ids, true, warnings);
  const gaps = keepKnown(parsed.data.gaps, ids, false, warnings);
  const skillsScore = clampScore(parsed.data.skillsScore);
  if (!input.preferences && parsed.data.preferencesScore != null) {
    warnings.push("Preferences are not set. The model preferences score was discarded.");
  }
  const value = parsed.data;
  const payRanges =
    value.payRanges == null
      ? null
      : value.payRanges.flatMap((range) =>
          range.min != null && range.max != null ? [{ ...range, min: range.min, max: range.max }] : [],
        );
  const location = value.location ?? local.location;
  const worksite = value.worksite ?? local.worksite;
  const levelRaw = value.levelRaw ?? local.levelRaw;
  const company = value.company ?? local.company;
  const pay = mergedPay({ ...value, payRanges }, local);
  const band = mergedLevelBand(
    {
      company,
      levelRaw,
      levelLabel: value.levelLabel ?? local.levelLabel,
      microsoftLevel: value.microsoftLevel ?? local.microsoftLevel,
      microsoftLevelMin: local.microsoftLevelMin ?? null,
      microsoftLevelMax: local.microsoftLevelMax ?? null,
      levelFromPay: local.levelFromPay,
      payNote: local.payNote,
    },
    pay,
    loadLevelMap(),
  );
  const priorMismatches = input.acknowledgedMismatches ?? local.mismatches;
  const modes = detectWorkModes(worksite, input.jobText);
  const detected = input.preferences
    ? findLocationAndWorksiteMismatches({ location, modes, preferences: input.preferences })
    : [];
  const mismatches = combineMismatches(priorMismatches, detected);
  let preferencesScore = local.preferencesScore;
  let dealBreakers = local.dealBreakers;
  let preferenceParts = local.preferenceParts;
  if (input.preferences) {
    const preferenceScore = scorePreferences({
      location,
      modes,
      jobText: input.jobText,
      microsoftLevelMin: band.microsoftLevelMin,
      microsoftLevelMax: band.microsoftLevelMax,
      levelLabel: band.levelLabel,
      preferences: input.preferences,
      mismatches,
      levelFromPay: band.levelFromPay,
      payNote: band.payNote,
      levelSourceNote: band.levelSourceNote,
    });
    preferencesScore = preferenceScore.preferencesScore;
    dealBreakers = preferenceScore.dealBreakers;
    preferenceParts = preferenceScore.parts;
    warnings.push(...preferenceScore.warnings);
  }
  if (band.payNote) warnings.push(band.payNote);
  if (band.levelFromPay) {
    warnings.push("The Microsoft-equivalent level was estimated from posted pay, not from a level title.");
  }
  const overallScore = overallFit(
    skillsScore,
    preferencesScore,
    input.preferences?.skillsWeight ?? DEFAULT_SKILLS_WEIGHT,
    dealBreakers.length,
  );
  return {
    title: value.title ?? local.title,
    company,
    requisitionId: value.requisitionId ?? local.requisitionId,
    location,
    worksite,
    levelRaw,
    microsoftLevel: band.microsoftLevel,
    microsoftLevelMin: band.microsoftLevelMin,
    microsoftLevelMax: band.microsoftLevelMax,
    levelLabel: band.levelLabel,
    payMin: pay.payMin,
    payMax: pay.payMax,
    payCurrency: pay.payCurrency,
    payPeriod: pay.payPeriod,
    payRaw: pay.payRaw,
    payRanges: pay.payRanges,
    levelFromPay: band.levelFromPay,
    payNote: band.payNote,
    confidence: band.confidence,
    skillsScore,
    preferencesScore,
    overallScore,
    summary: value.summary,
    strengths,
    gaps,
    dealBreakers,
    preferenceParts,
    warnings,
    mismatches,
    provider: meta.provider,
    model: meta.model,
  };
}

function buildEvaluationMessage(input: {
  jobText: string;
  facts: CitedFact[];
  preferences: PreferenceView | null;
  levelMap: LevelMap;
  acknowledgedMismatches?: PreferenceMismatch[];
}): string {
  const held = input.acknowledgedMismatches ?? [];
  return [
    "Respond with JSON only.",
    "The server recomputes overallScore from skillsScore, preferencesScore, and the user's skillsWeight. Still return both scores.",
    held.length
      ? `ACKNOWLEDGED_MISMATCHES:\nThe user chose to keep evaluating despite these. Do not treat them as deal-breakers and do not lower preferencesScore because of them.\n${JSON.stringify(held)}`
      : "ACKNOWLEDGED_MISMATCHES: none",
    "BASELINE_FACTS:",
    JSON.stringify(input.facts),
    "PREFERENCES:",
    JSON.stringify(input.preferences),
    "LEVEL_MAP:",
    JSON.stringify({
      disclaimer: input.levelMap.disclaimer,
      entries: input.levelMap.entries,
    }),
    "JOB_POSTING:",
    input.jobText,
  ].join("\n\n");
}

export async function produceEvaluation(input: {
  jobText: string;
  facts: CitedFact[];
  preferences: PreferenceView | null;
  levelMap?: LevelMap;
  acknowledgedMismatches?: PreferenceMismatch[];
}): Promise<EvaluationDraft> {
  const levelMap = input.levelMap ?? loadLevelMap();
  const local = scoreLocally({ ...input, levelMap });
  const resolution = resolveProvider();
  if (resolution.mode === "local") return local;
  if (resolution.mode === "misconfigured") throw new AppError(resolution.message, 400);
  const result = await resolution.provider.complete({
    json: true,
    temperature: 0.1,
    messages: [
      { role: "system", content: loadPrompt("evaluate-posting") },
      { role: "user", content: buildEvaluationMessage({ ...input, levelMap }) },
    ],
  });
  let raw: unknown;
  try {
    raw = parseModelJson(result.text);
  } catch {
    throw new AppError("The model did not return JSON.", 502);
  }
  return normalizeModelEvaluation(raw, input, local, {
    provider: result.provider,
    model: result.model,
  });
}
