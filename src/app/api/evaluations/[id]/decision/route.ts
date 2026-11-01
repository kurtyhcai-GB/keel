import { handle, readJson } from "@/lib/api";
import { decideEvaluation } from "@/lib/data";
import { decisionInput } from "@/lib/schemas";

type Context = { params: Promise<{ id: string }> };

export function POST(request: Request, context: Context) {
  return handle(async () => {
    const { id } = await context.params;
    const input = decisionInput.parse(await readJson(request));
    return Response.json(await decideEvaluation(id, input.track));
  });
}
