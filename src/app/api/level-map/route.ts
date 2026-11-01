import { handle, readJson } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { loadLevelMap, saveLevelMapOverride } from "@/lib/level-map";
import { levelEditInput } from "@/lib/schemas";

export function GET() {
  return Response.json(loadLevelMap());
}

export function PATCH(request: Request) {
  return handle(async () => {
    const input = levelEditInput.parse(await readJson(request));
    try {
      return Response.json({ entry: saveLevelMapOverride(input) });
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : "Could not save the level row.", 404);
    }
  });
}
