import { handle, readJson } from "@/lib/api";
import { getTailorDraft, tailorPosting } from "@/lib/data";
import { AppError } from "@/lib/errors";
import { tailorInput } from "@/lib/schemas";

type Target = "resume" | "coverLetter";

export function GET(request: Request) {
  return handle(async () => {
    const jobPostingId = new URL(request.url).searchParams.get("jobPostingId")?.trim() ?? "";
    if (!jobPostingId) throw new AppError("jobPostingId is required.", 400);
    return Response.json(await getTailorDraft(jobPostingId));
  });
}

export function POST(request: Request) {
  return handle(async () => {
    const input = tailorInput.parse(await readJson(request));
    const targets: Target[] = input.targets?.length ? [...new Set(input.targets)] : ["resume", "coverLetter"];
    return Response.json(await tailorPosting(input.jobPostingId, targets));
  });
}
