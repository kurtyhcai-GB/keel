import { handle, readJson } from "@/lib/api";
import { evaluateAndStore } from "@/lib/data";
import { AppError } from "@/lib/errors";
import { fetchPostingText } from "@/lib/fetch-posting";
import { evaluateInput } from "@/lib/schemas";

export function POST(request: Request) {
  return handle(async () => {
    const input = evaluateInput.parse(await readJson(request));
    let text = input.text?.trim() ?? "";
    let sourceType: "paste" | "url" = "paste";
    let sourceUrl: string | null = null;
    if (input.url?.trim()) {
      const fetched = await fetchPostingText(input.url.trim());
      if (!fetched.ok) {
        throw new AppError(fetched.reason, 422, { needsPaste: true });
      }
      text = fetched.text;
      sourceType = "url";
      sourceUrl = input.url.trim();
    }
    if (text.length < 40) {
      throw new AppError("Paste a job description of at least 40 characters, or provide a URL.", 400);
    }
    const result = await evaluateAndStore({ text, sourceType, sourceUrl });
    return Response.json(result);
  });
}
