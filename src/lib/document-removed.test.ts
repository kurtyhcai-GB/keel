import { describe, expect, it } from "vitest";
import { documentRemovedMessage } from "@/lib/document-removed";

describe("documentRemovedMessage", () => {
  it("mentions accepted facts only when some were kept", () => {
    expect(documentRemovedMessage(0)).toBe("Document removed.");
    expect(documentRemovedMessage(1)).toBe("Document removed. 1 accepted fact stays in your baseline.");
    expect(documentRemovedMessage(3)).toBe("Document removed. 3 accepted facts stay in your baseline.");
  });
});
