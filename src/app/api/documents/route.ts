import { handle } from "@/lib/api";
import { listDocuments, saveUpload } from "@/lib/data";
import { AppError } from "@/lib/errors";

export function GET() {
  return handle(async () => Response.json({ documents: await listDocuments() }));
}

export function POST(request: Request) {
  return handle(async () => {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a file to upload.", 400);
    return Response.json(await saveUpload(file));
  });
}
