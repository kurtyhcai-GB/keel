import { loadLevelMap } from "@/lib/level-map";

export function GET() {
  return Response.json(loadLevelMap());
}
