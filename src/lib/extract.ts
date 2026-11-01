import { loadPrompt, parseModelJson, resolveProvider } from "@/lib/ai";
import { factKinds } from "@/lib/schemas";
import { z } from "zod";

export type ProposedFact = {
  kind: string;
  title: string | null;
  company: string | null;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  summary: string;
  skills: string[];
  impact: string | null;
  sourceExcerpt: string;
  sourceLocator: string | null;
};

export type ProposedQuestion = {
  question: string;
  detail: string | null;
};

const extractedFact = z.object({
  kind: z.enum(factKinds).default("role"),
  title: z.string().nullish(),
  company: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  location: z.string().nullish(),
  summary: z.string().default(""),
  skills: z.array(z.string()).default([]),
  impact: z.string().nullish(),
  sourceExcerpt: z.string(),
  sourceLocator: z.string().nullish(),
});

const extractedPayload = z.object({
  facts: z.array(extractedFact).default([]),
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        detail: z.string().nullish(),
      }),
    )
    .default([]),
});

export function excerptIsInSource(source: string, excerpt: string): boolean {
  const trimmed = excerpt.trim();
  if (trimmed.length < 12) return false;
  return source.includes(trimmed);
}

function fieldMap(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split(/\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z ]{0,30})\s*:\s*(.*)$/);
    if (!match?.[1]) continue;
    fields[match[1].trim().toLowerCase()] = match[2]?.trim() ?? "";
  }
  return fields;
}

/** Reads ROLE / COMPANY / START / END blocks without calling a model. */
export function parseRoleBlocks(text: string): ProposedFact[] {
  const starts = [...text.matchAll(/^ROLE\s*:/gim)]
    .map((match) => match.index)
    .filter((index): index is number => index !== undefined);
  const facts: ProposedFact[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!;
    const end = index + 1 < starts.length ? starts[index + 1]! : text.length;
    const sourceExcerpt = text.slice(start, end).trim();
    const fields = fieldMap(sourceExcerpt);
    const title = fields.role || fields.title || null;
    const summary = fields.summary || title;
    if (!summary) continue;
    facts.push({
      kind: "role",
      title,
      company: fields.company || null,
      startDate: fields.start || fields["start date"] || null,
      endDate: fields.end || fields["end date"] || null,
      location: fields.location || null,
      summary,
      skills: (fields.skills ?? "")
        .split(",")
        .map((skill) => skill.trim())
        .filter(Boolean),
      impact: fields.impact || null,
      sourceExcerpt,
      sourceLocator: "structured block",
    });
  }
  return facts;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Stable key for title, company, and date range — used to skip duplicate extractions. */
export function factIdentityKey(fact: {
  title: string | null | undefined;
  company: string | null | undefined;
  startDate: string | null | undefined;
  endDate: string | null | undefined;
}): string {
  return `${norm(fact.title)}|${norm(fact.company)}|${norm(fact.startDate)}|${norm(fact.endDate)}`;
}

export function factsMatchByIdentity(
  left: {
    title: string | null | undefined;
    company: string | null | undefined;
    startDate: string | null | undefined;
    endDate: string | null | undefined;
  },
  right: {
    title: string | null | undefined;
    company: string | null | undefined;
    startDate: string | null | undefined;
    endDate: string | null | undefined;
  },
): boolean {
  return factIdentityKey(left) === factIdentityKey(right);
}

const AUTO_EXTRACTION_QUESTION_PREFIXES = [
  "This document was stored, but no roles were extracted",
  "No AI provider is configured",
] as const;

export function isAutoExtractionQuestion(question: string): boolean {
  const trimmed = question.trim();
  return AUTO_EXTRACTION_QUESTION_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** Strip likely secrets from provider errors before showing them in the UI. */
export function sanitizeExtractionWarning(text: string): string {
  return text
    .replace(/\bsk-[a-zA-Z0-9]{20,}\b/g, "[redacted]")
    .replace(/\bAIza[a-zA-Z0-9_-]{30,}\b/g, "[redacted]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/([?&]key=)[^&\s"']+/gi, "$1[redacted]");
}

export function datesConflict(
  left: { title: string | null; company: string | null; startDate: string | null; endDate: string | null },
  right: { title: string | null; company: string | null; startDate: string | null; endDate: string | null },
): boolean {
  const sameTitle = norm(left.title) && norm(left.title) === norm(right.title);
  const sameCompany = norm(left.company) && norm(left.company) === norm(right.company);
  if (!sameTitle || !sameCompany) return false;
  const leftDates = `${norm(left.startDate)}|${norm(left.endDate)}`;
  const rightDates = `${norm(right.startDate)}|${norm(right.endDate)}`;
  if (leftDates === "|" || rightDates === "|") return false;
  return leftDates !== rightDates;
}

export function conflictQuestion(
  existing: { id: string; title: string | null; company: string | null; startDate: string | null; endDate: string | null },
  incoming: { title: string | null; company: string | null; startDate: string | null; endDate: string | null },
): { question: string; detail: string } | null {
  if (!datesConflict(existing, incoming)) return null;
  const title = incoming.title || existing.title || "this role";
  const company = incoming.company || existing.company || "this company";
  return {
    question: `Two records disagree on the dates for ${title} at ${company}. Which dates should the baseline keep?`,
    detail: `Nothing was merged. One record says ${existing.startDate || "an unknown start"} – ${existing.endDate || "an unknown end"}. The other says ${incoming.startDate || "an unknown start"} – ${incoming.endDate || "an unknown end"}.`,
  };
}

export function acceptExtractedFacts(
  documentText: string,
  raw: unknown,
): { facts: ProposedFact[]; questions: ProposedQuestion[]; warnings: string[] } {
  const parsed = extractedPayload.safeParse(raw);
  if (!parsed.success) {
    return {
      facts: [],
      questions: [],
      warnings: ["The model JSON did not match the extraction schema and was discarded."],
    };
  }
  const warnings: string[] = [];
  const facts: ProposedFact[] = [];
  for (const fact of parsed.data.facts) {
    const sourceExcerpt = fact.sourceExcerpt.trim();
    if (!excerptIsInSource(documentText, sourceExcerpt)) {
      warnings.push("A proposed fact was dropped because its excerpt is not in the document.");
      continue;
    }
    facts.push({
      kind: fact.kind,
      title: fact.title ?? null,
      company: fact.company ?? null,
      startDate: fact.startDate ?? null,
      endDate: fact.endDate ?? null,
      location: fact.location ?? null,
      summary: fact.summary.trim() || sourceExcerpt.slice(0, 280),
      skills: fact.skills.map((skill) => skill.trim()).filter(Boolean),
      impact: fact.impact ?? null,
      sourceExcerpt,
      sourceLocator: fact.sourceLocator ?? null,
    });
  }
  return {
    facts,
    questions: parsed.data.questions.map((question) => ({
      question: question.question,
      detail: question.detail ?? null,
    })),
    warnings,
  };
}

export async function proposeFacts(documentText: string): Promise<{
  facts: ProposedFact[];
  questions: ProposedQuestion[];
  warnings: string[];
}> {
  const blocks = parseRoleBlocks(documentText);
  const resolution = resolveProvider();
  if (resolution.mode === "local") {
    return {
      facts: blocks,
      questions: blocks.length
        ? []
        : [
            {
              question:
                "This document was stored, but no roles were extracted. Add facts by hand, or set AI_PROVIDER and extract again.",
              detail:
                "A text resume can include ROLE, COMPANY, START, END, SKILLS, and SUMMARY lines. See docs/design.md.",
            },
          ],
      warnings: [],
    };
  }
  if (resolution.mode === "misconfigured") {
    return {
      facts: blocks,
      questions: blocks.length
        ? []
        : [
            {
              question: "No AI provider is configured, and the document had no ROLE blocks to read.",
              detail: resolution.message,
            },
          ],
      warnings: [resolution.message],
    };
  }
  try {
    const result = await resolution.provider.complete({
      json: true,
      temperature: 0,
      messages: [
        { role: "system", content: loadPrompt("extract-baseline") },
        { role: "user", content: `DOCUMENT:\n${documentText.slice(0, 80_000)}` },
      ],
    });
    const accepted = acceptExtractedFacts(documentText, parseModelJson(result.text));
    if (accepted.facts.length > 0) return accepted;
    return {
      facts: blocks,
      questions: accepted.questions,
      warnings: [
        ...accepted.warnings,
        blocks.length
          ? "The model returned no grounded facts. Structured ROLE blocks were used instead."
          : "The model returned no grounded facts.",
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction failed";
    return {
      facts: blocks,
      questions: [],
      warnings: [
        `Model extraction failed (${message}). ${blocks.length ? "Structured ROLE blocks were used instead." : "Add facts by hand."}`,
      ],
    };
  }
}
