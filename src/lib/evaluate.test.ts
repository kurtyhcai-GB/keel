import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { overallFit } from "@/lib/fit";
import { findPreferencePauses, normalizeModelEvaluation, ruledOutReason, scoreLocally } from "@/lib/evaluate";
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
    expect(result.mismatches.map((item) => item.kind)).toEqual(["worksite"]);
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
    expect(pauses.map((pause) => pause.kind)).toEqual(["worksite"]);
    expect(ruledOutReason(pauses)).toMatch(/remote is the only worksite/i);
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
    expect(result.dealBreakers.map((item) => item.text)).toEqual([]);
    expect(result.preferenceParts.map((part) => [part.id, part.score])).toContainEqual(["worksite", 0]);
  });

  it("does not pause when no preferences are saved", () => {
    expect(findPreferencePauses({ jobText: posting, preferences: null })).toEqual([]);
  });
});

describe("overallFit", () => {
  it("uses the saved skills weight, subtracts deal-breakers, and ignores a missing preferences score", () => {
    expect(overallFit(67, 100, 65, 0)).toBe(79);
    expect(overallFit(80, 40, 50, 0)).toBe(60);
    expect(overallFit(80, 40, 50, 1)).toBe(54);
    expect(overallFit(80, 40, 100, 0)).toBe(80);
    expect(overallFit(80, 40, 0, 0)).toBe(40);
    expect(overallFit(80, null, 10, 2)).toBe(80);
    expect(overallFit(0, 0, 65, 0)).toBe(1);
  });

  it("treats a level two steps outside the range as a deal-breaker and a one-step gap as a stretch", () => {
    const far = scoreLocally({
      jobText: "Company: Microsoft\nLocation: Redmond, WA\nWorksite: Hybrid, 3 days in office\nLevel: L67\n\nRequirements:\n- technical program management\n",
      facts: [fact],
      preferences: { ...preferences, locations: ["Seattle"], workModes: ["hybrid"], commuteToleranceMinutes: 45 },
    });
    expect(far.dealBreakers.some((item) => /2 levels outside/i.test(item.text))).toBe(true);
    expect(far.preferenceParts.find((part) => part.id === "level")?.score).toBe(20);
    const stretch = scoreLocally({
      jobText: "Company: Microsoft\nLocation: Redmond, WA\nWorksite: Remote\nLevel: L66\n\nRequirements:\n- technical program management\n",
      facts: [fact],
      preferences: { ...preferences, locations: ["Seattle"], workModes: ["remote"], commuteToleranceMinutes: 45 },
    });
    expect(stretch.dealBreakers).toEqual([]);
    expect(stretch.preferenceParts.find((part) => part.id === "level")?.score).toBe(55);
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
    expect(normalized.overallScore).toBe(90);
    expect(normalized.preferencesScore).toBe(100);
    expect(normalized.dealBreakers.some((item) => /remote enough/i.test(item.text))).toBe(false);
    expect(normalized.mismatches).toHaveLength(1);
  });

  it("rescores preferences from model location and level when the local parse missed both", () => {
    const jobText = [
      "Technical program management role. Pay band and office are in the header image.",
      "",
      "Requirements:",
      "- technical program management",
    ].join("\n");
    const prefs: PreferenceView = {
      locations: ["Redmond, WA"],
      workModes: ["remote", "hybrid"],
      commuteToleranceMinutes: 45,
      targetLevelMin: 63,
      targetLevelMax: 65,
      skillsWeight: 65,
      notes: null,
    };
    const local = scoreLocally({ jobText, facts: [fact], preferences: prefs });
    expect(local.location).toBeNull();
    expect(local.microsoftLevel).toBeNull();
    expect(local.preferenceParts.find((part) => part.id === "level")?.detail).toMatch(/not scored/i);
    expect(local.preferenceParts.find((part) => part.id === "location")?.detail).toMatch(/does not state a location/i);

    const normalized = normalizeModelEvaluation(
      {
        title: "Technical Program Manager",
        company: "Microsoft",
        location: "Redmond, WA",
        worksite: null,
        levelRaw: "Technical Program Management IC4",
        microsoftLevel: 63,
        levelLabel: "Microsoft L63 (IC4)",
        skillsScore: 80,
        preferencesScore: 10,
        overallScore: 10,
        summary: "Model summary.",
        strengths: [{ text: "Real citation.", factIds: ["f1"] }],
        gaps: [],
        dealBreakers: [],
      },
      { facts: [fact], preferences: prefs, jobText },
      local,
      { provider: "mock", model: "mock" },
    );
    const level = normalized.preferenceParts.find((part) => part.id === "level");
    const location = normalized.preferenceParts.find((part) => part.id === "location");
    expect(level).toMatchObject({ included: true, score: 100 });
    expect(location?.detail).toContain("Redmond, WA");
    expect(location?.score).toBe(100);
    expect(normalized.preferencesScore).not.toBe(10);
    expect(normalized.location).toBe("Redmond, WA");
    expect(normalized.microsoftLevel).toBe(63);
  });
});

describe("microsoft hub posting parse", () => {
  it("maps IC4 beside Microsoft and prefers a saved hub city", () => {
    const jobText = [
      "Company: Microsoft",
      "Technical Program Management IC4 - The typical base pay range for this role is competitive.",
      "This role is located either in one or all hub locations - Atlanta, GA, Redmond, WA, Washington DC",
      "",
      "Requirements:",
      "- technical program management",
    ].join("\n");
    const prefs: PreferenceView = {
      ...preferences,
      locations: ["Redmond, WA"],
      workModes: ["remote", "hybrid"],
    };
    const result = scoreLocally({ jobText, facts: [fact], preferences: prefs });
    expect(result.location).toBe("Redmond, WA");
    expect(result.microsoftLevel).toBe(63);
    expect(result.levelLabel).toBe("Microsoft L63 (IC4)");
    expect(result.preferenceParts.find((part) => part.id === "level")).toMatchObject({
      included: true,
      score: 100,
    });
    expect(result.preferenceParts.find((part) => part.id === "location")?.detail).toContain("Redmond, WA");
  });
});

describe("pay and level mapping", () => {
  const payPrefs: PreferenceView = {
    locations: ["Redmond, WA"],
    workModes: ["remote", "hybrid"],
    commuteToleranceMinutes: 45,
    targetLevelMin: 63,
    targetLevelMax: 65,
    skillsWeight: 65,
    notes: null,
  };

  it("estimates a Microsoft band from posted pay when no level token matches", () => {
    const jobText = [
      "Company: Contoso",
      "Location: Redmond, WA",
      "Worksite: Remote",
      "The typical base pay range for this role across the U.S. is USD $119,800 - $234,700 per year.",
      "",
      "Requirements:",
      "- technical program management",
    ].join("\n");
    const result = scoreLocally({ jobText, facts: [fact], preferences: payPrefs });
    expect(result.payMin).toBe(119_800);
    expect(result.payMax).toBe(234_700);
    expect(result.levelLabel).toBe("about L63-64 (estimated from pay)");
    expect(result.levelFromPay).toBe(true);
    expect(result.microsoftLevelMin).toBe(63);
    expect(result.microsoftLevelMax).toBe(64);
    expect(result.confidence).toBe("low");
    const level = result.preferenceParts.find((part) => part.id === "level");
    expect(level?.detail).toMatch(/came from posted pay/i);
    expect(level?.detail).toMatch(/about L63-64/);
    expect(level?.score).toBe(100);
  });

  it("keeps a level token match and warns when pay is clearly inconsistent", () => {
    const jobText = [
      "Company: Microsoft",
      "Location: Redmond, WA",
      "Worksite: Remote",
      "Level: L65",
      "The typical base pay range for this role across the U.S. is USD $102,100 - $202,200 per year.",
      "",
      "Requirements:",
      "- technical program management",
    ].join("\n");
    const result = scoreLocally({ jobText, facts: [fact], preferences: payPrefs });
    expect(result.levelLabel).toBe("Microsoft L65 (IC5)");
    expect(result.microsoftLevel).toBe(65);
    expect(result.levelFromPay).toBe(false);
    expect(result.payNote).toMatch(/closer to about L61-62/i);
    expect(result.payNote).toMatch(/level title match was kept/i);
    expect(result.warnings.some((warning) => /level title match was kept/i.test(warning))).toBe(true);
    const level = result.preferenceParts.find((part) => part.id === "level");
    expect(level?.detail).toMatch(/level title match was kept/i);
    expect(level?.score).toBe(100);
  });

  it("rescores from model pay when the local parse had no level and no pay", () => {
    const jobText = ["Program manager role.", "", "Requirements:", "- technical program management"].join("\n");
    const local = scoreLocally({ jobText, facts: [fact], preferences: payPrefs });
    expect(local.microsoftLevel).toBeNull();
    expect(local.payMin).toBeNull();
    const normalized = normalizeModelEvaluation(
      {
        title: "Technical Program Manager",
        company: "Microsoft",
        location: "Redmond, WA",
        worksite: "Remote",
        levelRaw: null,
        microsoftLevel: null,
        levelLabel: null,
        payMin: 119_800,
        payMax: 234_700,
        payCurrency: "USD",
        payPeriod: "year",
        payRaw: "The typical base pay range for this role across the U.S. is USD $119,800 - $234,700 per year.",
        payKind: "base",
        skillsScore: 80,
        preferencesScore: 10,
        overallScore: 10,
        summary: "Model summary.",
        strengths: [{ text: "Real citation.", factIds: ["f1"] }],
        gaps: [],
        dealBreakers: [],
      },
      { facts: [fact], preferences: payPrefs, jobText },
      local,
      { provider: "mock", model: "mock" },
    );
    expect(normalized.payMin).toBe(119_800);
    expect(normalized.payMax).toBe(234_700);
    expect(normalized.levelLabel).toBe("about L63-64 (estimated from pay)");
    expect(normalized.levelFromPay).toBe(true);
    expect(normalized.preferenceParts.find((part) => part.id === "level")?.detail).toMatch(/came from posted pay/i);
    expect(normalized.preferencesScore).not.toBe(10);
  });

  it("accepts loose model pay values and falls back to the local parse when a value is dropped", () => {
    const jobText = [
      "Company: Contoso",
      "Location: Redmond, WA",
      "Worksite: Remote",
      "The typical base pay range for this role across the U.S. is USD $119,800 - $234,700 per year.",
      "",
      "Requirements:",
      "- technical program management",
    ].join("\n");
    const local = scoreLocally({ jobText, facts: [fact], preferences: payPrefs });
    expect(local.payMin).toBe(119_800);
    expect(local.payMax).toBe(234_700);
    const normalized = normalizeModelEvaluation(
      {
        title: "Technical Program Manager",
        company: "Contoso",
        location: { city: "Redmond" },
        worksite: "Remote",
        levelRaw: null,
        microsoftLevel: "65",
        levelLabel: null,
        payMin: "not posted as a number",
        payMax: "n/a",
        payCurrency: "USD",
        payPeriod: "yearly",
        payRaw: "The typical base pay range for this role across the U.S. is USD $119,800 - $234,700 per year.",
        payKind: "Base",
        payRanges: [
          { min: "$119,800", max: "120k", currency: "USD", period: "annual", kind: "base salary", scope: "U.S.", label: "United States" },
          { min: 100_000, scope: "metro" },
          { min: 90_000, max: 110_000, scope: "EMEA", period: "per year", kind: "TC" },
        ],
        skillsScore: 80,
        preferencesScore: "nope",
        overallScore: 80,
        summary: "Model summary.",
        strengths: [{ text: "Real citation.", factIds: ["f1"] }, { text: "" }, "not a point"],
        gaps: [],
        dealBreakers: [],
      },
      { facts: [fact], preferences: payPrefs, jobText },
      local,
      { provider: "google", model: "gemini-3.8-flash" },
    );
    expect(normalized.payMin).toBe(119_800);
    expect(normalized.payMax).toBe(234_700);
    expect(normalized.payPeriod).toBe("year");
    expect(normalized.payRanges).toEqual([
      {
        min: 119_800,
        max: 120_000,
        currency: "USD",
        period: "year",
        kind: "base",
        scope: "us",
        label: "United States",
      },
      {
        min: 90_000,
        max: 110_000,
        currency: "USD",
        period: "year",
        kind: "total",
        scope: "other",
        label: "",
      },
    ]);
    expect(normalized.location).toBe(local.location);
    expect(normalized.microsoftLevel).toBe(65);
    expect(normalized.strengths).toEqual([{ text: "Real citation.", factIds: ["f1"] }]);
    expect(normalized.summary).toBe("Model summary.");
  });

  it("names the schema fields that still fail", () => {
    const jobText = "Program manager role.";
    const local = scoreLocally({ jobText, facts: [fact], preferences: payPrefs });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      normalizeModelEvaluation(
        { skillsScore: "high", summary: "" },
        { facts: [fact], preferences: payPrefs, jobText },
        local,
        { provider: "google", model: "gemini-3.8-flash" },
      ),
    ).toThrow(/skillsScore/);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/skillsScore/));
    expect(error.mock.calls.some((call) => JSON.stringify(call).includes("high"))).toBe(false);
    error.mockRestore();
  });
});
