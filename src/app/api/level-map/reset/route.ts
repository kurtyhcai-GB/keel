import { handle, readJson } from "@/lib/api";
import { resetLevelMapRow } from "@/lib/level-map";

export function POST(request: Request) {
  return handle(async () => {
    const entry = resetLevelMapRow(await readJson(request));
    return Response.json({ entry });
  });
}
