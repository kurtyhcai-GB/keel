import { handle } from "@/lib/api";
import { listTrackedJobs } from "@/lib/data";
import { jobSort } from "@/lib/schemas";

export function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const sort = jobSort.safeParse(url.searchParams.get("sort") ?? "score");
    const direction = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
    const jobs = await listTrackedJobs(sort.success ? sort.data : "score", direction);
    return Response.json({ jobs, sort: sort.success ? sort.data : "score", dir: direction });
  });
}
