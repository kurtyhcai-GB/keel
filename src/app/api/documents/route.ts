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
    const duplicateActionRaw = form.get("duplicateAction");
    const duplicateAction =
      duplicateActionRaw === "replace" || duplicateActionRaw === "keep_both"
        ? duplicateActionRaw
        : undefined;
    const replaceDocumentIdRaw = form.get("replaceDocumentId");
    const replaceDocumentId =
      typeof replaceDocumentIdRaw === "string" && replaceDocumentIdRaw.trim()
        ? replaceDocumentIdRaw.trim()
        : undefined;
    const options: import("@/lib/data").SaveUploadOptions =
      duplicateAction !== undefined
        ? { duplicateAction, replaceDocumentId }
        : {};
    if (options.duplicateAction === "replace" && !options.replaceDocumentId) {
      throw new AppError("Replace requires the document id to update.", 400);
    }
    return Response.json(await saveUpload(file, options));
  });
}
