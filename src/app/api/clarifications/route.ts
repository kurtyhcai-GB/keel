import { handle } from "@/lib/api";
import { listQuestions } from "@/lib/data";

export function GET() {
  return handle(async () => Response.json({ questions: await listQuestions() }));
}
