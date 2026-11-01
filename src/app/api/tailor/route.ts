import { handle, readJson } from "@/lib/api";
import { tailorPosting } from "@/lib/data";
import { tailorInput } from "@/lib/schemas";

export function POST(request: Request) {
  return handle(async () => {
    const input = tailorInput.parse(await readJson(request));
    return Response.json(await tailorPosting(input.jobPostingId));
  });
}
