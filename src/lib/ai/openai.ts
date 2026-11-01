import { postJson, readOpenAiText } from "@/lib/ai/http";
import type { AiProvider, AiRequest, AiResult } from "@/lib/ai/types";

export async function completeOpenAiChat(options: {
  providerId: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  request: AiRequest;
}): Promise<AiResult> {
  const url = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model: options.model,
    temperature: options.request.temperature ?? 0.2,
    max_tokens: options.request.maxTokens ?? 4096,
    messages: options.request.messages,
  };
  if (options.request.json) {
    body.response_format = { type: "json_object" };
  }
  const headers: Record<string, string> = {};
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
  const payload = await postJson(url, headers, body);
  return {
    text: readOpenAiText(payload),
    provider: options.providerId,
    model: options.model,
  };
}

export class OpenAiProvider implements AiProvider {
  readonly id = "openai";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  complete(request: AiRequest): Promise<AiResult> {
    return completeOpenAiChat({
      providerId: this.id,
      baseUrl: "https://api.openai.com/v1",
      apiKey: this.apiKey,
      model: this.model,
      request,
    });
  }
}
