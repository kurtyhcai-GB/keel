const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

function retryDelayMs(attempt: number): number {
  return 250 * (attempt + 1);
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error("The model provider returned a response that was not JSON.");
      }
    }
    lastError = new Error(`The model provider returned ${response.status}: ${text.slice(0, 400)}`);
    if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
      continue;
    }
    throw lastError;
  }
  throw lastError ?? new Error("The model provider request failed.");
}

export function readOpenAiText(payload: unknown): string {
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "object" && part && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .join("");
    if (text.trim()) return text;
  }
  throw new Error("The model response did not include message text.");
}

export function splitMessages(messages: { role: string; content: string }[]): {
  system: string;
  user: string;
} {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const user = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n\n");
  return { system, user };
}
