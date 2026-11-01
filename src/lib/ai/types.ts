export type AiMessage = {
  role: "system" | "user";
  content: string;
};

/** Room for reasoning models that spend output tokens before the answer. */
export const DEFAULT_MAX_TOKENS = 16384;

export type AiRequest = {
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
};

export type AiResult = {
  text: string;
  provider: string;
  model: string;
};

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  complete(request: AiRequest): Promise<AiResult>;
}
