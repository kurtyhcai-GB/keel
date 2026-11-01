import { postJson, splitMessages } from "@/lib/ai/http";
import { DEFAULT_MAX_TOKENS, type AiProvider, type AiRequest, type AiResult } from "@/lib/ai/types";

export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async complete(request: AiRequest): Promise<AiResult> {
    const { system, user } = splitMessages(request.messages);
    const payload = await postJson(
      "https://api.anthropic.com/v1/messages",
      {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      {
        model: this.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: request.temperature ?? 0.2,
        system,
        messages: [{ role: "user", content: user }],
      },
    );
    const blocks = (payload as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
    const text = blocks
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n");
    if (!text.trim()) throw new Error("The model response did not include message text.");
    return { text, provider: this.id, model: this.model };
  }
}
