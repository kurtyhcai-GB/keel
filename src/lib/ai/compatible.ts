import { completeOpenAiChat } from "@/lib/ai/openai";
import type { AiProvider, AiRequest, AiResult } from "@/lib/ai/types";

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = "openai-compatible";

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey?: string,
  ) {}

  complete(request: AiRequest): Promise<AiResult> {
    return completeOpenAiChat({
      providerId: this.id,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      model: this.model,
      request,
    });
  }
}
