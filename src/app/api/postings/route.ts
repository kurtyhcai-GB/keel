import { handle } from "@/lib/api";
import { listPostings } from "@/lib/data";

export function GET() {
  return handle(async () => Response.json({ postings: await listPostings() }));
}
