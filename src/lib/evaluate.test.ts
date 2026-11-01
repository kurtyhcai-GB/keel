import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeModelEvaluation, scoreLocally } from "@/lib/evaluate";
import type { CitedFact, PreferenceView } from "@/lib/types";

const posting = readFileSync(path.join(process.cwd(), "examples", "sample-posting.txt"), "utf8");

const fact: CitedFact = {
  id: "f1",
  title: "Senior Technical Program Manager",
  company: "Contoso",
  startDate: "2019",
  endDate: "2024",
  summary: "Led cross-org programs.",
  skills: ["technical program management", "cross-org execution", "kernel bring-up"],
  impact: null,
  sourceExcerpt: "Led cross-org programs for Contoso.",
};

const preferences: PreferenceView = {
  locations: ["Seattle"],
  workModes: ["remote"],
  commuteToleranceMinutes: 30,
  targetLevelMin: 63,
  targetLevelMax: 65,
  notes: null,
};

describe("scoreLocally", () => {
  it("scores a pasted posting against the baseline without inventing an employer", () => {
    const result = scoreLocally({ jobText: posting, facts: [fact], preferences });
    expect(result.skillsScore).toBe(67);
    expect(result.preferencesScore).toBe(25);
    expect(result.overallScore).toBe(52);
    expect(result.title).toContain("Technical Program Manager");
    expect(result.company).toBe("Northwind Instruments");
    expect(result.requisitionId).toBe("NW-18422");
    expect(result.location).toContain("Redmond");
    expect(result.worksite).toBe("Hybrid: 3 days");
    expect(result.microsoftLevel).toBeNull();
    expect(result.strengths.some((item) => item.factIds.includes("f1"))).toBe(true);
    expect(result.gaps.some((item) => /Azure/i.test(item.text))).toBe(true);
    expect(result.dealBreakers.some((item) => /remote/i.test(item.text))).toBe(true);
    expect(result.summary.toLowerCase()).not.toContain("worked at northwind");
    expect(result.provider).toBe("local");
  });

  it("follows the skills score when preferences are missing", () => {
    const result = scoreLocally({ jobText: posting, facts: [fact], preferences: null });
    expect(result.preferencesScore).toBeNull();
    expect(result.overallScore).toBe(result.skillsScore);
    expect(result.dealBreakers).toEqual([]);
  });
});

describe("normalizeModelEvaluation", () => {
  it("drops strengths that do not cite a real baseline fact", () => {
    const local = scoreLocally({ jobText: posting, facts: [fact], preferences: null });
    const normalized = normalizeModelEvaluation(
      {
        skillsScore: 80,
        preferencesScore: 90,
        overallScore: 10,
        summary: "Model summary.",
        strengths: [
          { text: "Invented a second employer.", factIds: ["missing"] },
          { text: "Real citation.", factIds: ["f1"] },
        ],
        gaps: [{ text: "Azure is not in the baseline.", factIds: [] }],
        dealBreakers: [],
      },
      { facts: [fact], preferences: null, jobText: posting },
      local,
      { provider: "mock", model: "mock" },
    );
    expect(normalized.strengths.map((item) => item.text)).toEqual(["Real citation."]);
    expect(normalized.preferencesScore).toBeNull();
    expect(normalized.overallScore).toBe(80);
    expect(normalized.warnings.some((warning) => /removed/i.test(warning))).toBe(true);
    expect(normalized.title).toBe(local.title);
  });
});
