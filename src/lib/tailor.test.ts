import { describe, expect, it } from "vitest";
import { tailorLocally } from "@/lib/tailor";
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

describe("tailorLocally", () => {
  it("quotes the baseline and does not invent another employer", () => {
    const draft = tailorLocally({
      displayName: "KC",
      job: {
        title: "Senior Technical Program Manager",
        company: "Northwind Instruments",
        rawText: "Requirements:\n- technical program management\n- Azure\n",
      },
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
