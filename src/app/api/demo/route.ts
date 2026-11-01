import { handle, readJson } from "@/lib/api";
import { clearDemo, loadDemo } from "@/lib/demo";
import { demoInput } from "@/lib/schemas";

export function POST(request: Request) {
  return handle(async () => {
    const input = demoInput.parse(await readJson(request));
    const result = input.action === "load" ? await loadDemo() : await clearDemo();
    return Response.json(result);
  });
}
