import { handle } from "@/lib/api";
import { deleteDocument } from "@/lib/data";

type Context = { params: Promise<{ id: string }> };

export function DELETE(_request: Request, context: Context) {
  return handle(async () => {
    const { id } = await context.params;
    await deleteDocument(id);
    return Response.json({ deleted: true });
  });
}
