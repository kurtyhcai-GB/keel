import { AppError } from "@/lib/errors";

const MAX_BYTES = 8 * 1024 * 1024;

export function assertUploadSize(byteSize: number): void {
  if (byteSize > MAX_BYTES) {
    throw new AppError("Files must be 8 MB or smaller.", 413);
  }
}

export async function textFromUpload(filename: string, mimeType: string, bytes: Uint8Array): Promise<string> {
  const lower = filename.toLowerCase();
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".text") ||
    mimeType.startsWith("text/")
  ) {
    return new TextDecoder().decode(bytes);
  }
  if (lower.endsWith(".docx") || mimeType.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value;
  }
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const extracted = await extractText(pdf, { mergePages: true });
    return extracted.text;
  }
  throw new AppError("Upload a PDF, DOCX, or text file.", 415);
}
