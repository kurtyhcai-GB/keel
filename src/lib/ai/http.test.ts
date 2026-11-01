import { afterEach, describe, expect, it, vi } from "vitest";
import { postJson } from "@/lib/ai/http";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("postJson retries", () => {
  it("retries transient provider errors before failing", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) {
          return new Response("overloaded", { status: 503 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    const promise = postJson("https://example.test/v1", {}, { ping: true });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ ok: true });
    expect(attempts).toBe(3);
  });

  it("does not retry a 404", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        return new Response("model not found", { status: 404 });
      }),
    );
    await expect(postJson("https://example.test/v1", {}, {})).rejects.toThrow(/404/);
    expect(attempts).toBe(1);
  });
});
