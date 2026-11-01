import { handle, readJson } from "@/lib/api";
import { createFact, listFacts, listQuestions } from "@/lib/data";
import { factInput } from "@/lib/schemas";

export function GET() {
  return handle(async () =>
    Response.json({
      facts: await listFacts(),
      questions: await listQuestions(),
    }),
  );
}

export function POST(request: Request) {
  return handle(async () => {
    const input = factInput.parse(await readJson(request));
    const saved = await createFact(input, { status: "confirmed" });
    return Response.json(saved, { status: 201 });
  });
}
