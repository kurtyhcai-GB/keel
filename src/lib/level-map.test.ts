import { describe, expect, it } from "vitest";
import { loadLevelMap, matchLevel } from "@/lib/level-map";

describe("level map", () => {
  const map = loadLevelMap();

  it("marks non-anchor rows as examples the owner should verify", () => {
    const examples = map.entries.filter((entry) => entry.verification !== "anchor");
    expect(examples.length).toBeGreaterThan(0);
    for (const entry of examples) {
      expect(entry.notes.toLowerCase()).toMatch(/example|confirm/);
    }
    expect(map.entries.find((entry) => entry.id === "ms-65")?.displayLabel).toBe("Microsoft L65 (IC5)");
  });

  it("maps a named company level and does not treat a bare L64 as Microsoft", () => {
    expect(matchLevel("Google is hiring an L5 engineer", map)).toMatchObject({
      microsoftLevel: 64,
      levelLabel: "Microsoft L64",
    });
    expect(matchLevel("Company: Microsoft\nLevel: L65", map)).toMatchObject({
      microsoftLevel: 65,
      levelLabel: "Microsoft L65 (IC5)",
    });
    expect(matchLevel("Company: Northwind\nLevel: L64", map).microsoftLevel).toBeNull();
  });
});
