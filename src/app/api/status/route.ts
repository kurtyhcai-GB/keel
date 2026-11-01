import { resolveProvider } from "@/lib/ai";
import { handle } from "@/lib/api";
import { getLocalUser } from "@/lib/data";
import { getPrisma } from "@/lib/db";

export function GET() {
  return handle(async () => {
    const user = await getLocalUser();
    const prisma = getPrisma();
    const [facts, openQuestions, preference, tracked, evaluations, tailors, demo] = await Promise.all([
      prisma.baselineFact.count({ where: { userId: user.id } }),
      prisma.clarificationQuestion.count({ where: { userId: user.id, status: "open" } }),
      prisma.preference.findUnique({ where: { userId: user.id } }),
      prisma.trackedJob.count({ where: { userId: user.id } }),
      prisma.evaluation.count({ where: { userId: user.id } }),
      prisma.tailorOutput.count({ where: { userId: user.id } }),
      prisma.baselineFact.count({ where: { userId: user.id, sourceLocator: "sample" } }),
    ]);
    const provider = resolveProvider();
    return Response.json({
      facts,
      openQuestions,
      preferencesSaved: Boolean(preference),
      tracked,
      evaluations,
      tailored: tailors > 0,
      demo: demo > 0,
      displayName: user.displayName,
      provider: provider.mode === "ready" ? provider.provider.id : provider.mode,
    });
  });
}
