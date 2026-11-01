import { handle, readJson } from "@/lib/api";
import { answerQuestion } from "@/lib/data";
import { questionPatch } from "@/lib/schemas";

type Context = { params: Promise<{ id: string }> };

export function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const { id } = await context.params;
    const input = questionPatch.parse(await readJson(request));
    return Response.json(await answerQuestion(id, input));
  });
}
