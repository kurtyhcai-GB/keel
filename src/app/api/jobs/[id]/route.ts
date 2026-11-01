import { handle } from "@/lib/api";
import { deleteTrackedJob } from "@/lib/data";

type Context = { params: Promise<{ id: string }> };

export function DELETE(_request: Request, context: Context) {
  return handle(async () => {
    const { id } = await context.params;
    await deleteTrackedJob(id);
    return Response.json({ deleted: true });
  });
}
