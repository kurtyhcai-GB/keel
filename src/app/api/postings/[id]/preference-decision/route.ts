import { handle, readJson } from "@/lib/api";
import { resolvePreferenceHold } from "@/lib/data";
import { preferenceDecisionInput } from "@/lib/schemas";

type Context = { params: Promise<{ id: string }> };

export function POST(request: Request, context: Context) {
  return handle(async () => {
    const { id } = await context.params;
    const input = preferenceDecisionInput.parse(await readJson(request));
    return Response.json(await resolvePreferenceHold(id, input.continue));
  });
}
