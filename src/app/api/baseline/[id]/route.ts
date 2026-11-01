import { handle, readJson } from "@/lib/api";
import { deleteFact, updateFact } from "@/lib/data";
import { factPatch } from "@/lib/schemas";

type Context = { params: Promise<{ id: string }> };

export function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const { id } = await context.params;
    const input = factPatch.parse(await readJson(request));
    return Response.json(await updateFact(id, input));
  });
}

export function DELETE(_request: Request, context: Context) {
  return handle(async () => {
    const { id } = await context.params;
    await deleteFact(id);
    return Response.json({ deleted: true });
  });
}
