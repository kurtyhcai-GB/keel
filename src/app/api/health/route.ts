import { resolveProvider } from "@/lib/ai";

export function GET() {
  const resolution = resolveProvider();
  return Response.json({
    ok: true,
    service: "keel",
    provider: resolution.mode === "ready" ? resolution.provider.id : resolution.mode,
    model: resolution.mode === "ready" ? resolution.provider.model : null,
    message: resolution.mode === "misconfigured" ? resolution.message : null,
  });
}
