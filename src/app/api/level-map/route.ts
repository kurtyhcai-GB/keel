import { connection } from "next/server";
import { handle, readJson } from "@/lib/api";
import { addLevelMapRow, deleteLevelMapRow, loadLevelMap, saveLevelMapOverride } from "@/lib/level-map";

export async function GET() {
  await connection();
  return Response.json(loadLevelMap());
}

export function POST(request: Request) {
  return handle(async () => {
    const entry = addLevelMapRow(await readJson(request));
    return Response.json({ entry }, { status: 201 });
  });
}

export function PATCH(request: Request) {
  return handle(async () => {
    const entry = saveLevelMapOverride(await readJson(request));
    return Response.json({ entry });
  });
}

export function DELETE(request: Request) {
  return handle(async () => {
    await deleteLevelMapRow(await readJson(request));
    return Response.json({ ok: true });
  });
}
