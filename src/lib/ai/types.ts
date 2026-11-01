export type AiMessage = {
  role: "system" | "user";
  content: string;
};

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
