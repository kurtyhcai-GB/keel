import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, htmlToText } from "@/lib/fetch-posting";

describe("posting fetch guards", () => {
  it("rejects local and private URLs", () => {
    expect(() => assertPublicHttpUrl("http://127.0.0.1/secret")).toThrow(/private|local/i);
    expect(() => assertPublicHttpUrl("http://169.254.169.254/latest")).toThrow(/private|local/i);
    expect(() => assertPublicHttpUrl("http://192.168.1.20/jobs")).toThrow(/private|local/i);
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(/http/i);
  });

  it("allows a public https URL", () => {
    const url = assertPublicHttpUrl("https://careers.example.com/jobs/42");
    expect(url.hostname).toBe("careers.example.com");
  });

  it("strips scripts and tags from html", () => {
    const text = htmlToText("<html><script>secret()</script><p>Program manager</p></html>");
    expect(text).toContain("Program manager");
    expect(text).not.toContain("secret");
  });
});
