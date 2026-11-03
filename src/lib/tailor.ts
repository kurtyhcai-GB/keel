import { AppError } from "@/lib/errors";
import { loadPrompt, parseModelJson, resolveProvider, type PromptName } from "@/lib/ai";
import { excerptIsInSource } from "@/lib/extract";
import { parseJson } from "@/lib/json";
import type { CitedFact, ResumeEdit, TailorDraft } from "@/lib/types";
import { z } from "zod";

export type TailorTarget = "resume" | "coverLetter";

export type LengthLimit = { unit: "characters" | "words"; max: number } | null;

export type GeneratedResume = {
  resumeEdits: ResumeEdit[];
  warnings: string[];
  provider: string;
  model: string | null;
};

export type GeneratedCover = {
  coverLetter: string;
  warnings: string[];
  provider: string;
  model: string | null;
};

export type GeneratedAnswer = {
  answer: string;
  warnings: string[];
  provider: string;
  model: string | null;
};

export type TailorRecord = {
  resumeEdits: ResumeEdit[];
  coverLetter: string;
  resumeWarnings: string[];
  coverWarnings: string[];
  warnings: string[];
  resumeProvider: string | null;
  resumeModel: string | null;
  coverProvider: string | null;
  coverModel: string | null;
  provider: string;
  model: string | null;
  hasResume: boolean;
  hasCover: boolean;
};

const looseId = z
  .preprocess((value) => {
    if (value == null || value === "") return null;
    if (typeof value === "string") return value;
    return null;
  }, z.string().nullish())
  .catch(null);

const looseExcerpt = z
  .preprocess((value) => {
    if (value == null || value === "") return null;
    if (typeof value === "string") return value;
    return null;
  }, z.string().nullish())
  .catch(null);

const resumeEditSchema = z.object({
  factId: looseId,
  suggestion: z.string().trim().min(1),
  sourceExcerpt: looseExcerpt,
});

const looseResumeEdits = z.preprocess((value) => {
  if (!Array.isArray(value)) return value;
  const kept: Array<z.infer<typeof resumeEditSchema>> = [];
  for (const item of value) {
    const parsed = resumeEditSchema.safeParse(item);
    if (parsed.success) kept.push(parsed.data);
  }
  return kept;
}, z.array(resumeEditSchema));

const resumeSchema = z.object({
  resumeEdits: looseResumeEdits,
});

const coverSchema = z.object({
  coverLetter: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(1)),
});

const answerSchema = z.object({
  answer: z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().min(1)),
});

const LOCAL_WARNING = "Local draft. It only restates baseline facts. Read it before you send it.";
const MODEL_WARNING = "Model draft. Confirm every sentence against the baseline before you send it.";

function schemaFailure(label: string, error: z.ZodError): never {
  const fields = [
    ...new Set(error.issues.map((issue) => (issue.path.length > 0 ? issue.path.join(".") : "(root)"))),
  ];
  const message = `The model returned JSON that did not match the ${label} schema (${fields.join(", ")}).`;
  console.error(message);
  throw new AppError(message, 502);
}

function overlap(fact: CitedFact, text: string): number {
  const lower = text.toLowerCase();
  return fact.skills.reduce((score, skill) => {
    return lower.includes(skill.trim().toLowerCase()) ? score + 1 : score;
  }, 0);
}

function dates(fact: CitedFact): string {
  if (fact.startDate && fact.endDate) return `${fact.startDate} – ${fact.endDate}`;
  return fact.startDate || fact.endDate || "dates not recorded";
}

function chooseFacts(facts: CitedFact[], text: string): CitedFact[] {
  const ranked = [...facts].sort((left, right) => overlap(right, text) - overlap(left, text));
  const top = ranked.filter((fact) => overlap(fact, text) > 0).slice(0, 4);
  return top.length > 0 ? top : ranked.slice(0, 3);
}

function parseStringList(value: string | null | undefined): string[] {
  const parsed = parseJson<unknown>(value ?? "[]", []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

export function parseStoredResumeEdits(value: string): ResumeEdit[] {
  const parsed = parseJson<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  const edits: ResumeEdit[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as { factId?: unknown; suggestion?: unknown; sourceExcerpt?: unknown };
    if (typeof record.suggestion !== "string" || !record.suggestion.trim()) continue;
    edits.push({
      factId: typeof record.factId === "string" ? record.factId : null,
      suggestion: record.suggestion,
      sourceExcerpt: typeof record.sourceExcerpt === "string" ? record.sourceExcerpt : null,
    });
  }
  return edits;
}

export function tailorRecordFromStored(row: {
  resumeEditsJson: string;
  coverLetter: string;
  warningsJson: string;
  resumeWarningsJson?: string | null;
  coverWarningsJson?: string | null;
  provider: string;
  model: string | null;
  resumeProvider?: string | null;
  resumeModel?: string | null;
  coverProvider?: string | null;
  coverModel?: string | null;
}): TailorRecord {
  const resumeProvider = row.resumeProvider ?? null;
  const coverProvider = row.coverProvider ?? null;
  const legacy = resumeProvider == null && coverProvider == null;
  const storedResumeWarnings = parseStringList(row.resumeWarningsJson);
  const storedCoverWarnings = parseStringList(row.coverWarningsJson);
  const shared = parseStringList(row.warningsJson);
  const hasResume = resumeProvider != null || legacy;
  const hasCover = coverProvider != null || (legacy && row.coverLetter.trim().length > 0);
  return {
    resumeEdits: parseStoredResumeEdits(row.resumeEditsJson),
    coverLetter: row.coverLetter,
    resumeWarnings: storedResumeWarnings,
    coverWarnings: storedCoverWarnings.length > 0 ? storedCoverWarnings : legacy ? shared : [],
    warnings: shared,
    resumeProvider: resumeProvider ?? (hasResume ? row.provider : null),
    resumeModel: row.resumeModel ?? (hasResume ? row.model : null),
    coverProvider: coverProvider ?? (hasCover ? row.provider : null),
    coverModel: row.coverModel ?? (hasCover ? row.model : null),
    provider: row.provider,
    model: row.model,
    hasResume,
    hasCover,
  };
}

export function mergeTailorRecord(
  previous: TailorRecord | null,
  patch: {
    resume?: { resumeEdits: ResumeEdit[]; warnings: string[]; provider: string; model: string | null };
    cover?: { coverLetter: string; warnings: string[]; provider: string; model: string | null };
  },
): TailorRecord {
  const fallbackProvider = patch.resume?.provider ?? patch.cover?.provider ?? "local";
  const fallbackModel = patch.resume?.model ?? patch.cover?.model ?? null;
  const next: TailorRecord = previous
    ? { ...previous, resumeEdits: [...previous.resumeEdits], resumeWarnings: [...previous.resumeWarnings], coverWarnings: [...previous.coverWarnings], warnings: [...previous.warnings] }
    : {
        resumeEdits: [],
        coverLetter: "",
        resumeWarnings: [],
        coverWarnings: [],
        warnings: [],
        resumeProvider: null,
        resumeModel: null,
        coverProvider: null,
        coverModel: null,
        provider: fallbackProvider,
        model: fallbackModel,
        hasResume: false,
        hasCover: false,
      };
  if (patch.resume) {
    next.resumeEdits = patch.resume.resumeEdits;
    next.resumeWarnings = patch.resume.warnings;
    next.resumeProvider = patch.resume.provider;
    next.resumeModel = patch.resume.model;
    next.provider = patch.resume.provider;
    next.model = patch.resume.model;
    next.hasResume = true;
  }
  if (patch.cover) {
    next.coverLetter = patch.cover.coverLetter;
    next.coverWarnings = patch.cover.warnings;
    next.coverProvider = patch.cover.provider;
    next.coverModel = patch.cover.model;
    next.provider = patch.cover.provider;
    next.model = patch.cover.model;
    next.hasCover = true;
  }
  next.warnings = [...new Set([...next.resumeWarnings, ...next.coverWarnings])];
  return next;
}

export function resumeUserContent(input: {
  facts: CitedFact[];
  job: { title: string | null; company: string | null; rawText: string };
}): string {
  return [
    "Respond with JSON only.",
    "BASELINE_FACTS:",
    JSON.stringify(input.facts),
    "JOB_POSTING:",
    JSON.stringify({
      title: input.job.title,
      company: input.job.company,
      rawText: input.job.rawText,
    }),
  ].join("\n\n");
}

export function coverUserContent(input: {
  facts: CitedFact[];
  job: { title: string | null; company: string | null; rawText: string };
  displayName: string;
}): string {
  return [
    "Respond with JSON only.",
    "BASELINE_FACTS:",
    JSON.stringify(input.facts),
    "JOB_POSTING:",
    JSON.stringify({
      title: input.job.title,
      company: input.job.company,
      rawText: input.job.rawText,
    }),
    `SIGN_OFF: ${input.displayName}`,
  ].join("\n\n");
}

export function describeLength(length: LengthLimit): string {
  if (!length) return "none";
  return `at most ${length.max} ${length.unit}`;
}

export function answerUserContent(input: {
  facts: CitedFact[];
  job: { title: string | null; company: string | null; rawText: string };
  question: string;
  length: LengthLimit;
}): string {
  return [
    "Respond with JSON only.",
    "BASELINE_FACTS:",
    JSON.stringify(input.facts),
    "JOB_POSTING:",
    JSON.stringify({
      title: input.job.title,
      company: input.job.company,
      rawText: input.job.rawText,
    }),
    "QUESTION:",
    input.question.trim(),
    `LENGTH_LIMIT: ${describeLength(input.length)}`,
  ].join("\n\n");
}

export function enforceLength(text: string, length: LengthLimit): { text: string; truncated: boolean } {
  if (!length) return { text, truncated: false };
  if (length.unit === "characters") {
    const chars = [...text];
    if (chars.length <= length.max) return { text, truncated: false };
    const sliced = chars.slice(0, length.max).join("");
    return { text: sliced.trimEnd() || sliced, truncated: true };
  }
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= length.max) return { text, truncated: false };
  return { text: words.slice(0, length.max).join(" "), truncated: true };
}

export function tailorResumeLocally(input: {
  facts: CitedFact[];
  job: { title: string | null; company: string | null; rawText: string };
}): GeneratedResume {
  const chosen = chooseFacts(input.facts, input.job.rawText);
  const resumeEdits: ResumeEdit[] = chosen.map((fact) => ({
    factId: fact.id,
    suggestion: `Lead with ${fact.title ?? "this fact"}${fact.company ? ` at ${fact.company}` : ""} (${dates(fact)}). The baseline says: ${fact.summary}`,
    sourceExcerpt: fact.sourceExcerpt,
  }));
  const blob = input.facts
    .map((fact) => `${fact.summary} ${fact.skills.join(" ")} ${fact.impact ?? ""}`)
    .join("\n")
    .toLowerCase();
  for (const line of input.job.rawText.split(/\n/)) {
    const cleaned = line.trim().replace(/^[-*•]\s+/, "");
    if (!/^[-*•]\s+\S/.test(line.trim()) || cleaned.length < 3) continue;
    if (blob.includes(cleaned.toLowerCase())) continue;
    if (chosen.some((fact) => fact.skills.some((skill) => cleaned.toLowerCase().includes(skill.toLowerCase())))) {
      continue;
    }
    resumeEdits.push({
      factId: null,
      suggestion: `The posting says "${cleaned}". Do not add it. The baseline does not record it.`,
      sourceExcerpt: null,
    });
    if (resumeEdits.length >= chosen.length + 4) break;
  }
  return {
    resumeEdits,
    warnings: [LOCAL_WARNING],
    provider: "local",
    model: null,
  };
}

export function tailorCoverLocally(input: {
  facts: CitedFact[];
  job: { title: string | null; company: string | null; rawText: string };
  displayName: string;
}): GeneratedCover {
  const chosen = chooseFacts(input.facts, input.job.rawText);
  const title = input.job.title ?? "the role";
  const company = input.job.company ? ` at ${input.job.company}` : "";
  const lines = chosen.map(
    (fact) =>
      `- ${fact.title ?? "Recorded fact"}${fact.company ? ` at ${fact.company}` : ""} (${dates(fact)}): ${fact.summary}`,
  );
  const coverLetter = [
    "Dear hiring team,",
    "",
    `I am writing about the ${title} role${company}. What I can say from my own record:`,
    ...(lines.length ? lines : ["- The baseline does not yet have facts to quote."]),
    "",
    "I have left out anything that record does not already say.",
    "",
    input.displayName,
  ].join("\n");
  return {
    coverLetter,
    warnings: [LOCAL_WARNING],
    provider: "local",
    model: null,
  };
}

export function tailorLocally(input: {
  facts: CitedFact[];
  job: { title: string | null; company: string | null; rawText: string };
  displayName: string;
}): TailorDraft {
  const resume = tailorResumeLocally(input);
  const cover = tailorCoverLocally(input);
  return {
    jobPostingId: "",
    resumeEdits: resume.resumeEdits,
    coverLetter: cover.coverLetter,
    warnings: [...new Set([...resume.warnings, ...cover.warnings])],
    provider: "local",
    model: null,
  };
}

export function answerLocally(input: {
  facts: CitedFact[];
  job: { title: string | null; company: string | null; rawText: string };
  question: string;
  length: LengthLimit;
}): GeneratedAnswer {
  const chosen = chooseFacts(input.facts, `${input.question}\n${input.job.rawText}`);
  const bits = chosen.map(
    (fact) =>
      `${fact.title ?? "Recorded fact"}${fact.company ? ` at ${fact.company}` : ""} (${dates(fact)}): ${fact.summary}`,
  );
  const role = [input.job.title, input.job.company ? `at ${input.job.company}` : ""].filter(Boolean).join(" ");
  const answer = [
    bits.length ? bits.join(" ") : "The baseline does not yet have facts to quote.",
    role ? `This is for the ${role} role.` : "",
    "I have left out anything that record does not already say.",
  ]
    .filter(Boolean)
    .join(" ");
  const limited = enforceLength(answer, input.length);
  const warnings = [LOCAL_WARNING];
  if (limited.truncated) warnings.push("The answer was shortened to the length limit.");
  return { answer: limited.text, warnings, provider: "local", model: null };
}

export function normalizeResume(
  raw: unknown,
  facts: CitedFact[],
): { resumeEdits: ResumeEdit[]; warnings: string[] } {
  const parsed = resumeSchema.safeParse(raw);
  if (!parsed.success) schemaFailure("resume", parsed.error);
  const warnings = [MODEL_WARNING];
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const resumeEdits: ResumeEdit[] = [];
  for (const edit of parsed.data.resumeEdits) {
    const factId = edit.factId ?? null;
    if (factId && !byId.has(factId)) {
      warnings.push("A resume edit was dropped because its fact id is not in the baseline.");
      continue;
    }
    const excerpt = edit.sourceExcerpt?.trim() || null;
    if (factId && excerpt) {
      const fact = byId.get(factId)!;
      const source = `${fact.sourceExcerpt}\n${fact.summary}\n${fact.impact ?? ""}`;
      if (!excerptIsInSource(source, excerpt)) {
        warnings.push("A resume edit was dropped because its excerpt is not in the cited fact.");
        continue;
      }
    }
    resumeEdits.push({ factId, suggestion: edit.suggestion, sourceExcerpt: excerpt });
  }
  return { resumeEdits, warnings };
}

export function normalizeCoverLetter(raw: unknown): { coverLetter: string; warnings: string[] } {
  const parsed = coverSchema.safeParse(raw);
  if (!parsed.success) schemaFailure("cover letter", parsed.error);
  return { coverLetter: parsed.data.coverLetter, warnings: [MODEL_WARNING] };
}

export function normalizeAnswer(raw: unknown, length: LengthLimit): { answer: string; warnings: string[] } {
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) schemaFailure("answer", parsed.error);
  const warnings = [MODEL_WARNING];
  const limited = enforceLength(parsed.data.answer, length);
  if (limited.truncated) warnings.push("The answer was shortened to the length limit.");
  return { answer: limited.text, warnings };
}

async function runModel(
  prompt: PromptName,
  content: string,
): Promise<{ kind: "local" } | { kind: "model"; text: string; provider: string; model: string }> {
  const resolution = resolveProvider();
  if (resolution.mode === "local") return { kind: "local" };
  if (resolution.mode === "misconfigured") throw new AppError(resolution.message, 400);
  const result = await resolution.provider.complete({
    json: true,
    temperature: 0.2,
    messages: [
      { role: "system", content: loadPrompt(prompt) },
      { role: "user", content },
    ],
  });
  return { kind: "model", text: result.text, provider: result.provider, model: result.model };
}

function readModelJson(text: string): unknown {
  try {
    return parseModelJson(text);
  } catch {
    throw new AppError("The model did not return JSON.", 502);
  }
}

export async function produceResume(input: {
  facts: CitedFact[];
  job: { title: string | null; company: string | null; rawText: string };
}): Promise<GeneratedResume> {
  const local = tailorResumeLocally(input);
  const model = await runModel("tailor-resume", resumeUserContent(input));
  if (model.kind === "local") return local;
  const normalized = normalizeResume(readModelJson(model.text), input.facts);
  return { ...normalized, provider: model.provider, model: model.model };
}

export async function produceCover(input: {
  facts: CitedFact[];
  job: { title: string | null; company: string | null; rawText: string };
  displayName: string;
}): Promise<GeneratedCover> {
  const local = tailorCoverLocally(input);
  const model = await runModel("tailor-cover", coverUserContent(input));
  if (model.kind === "local") return local;
  const normalized = normalizeCoverLetter(readModelJson(model.text));
  return { ...normalized, provider: model.provider, model: model.model };
}

export async function produceAnswer(input: {
  facts: CitedFact[];
  job: { title: string | null; company: string | null; rawText: string };
  question: string;
  length: LengthLimit;
}): Promise<GeneratedAnswer> {
  const local = answerLocally(input);
  const model = await runModel("tailor-answer", answerUserContent(input));
  if (model.kind === "local") return local;
  const normalized = normalizeAnswer(readModelJson(model.text), input.length);
  return { ...normalized, provider: model.provider, model: model.model };
}
