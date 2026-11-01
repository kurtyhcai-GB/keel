import { AppError } from "@/lib/errors";
import { loadPrompt, parseModelJson, resolveProvider } from "@/lib/ai";
import { excerptIsInSource } from "@/lib/extract";
import type { CitedFact, ResumeEdit, TailorDraft } from "@/lib/types";
import { z } from "zod";

const tailorSchema = z.object({
  resumeEdits: z
    .array(
      z.object({
        factId: z.string().nullish(),
        suggestion: z.string().min(1),
        sourceExcerpt: z.string().nullish(),
      }),
    )
    .default([]),
  coverLetter: z.string().min(1),
});

function overlap(fact: CitedFact, jobText: string): number {
  const lower = jobText.toLowerCase();
  return fact.skills.reduce((score, skill) => {
    return lower.includes(skill.trim().toLowerCase()) ? score + 1 : score;
  }, 0);
}

function dates(fact: CitedFact): string {
  if (fact.startDate && fact.endDate) return `${fact.startDate} – ${fact.endDate}`;
  return fact.startDate || fact.endDate || "dates not recorded";
}

export function tailorLocally(input: {
  facts: CitedFact[];
  job: { title: string | null; company: string | null; rawText: string };
  displayName: string;
}): TailorDraft {
  const ranked = [...input.facts].sort(
    (left, right) => overlap(right, input.job.rawText) - overlap(left, input.job.rawText),
  );
  const top = ranked.filter((fact) => overlap(fact, input.job.rawText) > 0).slice(0, 4);
  const chosen = top.length > 0 ? top : ranked.slice(0, 3);
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
    jobPostingId: "",
    resumeEdits,
    coverLetter,
    warnings: [
      "Local draft. It only restates baseline facts. Read it before you send it.",
    ],
    provider: "local",
    model: null,
  };
}

export function normalizeTailor(
  raw: unknown,
  facts: CitedFact[],
): { resumeEdits: ResumeEdit[]; coverLetter: string; warnings: string[] } {
  const parsed = tailorSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("The model returned JSON that did not match the tailor schema.", 502);
  }
  const warnings = [
    "Model draft. Confirm every sentence against the baseline before you send it.",
  ];
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
    resumeEdits.push({
      factId,
      suggestion: edit.suggestion,
      sourceExcerpt: excerpt,
    });
  }
  return { resumeEdits, coverLetter: parsed.data.coverLetter, warnings };
}

export async function produceTailor(input: {
  facts: CitedFact[];
  job: { id: string; title: string | null; company: string | null; rawText: string };
  displayName: string;
}): Promise<TailorDraft> {
  const local = tailorLocally(input);
  const resolution = resolveProvider();
  if (resolution.mode === "local") {
    return { ...local, jobPostingId: input.job.id };
  }
  if (resolution.mode === "misconfigured") throw new AppError(resolution.message, 400);
  const result = await resolution.provider.complete({
    json: true,
    temperature: 0.2,
    messages: [
      { role: "system", content: loadPrompt("tailor-materials") },
      {
        role: "user",
        content: [
          "Respond with JSON only.",
          "BASELINE_FACTS:",
          JSON.stringify(input.facts),
          "JOB_POSTING:",
          JSON.stringify(input.job),
          `SIGN_OFF: ${input.displayName}`,
        ].join("\n\n"),
      },
    ],
  });
  let raw: unknown;
  try {
    raw = parseModelJson(result.text);
  } catch {
    throw new AppError("The model did not return JSON.", 502);
  }
  const normalized = normalizeTailor(raw, input.facts);
  return {
    jobPostingId: input.job.id,
    ...normalized,
    provider: result.provider,
    model: result.model,
  };
}
