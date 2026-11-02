import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { scoreLocally } from "@/lib/evaluate";
import {
  addLevelMapRow,
  clearLevelMapCache,
  deleteLevelMapRow,
  loadLevelMap,
  matchLevel,
  resetLevelMapRow,
  saveLevelMapOverride,
  setLevelMapOverridesPath,
} from "@/lib/level-map";
import type { CitedFact, PreferenceView } from "@/lib/types";

const dir = mkdtempSync(path.join(tmpdir(), "keel-levels-"));
const overridesFile = path.join(dir, "level-map-overrides.json");
setLevelMapOverridesPath(overridesFile);

const researchedFile = path.join(process.cwd(), "data", "level-map.json");
const researchedBefore = readFileSync(researchedFile, "utf8");

afterAll(() => {
  setLevelMapOverridesPath(null);
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(overridesFile, { force: true });
  clearLevelMapCache();
});

const fact: CitedFact = {
  id: "f1",
  title: "Senior Technical Program Manager",
  company: "Contoso",
  startDate: "2019",
  endDate: "2024",
  summary: "Led cross-org programs.",
  skills: ["technical program management"],
  impact: null,
  sourceExcerpt: "Led cross-org programs for Contoso.",
};

const preferences: PreferenceView = {
  locations: ["Redmond, WA"],
  workModes: ["remote"],
  commuteToleranceMinutes: 45,
  targetLevelMin: 63,
  targetLevelMax: 65,
  skillsWeight: 65,
  notes: null,
};

const googlePosting = "Company: Google\nLocation: Redmond, WA\nWorksite: Remote\nLevel: L5\n\nRequirements:\n- technical program management\n";

describe("level map", () => {
  it("loads the researched map and flags low-confidence rows", () => {
    const map = loadLevelMap();
    expect(map.entries).toHaveLength(121);
    expect(map.removed).toEqual([]);
    expect(map.entries.every((entry) => entry.origin === "researched")).toBe(true);
    expect(map.entries.some((entry) => entry.confidence === "low")).toBe(true);
    const low = map.entries.filter((entry) => entry.confidence === "low");
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((entry) => entry.source.startsWith("http"))).toBe(true);
    expect(map.entries.find((entry) => entry.id === "microsoft-65")?.displayLabel).toBe("Microsoft L65 (IC5)");
  });

  it("maps a named company level and does not treat a bare L64 as Microsoft", () => {
    const map = loadLevelMap();
    expect(matchLevel("Google is hiring an L5 engineer", map)).toMatchObject({
      microsoftLevelMin: 63,
      microsoftLevelMax: 64,
      levelLabel: "Microsoft L63–64",
    });
    expect(matchLevel("Company: Microsoft\nLevel: L65", map)).toMatchObject({
      microsoftLevel: 65,
      levelLabel: "Microsoft L65 (IC5)",
    });
    expect(matchLevel("Company: Northwind\nLevel: L64", map).microsoftLevel).toBeNull();
    expect(matchLevel("Company: Microsoft\nTechnical Program Management IC4", map)).toMatchObject({
      microsoftLevel: 63,
      microsoftLevelMin: 63,
      microsoftLevelMax: 63,
      levelLabel: "Microsoft L63 (IC4)",
    });
  });

  it("edits a row, marks it, and resets it to the researched value", () => {
    const updated = saveLevelMapOverride({
      id: "google-l5",
      companyLevel: "L5",
      companyTitle: "Staff TPM",
      microsoftLevelMin: 66,
      microsoftLevelMax: 67,
      notes: "Corrected on this machine.",
      confidence: "medium",
    });
    expect(updated).toMatchObject({
      origin: "edited",
      companyTitle: "Staff TPM",
      microsoftLevelMin: 66,
      microsoftLevelMax: 67,
      displayLabel: "Microsoft L66–67",
      confidence: "medium",
      notes: "Corrected on this machine.",
    });
    expect(loadLevelMap().entries.find((entry) => entry.id === "google-l5")?.origin).toBe("edited");

    const restored = resetLevelMapRow({ id: "google-l5" });
    expect(restored).toMatchObject({
      origin: "researched",
      companyTitle: "Technical Program Manager III",
      microsoftLevelMin: 63,
      microsoftLevelMax: 64,
      confidence: "high",
    });
    expect(readFileSync(researchedFile, "utf8")).toBe(researchedBefore);
  });

  it("reads a legacy flat overrides file as an edit", () => {
    writeFileSync(
      overridesFile,
      JSON.stringify({
        "google-l5": {
          microsoftLevelMin: 60,
          microsoftLevelMax: 61,
          notes: "Legacy correction.",
          confidence: "low",
        },
      }),
    );
    clearLevelMapCache();
    const row = loadLevelMap().entries.find((entry) => entry.id === "google-l5");
    expect(row).toMatchObject({
      origin: "edited",
      companyLevel: "L5",
      microsoftLevelMin: 60,
      microsoftLevelMax: 61,
      confidence: "low",
      notes: "Legacy correction.",
    });
  });

  it("adds a company and deletes that added row", () => {
    const added = addLevelMapRow({
      company: "Acme",
      companyLevel: "L9",
      companyTitle: "Principal TPM",
      microsoftLevelMin: 64,
      microsoftLevelMax: 64,
      confidence: "low",
      notes: "Local crosswalk.",
    });
    expect(added.origin).toBe("added");
    expect(added.source).toBe("Added on this machine");
    expect(matchLevel("Company: Acme\nLevel: L9", loadLevelMap())).toMatchObject({
      entryId: added.id,
      microsoftLevel: 64,
      levelLabel: "Microsoft L64",
    });

    const edited = saveLevelMapOverride({
      id: added.id,
      companyLevel: "L9",
      companyTitle: "Director TPM",
      microsoftLevelMin: 65,
      microsoftLevelMax: 66,
      confidence: "medium",
      notes: "Raised after a conversation.",
    });
    expect(edited).toMatchObject({ origin: "added", companyTitle: "Director TPM", microsoftLevelMin: 65 });
    expect(() => resetLevelMapRow({ id: added.id })).toThrow(/no researched value/i);

    deleteLevelMapRow({ id: added.id });
    const map = loadLevelMap();
    expect(map.entries.some((entry) => entry.id === added.id)).toBe(false);
    expect(matchLevel("Company: Acme\nLevel: L9", map).microsoftLevel).toBeNull();
  });

  it("deletes a researched row from scoring and can restore it", () => {
    deleteLevelMapRow({ id: "google-l5" });
    const hidden = loadLevelMap();
    expect(hidden.entries.some((entry) => entry.id === "google-l5")).toBe(false);
    expect(hidden.removed.map((entry) => entry.id)).toContain("google-l5");
    expect(matchLevel("Google is hiring an L5 engineer", hidden).entryId).not.toBe("google-l5");

    const restored = resetLevelMapRow({ id: "google-l5" });
    expect(restored.origin).toBe("researched");
    expect(restored.microsoftLevelMin).toBe(63);
    expect(loadLevelMap().removed).toEqual([]);
    expect(readFileSync(researchedFile, "utf8")).toBe(researchedBefore);
  });

  it("scores the next evaluation with the override in place", () => {
    const before = scoreLocally({ jobText: googlePosting, facts: [fact], preferences });
    expect(before.microsoftLevelMin).toBe(63);
    expect(before.microsoftLevelMax).toBe(64);
    expect(before.dealBreakers).toEqual([]);

    saveLevelMapOverride({
      id: "google-l5",
      companyLevel: "L5",
      companyTitle: "Technical Program Manager III",
      microsoftLevelMin: 67,
      microsoftLevelMax: 67,
      notes: "Treat Google L5 as Microsoft 67 for this search.",
      confidence: "high",
    });
    const during = scoreLocally({ jobText: googlePosting, facts: [fact], preferences });
    expect(during.microsoftLevel).toBe(67);
    expect(during.levelLabel).toBe("Microsoft L67");
    expect(during.dealBreakers.some((item) => /2 levels outside/i.test(item.text))).toBe(true);

    resetLevelMapRow({ id: "google-l5" });
    const after = scoreLocally({ jobText: googlePosting, facts: [fact], preferences });
    expect(after.microsoftLevelMin).toBe(63);
    expect(after.microsoftLevelMax).toBe(64);
    expect(after.dealBreakers).toEqual([]);
  });
});
