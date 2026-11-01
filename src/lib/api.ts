import { connection } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("Request body must be JSON.", 400);
  }
}

export async function handle(work: () => Promise<Response>): Promise<Response> {
  await connection();
  try {
    return await work();
  } catch (error) {
    if (error instanceof ZodError) {
      const message = error.issues
        .map((issue) => {
          const issuePath = issue.path.join(".");
          return issuePath ? `${issuePath}: ${issue.message}` : issue.message;
        })
        .join("; ");
      return jsonError(message || "Invalid input.");
    }
    if (error instanceof AppError) {
      return jsonError(error.message, error.status, error.extra);
    }
    console.error(error);
    return jsonError("Something went wrong.", 500);
  }
}
