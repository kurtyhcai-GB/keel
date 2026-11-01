import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blendOverall, findPreferencePauses, normalizeModelEvaluation, ruledOutReason, scoreLocally } from "@/lib/evaluate";
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
  skillsWeight: 65,
  notes: null,
};

describe("scoreLocally", () => {
  it("scores a pasted posting against the baseline without inventing an employer", () => {
    const result = scoreLocally({ jobText: posting, facts: [fact], preferences });
    expect(result.skillsScore).toBe(67);
    expect(result.preferencesScore).toBe(100);
    expect(result.overallScore).toBe(79);
    expect(result.title).toContain("Technical Program Manager");
    expect(result.company).toBe("Northwind Instruments");
    expect(result.requisitionId).toBe("NW-18422");
    expect(result.location).toContain("Redmond");
    expect(result.worksite).toBe("Hybrid: 3 days");
    expect(result.microsoftLevel).toBeNull();
    expect(result.strengths.some((item) => item.factIds.includes("f1"))).toBe(true);
    expect(result.gaps.some((item) => /Azure/i.test(item.text))).toBe(true);
    expect(result.dealBreakers).toEqual([]);
    expect(result.mismatches).toEqual([]);
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

describe("preference pauses", () => {
  it("asks before scoring a location or remote-only worksite mismatch", () => {
    const pauses = findPreferencePauses({ jobText: posting, preferences });
    expect(pauses.map((pause) => pause.kind).sort()).toEqual(["location", "worksite"]);
    expect(ruledOutReason(pauses)).toMatch(/remote only/);
    expect(ruledOutReason(pauses)).toMatch(/outside your preferred locations/);
  });

  it("does not pause when the posting fits the saved location and worksite", () => {
    const pauses = findPreferencePauses({
      jobText: posting,
      preferences: {
        ...preferences,
        locations: ["Redmond, WA"],
        workModes: ["hybrid", "remote"],
      },
    });
    expect(pauses).toEqual([]);
  });

  it("pauses for location even when the job is remote", () => {
    const pauses = findPreferencePauses({
      jobText: "Company: Contoso\nLocation: Austin, TX\nWorksite: Remote\n" + "Requirements:\n".padEnd(40, "x"),
      preferences,
    });
    expect(pauses.map((pause) => pause.kind)).toEqual(["location"]);
  });

  it("still scores other worksite conflicts instead of pausing", () => {
    const jobText = "Company: Contoso\nLocation: Seattle, WA\nWorksite: Remote\n\nRequirements:\n- technical program management\n";
    const onsite: PreferenceView = {
      ...preferences,
      locations: ["Seattle, WA"],
      workModes: ["onsite"],
    };
    expect(findPreferencePauses({ jobText, preferences: onsite })).toEqual([]);
    const result = scoreLocally({ jobText, facts: [fact], preferences: onsite });
    expect(result.dealBreakers.some((item) => /remote/i.test(item.text))).toBe(true);
  });

  it("does not pause when no preferences are saved", () => {
    expect(findPreferencePauses({ jobText: posting, preferences: null })).toEqual([]);
  });
});

describe("blendOverall", () => {
  it("uses the saved skills weight and ignores a missing preferences score", () => {
    expect(blendOverall(67, 100, 65)).toBe(79);
    expect(blendOverall(80, 40, 50)).toBe(60);
    expect(blendOverall(80, 40, 100)).toBe(80);
    expect(blendOverall(80, 40, 0)).toBe(40);
    expect(blendOverall(80, null, 10)).toBe(80);
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

  it("recomputes overall from the user's weight and drops an acknowledged worksite deal-breaker", () => {
    const local = scoreLocally({ jobText: posting, facts: [fact], preferences });
    const normalized = normalizeModelEvaluation(
      {
        skillsScore: 80,
        preferencesScore: 40,
        overallScore: 10,
        summary: "Model summary.",
        strengths: [{ text: "Real citation.", factIds: ["f1"] }],
        gaps: [],
        dealBreakers: [
          { text: "This is not remote enough.", factIds: [] },
          { text: "The level is far outside the target.", factIds: [] },
        ],
      },
      {
        facts: [fact],
        preferences: { ...preferences, skillsWeight: 50 },
        jobText: posting,
        acknowledgedMismatches: [
          { kind: "worksite", reason: "This posting is hybrid, and your preference is remote only." },
        ],
      },
      local,
      { provider: "mock", model: "mock" },
    );
    expect(normalized.overallScore).toBe(60);
    expect(normalized.dealBreakers.map((item) => item.text)).toEqual([
      "The level is far outside the target.",
    ]);
    expect(normalized.mismatches).toHaveLength(1);
  });
});
