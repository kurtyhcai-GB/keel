import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProvider } from "@/lib/ai";
import { OpenAiProvider } from "@/lib/ai/openai";
import { AnthropicProvider } from "@/lib/ai/anthropic";
import { GoogleProvider } from "@/lib/ai/google";
import { OpenAiCompatibleProvider } from "@/lib/ai/compatible";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveProvider", () => {
  it("defaults to the local heuristic and reports a missing key", () => {
    expect(resolveProvider({}).mode).toBe("local");
    expect(resolveProvider({ AI_PROVIDER: "openai" })).toMatchObject({
      mode: "misconfigured",
    });
    const mock = resolveProvider({ AI_PROVIDER: "mock" });
    expect(mock.mode).toBe("ready");
    if (mock.mode === "ready") expect(mock.provider.id).toBe("mock");
  });
});

describe("provider requests", () => {
  it("sends an OpenAI chat completion with the bearer token", async () => {
    const seen: { url?: string; auth?: string } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.url = url;
        seen.auth = new Headers(init.headers).get("authorization") ?? undefined;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
          { status: 200 },
        );
      }),
    );
    const result = await new OpenAiProvider("test-key", "gpt-test").complete({
      json: true,
      messages: [{ role: "user", content: "Return JSON." }],
    });
    expect(seen.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(seen.auth).toBe("Bearer test-key");
    expect(result.text).toContain("ok");
    expect(result.provider).toBe("openai");
  });

  it("calls Anthropic and Google with their own headers", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${url} ${new Headers(init.headers).get("x-api-key") ?? ""} ${new Headers(init.headers).get("x-goog-api-key") ?? ""}`);
        if (String(url).includes("anthropic")) {
          return new Response(JSON.stringify({ content: [{ type: "text", text: "anthropic-ok" }] }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "google-ok" }] } }] }),
          { status: 200 },
        );
      }),
    );
    const anthropic = await new AnthropicProvider("anthropic-key", "claude-test").complete({
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: "job" },
      ],
    });
    const google = await new GoogleProvider("google-key", "gemini-test").complete({
      messages: [{ role: "user", content: "job" }],
    });
    expect(anthropic.text).toBe("anthropic-ok");
    expect(google.text).toBe("google-ok");
    expect(calls.some((call) => call.includes("anthropic-key"))).toBe(true);
    expect(calls.some((call) => call.includes("google-key") && call.includes("gemini-test"))).toBe(true);
  });

  it("uses a configured OpenAI-compatible base URL", async () => {
    let seen = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen = String(url);
        return new Response(JSON.stringify({ choices: [{ message: { content: "local-ok" } }] }), {
          status: 200,
        });
      }),
    );
    const result = await new OpenAiCompatibleProvider(
      "http://127.0.0.1:11434/v1/",
      "llama",
    ).complete({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(seen).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(result.provider).toBe("openai-compatible");
    expect(result.text).toBe("local-ok");
  });
});
