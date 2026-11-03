import { handle, readJson } from "@/lib/api";
import { deleteTailorAnswer, updateTailorAnswer } from "@/lib/data";
import { tailorAnswerPatch } from "@/lib/schemas";

type Context = { params: Promise<{ id: string }> };

export function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const { id } = await context.params;
    const input = tailorAnswerPatch.parse(await readJson(request));
    return Response.json(await updateTailorAnswer(id, input));
  });
}

export function DELETE(_request: Request, context: Context) {
  return handle(async () => {
    const { id } = await context.params;
    await deleteTailorAnswer(id);
    return Response.json({ deleted: true });
  });
}
