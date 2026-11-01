import { postJson, splitMessages } from "@/lib/ai/http";
import type { AiProvider, AiRequest, AiResult } from "@/lib/ai/types";

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
          maxOutputTokens: request.maxTokens ?? 4096,
          ...(request.json ? { responseMimeType: "application/json" } : {}),
        },
      },
    );
    const parts =
      (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
        .candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((part) => part.text ?? "").join("");
    if (!text.trim()) throw new Error("The model response did not include message text.");
    return { text, provider: this.id, model: this.model };
  }
}
