import { describe, expect, it } from "vitest";
import {
  acceptExtractedFacts,
  conflictQuestion,
  datesConflict,
  excerptIsInSource,
  parseRoleBlocks,
} from "@/lib/extract";

const document = `ROLE: Senior TPM
COMPANY: Contoso
START: March 2019
END: June 2024
SKILLS: program management, shipping
SUMMARY: Led the platform program.
`;

describe("parseRoleBlocks", () => {
  it("reads a structured block as a fact whose excerpt is in the document", () => {
    const facts = parseRoleBlocks(document);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.company).toBe("Contoso");
    expect(facts[0]?.startDate).toBe("March 2019");
    expect(facts[0]?.skills).toEqual(["program management", "shipping"]);
    expect(excerptIsInSource(document, facts[0]?.sourceExcerpt ?? "")).toBe(true);
  });
});

describe("conflicts", () => {
  const existing = {
    id: "a",
    title: "Senior TPM",
    company: "Contoso",
    startDate: "March 2019",
    endDate: "June 2024",
  };

  it("asks instead of merging when the same role has different dates", () => {
    const incoming = { ...existing, startDate: "January 2018", endDate: "June 2024" };
    expect(datesConflict(existing, incoming)).toBe(true);
    const question = conflictQuestion(existing, incoming);
    expect(question?.question).toMatch(/which dates/i);
    expect(question?.detail).toContain("March 2019");
    expect(question?.detail).toContain("January 2018");
    expect(question?.detail.toLowerCase()).toContain("nothing was merged");
  });

  it("does not flag the same dates or a different company", () => {
    expect(datesConflict(existing, existing)).toBe(false);
    expect(
      datesConflict(existing, { ...existing, company: "Fabrikam", startDate: "2020", endDate: "2021" }),
    ).toBe(false);
  });
});

describe("acceptExtractedFacts", () => {
  it("keeps an exact excerpt and drops one that is not in the document", () => {
    const excerpt = "Led the platform program.";
    const result = acceptExtractedFacts(document, {
      facts: [
        {
          summary: "Led the platform program.",
          sourceExcerpt: excerpt,
          company: "Contoso",
          title: "Senior TPM",
        },
        {
          summary: "Ran a secret program at Fabrikam.",
          sourceExcerpt: "Ran a secret program at Fabrikam.",
          company: "Fabrikam",
        },
      ],
      questions: [],
    });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.company).toBe("Contoso");
    expect(result.warnings.some((warning) => /dropped/i.test(warning))).toBe(true);
  });
});
