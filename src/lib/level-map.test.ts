import { describe, expect, it } from "vitest";
import { loadLevelMap, matchLevel } from "@/lib/level-map";

describe("level map", () => {
  const map = loadLevelMap();

  it("loads the researched map and flags low-confidence rows", () => {
    expect(map.entries).toHaveLength(121);
    expect(map.entries.some((entry) => entry.confidence === "low")).toBe(true);
    const low = map.entries.filter((entry) => entry.confidence === "low");
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((entry) => entry.source.startsWith("http"))).toBe(true);
    expect(map.entries.find((entry) => entry.id === "microsoft-65")?.displayLabel).toBe("Microsoft L65 (IC5)");
  });

  it("maps a named company level and does not treat a bare L64 as Microsoft", () => {
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
  });
});
