import { afterEach, describe, expect, it, vi } from "vitest";
import { MockProvider } from "@/lib/ai/mock";
import {
  answerLocally,
  answerUserContent,
  coverUserContent,
  enforceLength,
  mergeTailorRecord,
  normalizeAnswer,
  normalizeCoverLetter,
  normalizeResume,
  produceAnswer,
  produceCover,
  produceResume,
  resumeUserContent,
  tailorLocally,
  tailorRecordFromStored,
} from "@/lib/tailor";
import type { CitedFact } from "@/lib/types";

const fact: CitedFact = {
  id: "f1",
  title: "Senior TPM",
  company: "Contoso",
  startDate: "2019",
  endDate: "2024",
  summary: "Led technical program management.",
  skills: ["technical program management"],
  impact: null,
  sourceExcerpt: "Led technical program management.",
};

const job = {
  title: "Senior Technical Program Manager",
  company: "Northwind Instruments",
  rawText: "Requirements:\n- technical program management\n- Azure\n",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("tailorLocally", () => {
  it("quotes the baseline and does not invent another employer", () => {
    const draft = tailorLocally({
      displayName: "KC",
      job,
      facts: [fact],
    });
    expect(draft.coverLetter).toContain("Contoso");
    expect(draft.coverLetter).toContain("Northwind Instruments");
    expect(draft.coverLetter).toContain("KC");
    expect(draft.coverLetter).not.toContain("Azure");
    expect(draft.coverLetter).not.toContain("Fabrikam");
    expect(draft.resumeEdits.some((edit) => /do not add it/i.test(edit.suggestion) && /Azure/.test(edit.suggestion))).toBe(
      true,
    );
  });
});

describe("tailor prompts stay on one document", () => {
  it("sends the sign-off only with the cover letter", () => {
    const resume = resumeUserContent({ facts: [fact], job });
    const cover = coverUserContent({ facts: [fact], job, displayName: "KC" });
    const answer = answerUserContent({
      facts: [fact],
      job,
      question: "Why are you excited about this role?",
      length: { unit: "words", max: 40 },
    });
    expect(resume).toContain("BASELINE_FACTS");
    expect(resume).toContain("Northwind Instruments");
    expect(resume).not.toContain("SIGN_OFF");
    expect(cover).toContain("SIGN_OFF: KC");
    expect(cover).not.toContain("resumeEdits");
    expect(answer).toContain("Why are you excited about this role?");
    expect(answer).toContain("at most 40 words");
    expect(answer).toContain("Contoso");
    expect(answer).not.toContain("SIGN_OFF");
  });
});

describe("normalize model output", () => {
  it("names the failing field when resume JSON is the wrong shape", () => {
    expect(() => normalizeResume({}, [fact])).toThrow(/resume schema \(resumeEdits\)/);
    expect(() => normalizeResume({ resumeEdits: "nope" }, [fact])).toThrow(/resumeEdits/);
  });

  it("drops a bad resume edit and keeps a cited one", () => {
    const result = normalizeResume(
      {
        resumeEdits: [
          { suggestion: 12 },
          { factId: "missing", suggestion: "Invented scope.", sourceExcerpt: null },
          { factId: fact.id, suggestion: "Keep the recorded sentence.", sourceExcerpt: "not in the cited fact at all" },
          { factId: fact.id, suggestion: "Keep the recorded sentence.", sourceExcerpt: fact.sourceExcerpt },
        ],
      },
      [fact],
    );
    expect(result.resumeEdits).toEqual([
      { factId: fact.id, suggestion: "Keep the recorded sentence.", sourceExcerpt: fact.sourceExcerpt },
    ]);
    expect(result.warnings.some((warning) => /fact id/i.test(warning))).toBe(true);
    expect(result.warnings.some((warning) => /excerpt/i.test(warning))).toBe(true);
  });

  it("names coverLetter when the letter is missing", () => {
    expect(() => normalizeCoverLetter({})).toThrow(/cover letter schema \(coverLetter\)/);
    expect(normalizeCoverLetter({ coverLetter: "  Hello there.  " }).coverLetter).toBe("Hello there.");
  });

  it("names answer when the answer is blank and shortens a long one", () => {
    expect(() => normalizeAnswer({ answer: "   " }, null)).toThrow(/answer schema \(answer\)/);
    const limited = normalizeAnswer(
      { answer: "one two three four five" },
      { unit: "words", max: 3 },
    );
    expect(limited.answer).toBe("one two three");
    expect(limited.warnings.some((warning) => /length limit/i.test(warning))).toBe(true);
  });
});

describe("saved tailor documents", () => {
  it("keeps the cover letter when only the resume is regenerated", () => {
    const legacy = tailorRecordFromStored({
      resumeEditsJson: JSON.stringify([{ factId: "f1", suggestion: "Old edit", sourceExcerpt: null }]),
      coverLetter: "Dear hiring team,",
      warningsJson: JSON.stringify(["Read it."]),
      provider: "local",
      model: null,
    });
    expect(legacy.hasResume).toBe(true);
    expect(legacy.hasCover).toBe(true);
    expect(legacy.coverWarnings).toEqual(["Read it."]);
    const next = mergeTailorRecord(legacy, {
      resume: { resumeEdits: [], warnings: ["new"], provider: "mock", model: "mock" },
    });
    expect(next.coverLetter).toBe("Dear hiring team,");
    expect(next.hasCover).toBe(true);
    expect(next.coverProvider).toBe("local");
    expect(next.resumeProvider).toBe("mock");
    expect(next.resumeEdits).toEqual([]);
    expect(next.hasResume).toBe(true);
  });

  it("does not invent a resume when only a cover letter exists", () => {
    const coverOnly = mergeTailorRecord(null, {
      cover: { coverLetter: "Hello", warnings: [], provider: "local", model: null },
    });
    expect(coverOnly.hasResume).toBe(false);
    expect(coverOnly.resumeEdits).toEqual([]);
    const withResume = mergeTailorRecord(coverOnly, {
      resume: {
        resumeEdits: [{ factId: "f1", suggestion: "Lead with the fact.", sourceExcerpt: null }],
        warnings: [],
        provider: "local",
        model: null,
      },
    });
    expect(withResume.coverLetter).toBe("Hello");
    expect(withResume.resumeEdits).toHaveLength(1);
  });
});

describe("application answers", () => {
  it("stays inside the baseline and the length limit", () => {
    const draft = answerLocally({
      facts: [fact],
      job,
      question: "Why are you excited about this role?",
      length: { unit: "words", max: 8 },
    });
    expect(draft.answer).toContain("Contoso");
    expect(draft.answer).not.toContain("Azure");
    expect(draft.answer).not.toContain("Fabrikam");
    expect(draft.answer.trim().split(/\s+/).length).toBeLessThanOrEqual(8);
    expect(draft.warnings.some((warning) => /length limit/i.test(warning))).toBe(true);
    expect(enforceLength("alpha beta", { unit: "characters", max: 5 }).text).toBe("alpha");
  });

  it("asks the mock model only for the requested document", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const complete = vi.spyOn(MockProvider.prototype, "complete");
    const resume = await produceResume({ facts: [fact], job });
    const cover = await produceCover({ facts: [fact], job, displayName: "KC" });
    const answer = await produceAnswer({
      facts: [fact],
      job,
      question: "What makes you want to work for us?",
      length: { unit: "words", max: 5 },
    });
    expect(resume.resumeEdits[0]?.suggestion).toContain("baseline");
    expect(cover.coverLetter).toContain("mock letter");
    expect(answer.answer.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
    const prompts = complete.mock.calls.map((call) => call[0].messages.map((message) => message.content).join("\n"));
    expect(prompts[0]).toContain("TAILOR_RESUME");
    expect(prompts[0]).not.toContain("TAILOR_COVER");
    expect(prompts[0]).not.toContain("SIGN_OFF");
    expect(prompts[1]).toContain("TAILOR_COVER");
    expect(prompts[1]).not.toContain("resumeEdits");
    expect(prompts[2]).toContain("TAILOR_ANSWER");
    expect(prompts[2]).toContain("What makes you want to work for us?");
  });
});
