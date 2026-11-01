import { readFileSync } from "node:fs";
import path from "node:path";
import { AnthropicProvider } from "@/lib/ai/anthropic";
import { OpenAiCompatibleProvider } from "@/lib/ai/compatible";
import { GoogleProvider } from "@/lib/ai/google";
import { MockProvider } from "@/lib/ai/mock";
import { OpenAiProvider } from "@/lib/ai/openai";
import type { AiProvider } from "@/lib/ai/types";

export type { AiMessage, AiProvider, AiRequest, AiResult } from "@/lib/ai/types";

export type ProviderResolution =
  | { mode: "local" }
  | { mode: "ready"; provider: AiProvider }
  | { mode: "misconfigured"; message: string };

export type PromptName = "extract-baseline" | "evaluate-posting" | "tailor-materials";

export function loadPrompt(name: PromptName): string {
  const file = path.join(process.cwd(), "prompts", `${name}.md`);
  return readFileSync(file, "utf8");
}

export function resolveProvider(
  env: Record<string, string | undefined> = process.env,
): ProviderResolution {
  const id = (env.AI_PROVIDER ?? "local").trim().toLowerCase();
  if (id === "" || id === "local" || id === "heuristic") return { mode: "local" };
  if (id === "mock") return { mode: "ready", provider: new MockProvider() };
  if (id === "openai") {
    if (!env.OPENAI_API_KEY) {
      return { mode: "misconfigured", message: "OPENAI_API_KEY is not set." };
    }
    return {
      mode: "ready",
      provider: new OpenAiProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL || "gpt-4o-mini"),
    };
  }
  if (id === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      return { mode: "misconfigured", message: "ANTHROPIC_API_KEY is not set." };
    }
    return {
      mode: "ready",
      provider: new AnthropicProvider(
        env.ANTHROPIC_API_KEY,
        env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      ),
    };
  }
  if (id === "google") {
    if (!env.GOOGLE_API_KEY) {
      return { mode: "misconfigured", message: "GOOGLE_API_KEY is not set." };
    }
    return {
      mode: "ready",
      provider: new GoogleProvider(env.GOOGLE_API_KEY, env.GOOGLE_MODEL || "gemini-3.6-flash"),
    };
  }
  if (id === "openai-compatible") {
    if (!env.OPENAI_COMPATIBLE_BASE_URL || !env.OPENAI_COMPATIBLE_MODEL) {
      return {
        mode: "misconfigured",
        message: "OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL are required.",
      };
    }
    return {
      mode: "ready",
      provider: new OpenAiCompatibleProvider(
        env.OPENAI_COMPATIBLE_BASE_URL,
        env.OPENAI_COMPATIBLE_MODEL,
        env.OPENAI_COMPATIBLE_API_KEY || undefined,
      ),
    };
  }
  return {
    mode: "misconfigured",
    message: `Unknown AI_PROVIDER "${id}". Use local, mock, openai, anthropic, google, or openai-compatible.`,
  };
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed) as unknown;
}
