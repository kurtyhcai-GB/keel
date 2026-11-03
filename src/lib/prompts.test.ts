import { describe, expect, it } from "vitest";
import { loadPrompt, parseModelJson } from "@/lib/ai";

const rule = "Do not invent employers, dates, titles, metrics, or scope.";

describe("prompts", () => {
  it("keeps the faithfulness rule in every prompt file", () => {
    expect(loadPrompt("extract-baseline")).toContain(rule);
    expect(loadPrompt("evaluate-posting")).toContain(rule);
    expect(loadPrompt("tailor-resume")).toContain(rule);
    expect(loadPrompt("tailor-cover")).toContain(rule);
    expect(loadPrompt("tailor-answer")).toContain(rule);
    expect(loadPrompt("tailor-resume")).not.toContain("coverLetter");
    expect(loadPrompt("tailor-cover")).not.toContain("resumeEdits");
    expect(loadPrompt("tailor-answer")).toContain("credentials");
  });

  it("parses fenced model JSON", () => {
    expect(parseModelJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });
});
