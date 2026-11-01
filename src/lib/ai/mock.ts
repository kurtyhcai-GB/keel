import type { AiProvider, AiRequest, AiResult } from "@/lib/ai/types";

function factIds(blob: string): string[] {
  return [...blob.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]!);
}

function mockExtract(): string {
  return JSON.stringify({
    facts: [],
    questions: [
      {
        question:
          "The mock provider does not invent roles. Add facts by hand, or use ROLE blocks in the document.",
        detail: null,
      },
    ],
  });
}

function mockEvaluate(blob: string): string {
  const ids = factIds(blob);
  return JSON.stringify({
    title: null,
    company: null,
    requisitionId: null,
    location: null,
    worksite: null,
    levelRaw: null,
    microsoftLevel: null,
    levelLabel: null,
    skillsScore: 70,
    preferencesScore: blob.includes('"targetLevelMin"') ? 60 : null,
    overallScore: blob.includes('"targetLevelMin"') ? 67 : 70,
    summary: "Mock provider draft. It cites only fact ids that were present in the prompt.",
    strengths: ids.length
      ? [{ text: "Cited from the baseline that was sent to the model.", factIds: [ids[0]] }]
      : [],
    gaps: [
      {
        text: "Mock gap. This is not a claim that the baseline contains a missing skill.",
        factIds: [],
      },
    ],
    dealBreakers: [],
  });
}

function mockTailor(blob: string): string {
  const ids = factIds(blob);
  const factId = ids[0] ?? null;
  return JSON.stringify({
    resumeEdits: [
      {
        factId,
        suggestion: factId
          ? "Restate only the baseline fact with this id. Do not add new scope."
          : "The baseline sent to the model had no fact ids. Do not invent experience.",
        sourceExcerpt: null,
      },
    ],
    coverLetter:
      "This mock letter does not add employers, dates, or metrics. Confirm it against the baseline before sending.",
  });
}

export class MockProvider implements AiProvider {
  readonly id = "mock";
  readonly model = "mock";

  async complete(request: AiRequest): Promise<AiResult> {
    const blob = request.messages.map((message) => message.content).join("\n");
    const text = blob.includes("EXTRACT_BASELINE")
      ? mockExtract()
      : blob.includes("TAILOR_MATERIALS")
        ? mockTailor(blob)
        : mockEvaluate(blob);
    return { text, provider: this.id, model: this.model };
  }
}
