import { handle, readJson } from "@/lib/api";
import { createTailorAnswer, listTailorAnswers } from "@/lib/data";
import { AppError } from "@/lib/errors";
import { tailorAnswerCreate } from "@/lib/schemas";

export function GET(request: Request) {
  return handle(async () => {
    const jobPostingId = new URL(request.url).searchParams.get("jobPostingId")?.trim() ?? "";
    if (!jobPostingId) throw new AppError("jobPostingId is required.", 400);
    return Response.json(await listTailorAnswers(jobPostingId));
  });
}

export function POST(request: Request) {
  return handle(async () => {
    const input = tailorAnswerCreate.parse(await readJson(request));
    return Response.json(await createTailorAnswer(input));
  });
}
