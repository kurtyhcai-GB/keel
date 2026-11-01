import { createFact, getLocalUser, getPreferences, savePreferences } from "@/lib/data";
import { getPrisma } from "@/lib/db";

const SAMPLE = "sample";

export async function loadDemo() {
  const user = await getLocalUser();
  const existing = await getPrisma().baselineFact.count({
    where: { userId: user.id, sourceLocator: SAMPLE },
  });
  if (existing > 0) return { loaded: false, reason: "Sample facts are already loaded." };

  const document = await getPrisma().document.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      filename: "[Sample] baseline.txt",
      mimeType: "text/plain",
      byteSize: 0,
      storagePath: "sample",
      textContent:
        "Sample baseline for a senior technical program manager. This is not your history. Delete it from the sidebar when you are ready to use your own record.",
    },
  });

  await createFact(
    {
      kind: "role",
      title: "Senior Technical Program Manager",
      company: "Contoso",
      startDate: "March 2019",
      endDate: "June 2024",
      location: "Redmond, WA",
      summary: "Sample: led a cross-org platform program. Not your history.",
      skills: ["technical program management", "cross-org execution"],
      sourceExcerpt: "Sample: led a cross-org platform program.",
      sourceLocator: SAMPLE,
      documentId: document.id,
    },
    { status: "confirmed" },
  );
  await createFact(
    {
      kind: "role",
      title: "Senior Technical Program Manager",
      company: "Contoso",
      startDate: "January 2018",
      endDate: "June 2024",
      location: "Redmond, WA",
      summary: "Sample: a second document gives different dates for the same role.",
      skills: ["technical program management"],
      sourceExcerpt: "Sample: a second document gives different dates.",
      sourceLocator: SAMPLE,
      documentId: document.id,
    },
    { status: "draft" },
  );

  if (!(await getPreferences())) {
    await savePreferences({
      locations: ["Seattle"],
      workModes: ["hybrid", "remote"],
      commuteToleranceMinutes: 45,
      targetLevelMin: 63,
      targetLevelMax: 65,
      skillsWeight: 65,
      notes: "Sample preferences. Replace them.",
    });
  }
  return { loaded: true };
}

export async function clearDemo() {
  const user = await getLocalUser();
  const prisma = getPrisma();
  const sampleFacts = await prisma.baselineFact.findMany({
    where: { userId: user.id, sourceLocator: SAMPLE },
    select: { id: true },
  });
  const ids = new Set(sampleFacts.map((fact) => fact.id));
  const questions = await prisma.clarificationQuestion.findMany({ where: { userId: user.id } });
  for (const question of questions) {
    const related = (() => {
      try {
        const parsed = JSON.parse(question.relatedFactIds) as unknown;
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    })();
    if ((question.factId && ids.has(question.factId)) || related.some((id) => ids.has(id))) {
      await prisma.clarificationQuestion.delete({ where: { id: question.id } });
    }
  }
  await prisma.baselineFact.deleteMany({ where: { userId: user.id, sourceLocator: SAMPLE } });
  await prisma.document.deleteMany({ where: { userId: user.id, filename: { startsWith: "[Sample]" } } });
  return { cleared: true };
}
