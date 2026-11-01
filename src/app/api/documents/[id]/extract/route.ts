import { handle } from "@/lib/api";
import { reextractDocument } from "@/lib/data";

type Context = { params: Promise<{ id: string }> };

export function POST(_request: Request, context: Context) {
  return handle(async () => {
    const { id } = await context.params;
    return Response.json(await reextractDocument(id));
  });
}
