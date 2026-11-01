import { postJson, splitMessages } from "@/lib/ai/http";
import { DEFAULT_MAX_TOKENS, type AiProvider, type AiRequest, type AiResult } from "@/lib/ai/types";

export class GoogleProvider implements AiProvider {
  readonly id = "google";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async complete(request: AiRequest): Promise<AiResult> {
    const { system, user } = splitMessages(request.messages);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const payload = await postJson(
      url,
      { "x-goog-api-key": this.apiKey },
      {
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: request.temperature ?? 0.2,
          maxOutputTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(request.json ? { responseMimeType: "application/json" } : {}),
        },
      },
    );
    const candidate = (
      payload as {
        candidates?: Array<{
          finishReason?: string;
          content?: { parts?: Array<{ text?: string }> };
        }>;
      }
    ).candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new Error(
        "The model reply was cut off (output token limit). Try again or pick another model.",
      );
    }
    const parts = candidate?.content?.parts ?? [];
    const text = parts.map((part) => part.text ?? "").join("");
    if (!text.trim()) throw new Error("The model response did not include message text.");
    return { text, provider: this.id, model: this.model };
  }
}
