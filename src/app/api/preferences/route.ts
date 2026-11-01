import { handle, readJson } from "@/lib/api";
import { getPreferences, savePreferences } from "@/lib/data";
import { preferenceInput } from "@/lib/schemas";

export function GET() {
  return handle(async () => Response.json({ preferences: await getPreferences() }));
}

export function PUT(request: Request) {
  return handle(async () => {
    const input = preferenceInput.parse(await readJson(request));
    return Response.json({ preferences: await savePreferences(input) });
  });
}
