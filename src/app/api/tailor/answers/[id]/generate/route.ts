import { handle, readJson } from "@/lib/api";
import { regenerateTailorAnswer } from "@/lib/data";
import { tailorAnswerGenerate } from "@/lib/schemas";

type Context = { params: Promise<{ id: string }> };

export function POST(request: Request, context: Context) {
  return handle(async () => {
    const { id } = await context.params;
    const input = tailorAnswerGenerate.parse(await readJson(request));
    return Response.json(await regenerateTailorAnswer(id, input));
  });
}
