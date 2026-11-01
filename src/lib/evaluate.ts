import { AppError } from "@/lib/errors";
import { loadPrompt, parseModelJson, resolveProvider } from "@/lib/ai";
import { loadLevelMap, matchLevel, type LevelMap } from "@/lib/level-map";
import type {
  CitedFact,
  EvaluationDraft,
  PreferenceMismatch,
  PreferenceView,
  ScorePoint,
  WorkMode,
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

const modelSchema = z.object({
  title: z.string().nullish(),
  company: z.string().nullish(),
  requisitionId: z.string().nullish(),
  location: z.string().nullish(),
  worksite: z.string().nullish(),
  levelRaw: z.string().nullish(),
  microsoftLevel: z.number().int().nullish(),
  levelLabel: z.string().nullish(),
  skillsScore: z.number(),
  preferencesScore: z.number().nullish(),
  overallScore: z.number(),
  summary: z.string().min(1),
  strengths: z.array(pointSchema).default([]),
  gaps: z.array(pointSchema).default([]),
  dealBreakers: z.array(pointSchema).default([]),
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

export function parsePosting(text: string, map: LevelMap) {
  const title =
    labeledLine(text, ["title", "role", "position"]) ??
    text
      .split(/\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !/^(company|employer|location|worksite|job id|level)\b/i.test(line)) ??
    null;
  const level = matchLevel(text, map);
  return {
    title: title?.slice(0, 160) ?? null,
    company: labeledLine(text, ["company", "employer"]),
    requisitionId:
      text.match(
        /(?:requisition(?:\s*id)?|req(?:uisition)?\s*id|job\s*id|job\s*#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{2,})/i,
      )?.[1] ?? null,
    location: labeledLine(text, ["location", "city"]),
    worksite: parseWorksite(text),
    ...level,
  };
}

function detectedModes(text: string): WorkMode[] {
  const modes: WorkMode[] = [];
  if (/\bremote\b/i.test(text)) modes.push("remote");
  if (/\bhybrid\b/i.test(text)) modes.push("hybrid");
  if (/on-?site|in[- ]office/i.test(text)) modes.push("onsite");
  return modes;
}

function locationMatches(location: string, preferred: string[]): boolean {
  const value = location.toLowerCase();
  return preferred.some((item) => {
    const wanted = item.toLowerCase();
    return value.includes(wanted) || wanted.includes(value);
  });
}

function remoteOnly(preferences: PreferenceView): boolean {
  return preferences.workModes.length === 1 && preferences.workModes[0] === "remote";
}

/**
 * Location outside the saved list, or hybrid/on-site when the user wants remote
 * only, pauses evaluation. These are not score penalties and not automatic rule-outs.
 */
export function findPreferencePauses(input: {
  jobText: string;
  preferences: PreferenceView | null;
  levelMap?: LevelMap;
}): PreferenceMismatch[] {
  if (!input.preferences) return [];
  const parsed = parsePosting(input.jobText, input.levelMap ?? loadLevelMap());
  const mismatches: PreferenceMismatch[] = [];
  const modes = detectedModes(`${parsed.worksite ?? ""}\n${input.jobText}`);
  if (remoteOnly(input.preferences) && (modes.includes("hybrid") || modes.includes("onsite"))) {
    const how = modes.includes("hybrid") ? "hybrid" : "on-site";
    mismatches.push({
      kind: "worksite",
      reason: `This posting is ${how}, and your preference is remote only.`,
    });
  }
  if (
    input.preferences.locations.length > 0 &&
    parsed.location &&
    !locationMatches(parsed.location, input.preferences.locations)
  ) {
    mismatches.push({
      kind: "location",
      reason: `The posting is in ${parsed.location}, which is outside your preferred locations (${input.preferences.locations.join("; ")}).`,
    });
  }
  return mismatches;
}

export function ruledOutReason(mismatches: PreferenceMismatch[]): string {
  return mismatches.map((mismatch) => mismatch.reason).join(" ");
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
  const parsed = parsePosting(input.jobText, map);
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

  const dealBreakers: ScorePoint[] = [];
  let preferencesScore: number | null = null;
  if (!input.preferences) {
    warnings.push("Preferences are not set, so the overall score follows the skills score only.");
  } else {
    let penalty = 0;
    const modes = detectedModes(`${parsed.worksite ?? ""}\n${input.jobText}`);
    const allowed = new Set(input.preferences.workModes);
    const heldForDecision =
      remoteOnly(input.preferences) && (modes.includes("hybrid") || modes.includes("onsite"));
    if (modes.length === 0) {
      penalty += 10;
      warnings.push("The posting does not state a worksite, so that preference was only partly scored.");
    } else if (!heldForDecision && !modes.some((mode) => allowed.has(mode))) {
      penalty += 50;
      dealBreakers.push({
        text: `Your preferences allow ${input.preferences.workModes.join(", ")}. This posting reads as ${modes.join(" and ")}.`,
        factIds: [],
      });
    }
    if (parsed.microsoftLevel == null) {
      warnings.push("No Microsoft-equivalent level was mapped, so level was not scored.");
    } else {
      const { targetLevelMin: min, targetLevelMax: max } = input.preferences;
      if (parsed.microsoftLevel < min || parsed.microsoftLevel > max) {
        const distance =
          parsed.microsoftLevel < min ? min - parsed.microsoftLevel : parsed.microsoftLevel - max;
        penalty += Math.min(40, distance * 15);
        if (distance >= 2) {
          dealBreakers.push({
            text: `${parsed.levelLabel ?? `Microsoft level ${parsed.microsoftLevel}`} is ${distance} levels outside your target of ${min}–${max}.`,
            factIds: [],
          });
        }
      }
    }
    warnings.push("Commute tolerance is saved and not scored yet.");
    preferencesScore = clampScore(100 - penalty);
  }

  const skillsWeight = input.preferences?.skillsWeight ?? DEFAULT_SKILLS_WEIGHT;
  const overallScore = blendOverall(skillsScore, preferencesScore, skillsWeight);

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
    warnings,
    mismatches: input.acknowledgedMismatches ?? [],
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

function dropAcknowledgedDealBreakers(
  points: ScorePoint[],
  mismatches: PreferenceMismatch[],
  warnings: string[],
): ScorePoint[] {
  if (mismatches.length === 0) return points;
  const kinds = new Set(mismatches.map((mismatch) => mismatch.kind));
  const kept: ScorePoint[] = [];
  for (const point of points) {
    const text = point.text.toLowerCase();
    const aboutWorksite =
      kinds.has("worksite") && /remote|hybrid|on-?site|worksite|in[- ]office/.test(text);
    const aboutLocation = kinds.has("location") && /location|relocat/.test(text);
    if (aboutWorksite || aboutLocation) {
      warnings.push(
        "A model deal-breaker was set aside because you chose to continue past that location or worksite mismatch.",
      );
      continue;
    }
    kept.push(point);
  }
  return kept;
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
    throw new AppError("The model returned JSON that did not match the evaluation schema.", 502);
  }
  const warnings: string[] = [];
  const ids = knownIds(input.facts);
  const strengths = keepKnown(parsed.data.strengths, ids, true, warnings);
  const gaps = keepKnown(parsed.data.gaps, ids, false, warnings);
  const acknowledged = input.acknowledgedMismatches ?? [];
  const dealBreakers = dropAcknowledgedDealBreakers(
    keepKnown(parsed.data.dealBreakers, ids, false, warnings),
    acknowledged,
    warnings,
  );
  const skillsScore = clampScore(parsed.data.skillsScore);
  let preferencesScore =
    parsed.data.preferencesScore == null ? null : clampScore(parsed.data.preferencesScore);
  if (!input.preferences) {
    if (preferencesScore != null) {
      warnings.push("Preferences are not set. The model preferences score was discarded.");
    }
    preferencesScore = null;
  }
  const overallScore = blendOverall(
    skillsScore,
    preferencesScore,
    input.preferences?.skillsWeight ?? DEFAULT_SKILLS_WEIGHT,
  );
  const value = parsed.data;
  return {
    title: value.title ?? local.title,
    company: value.company ?? local.company,
    requisitionId: value.requisitionId ?? local.requisitionId,
    location: value.location ?? local.location,
    worksite: value.worksite ?? local.worksite,
    levelRaw: value.levelRaw ?? local.levelRaw,
    microsoftLevel: value.microsoftLevel ?? local.microsoftLevel,
    levelLabel: value.levelLabel ?? local.levelLabel,
    skillsScore,
    preferencesScore,
    overallScore,
    summary: value.summary,
    strengths,
    gaps,
    dealBreakers,
    warnings,
    mismatches: acknowledged,
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
