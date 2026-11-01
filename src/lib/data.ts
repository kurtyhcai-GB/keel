import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPrisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { blendOverall, findPreferencePauses, parsePosting, produceEvaluation, ruledOutReason } from "@/lib/evaluate";
import { conflictQuestion, proposeFacts, excerptIsInSource, type ProposedFact } from "@/lib/extract";
import { assertUploadSize, textFromUpload } from "@/lib/files";
import { asIso, asNumber, parseJson, parseStringArray } from "@/lib/json";
import { loadLevelMap } from "@/lib/level-map";
import type { factInput, factPatch, preferenceInput, questionPatch } from "@/lib/schemas";
import { produceTailor } from "@/lib/tailor";
import type {
  CitedFact,
  DocumentView,
  FactView,
  PostingView,
  PreferenceMismatch,
  PreferenceView,
  QuestionView,
  TrackedJobView,
  WorkMode,
} from "@/lib/types";
import { formatLocationAndWorksite } from "@/lib/types";
import type { z } from "zod";

type FactInput = z.infer<typeof factInput>;
type FactPatch = z.infer<typeof factPatch>;
type PreferenceInput = z.infer<typeof preferenceInput>;
type QuestionPatch = z.infer<typeof questionPatch>;

const WORK_MODES = new Set<WorkMode>(["remote", "hybrid", "onsite"]);

export async function getLocalUser() {
  const id = process.env.LOCAL_USER_ID || "local";
  const displayName = process.env.LOCAL_USER_NAME || "Local user";
  return getPrisma().user.upsert({
    where: { id },
    update: { displayName },
    create: { id, displayName },
  });
}

function serializeFact(fact: {
  id: string;
  userId: string;
  documentId: string | null;
  kind: string;
  title: string | null;
  company: string | null;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  summary: string;
  skillsJson: string;
  impact: string | null;
  sourceExcerpt: string;
  sourceLocator: string | null;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): FactView {
  return {
    id: fact.id,
    documentId: fact.documentId,
    kind: fact.kind,
    title: fact.title,
    company: fact.company,
    startDate: fact.startDate,
    endDate: fact.endDate,
    location: fact.location,
    summary: fact.summary,
    skills: parseStringArray(fact.skillsJson),
    impact: fact.impact,
    sourceExcerpt: fact.sourceExcerpt,
    sourceLocator: fact.sourceLocator,
    status: fact.status,
    createdAt: asIso(fact.createdAt),
    updatedAt: asIso(fact.updatedAt),
  };
}

function toCited(fact: FactView): CitedFact {
  return {
    id: fact.id,
    title: fact.title,
    company: fact.company,
    startDate: fact.startDate,
    endDate: fact.endDate,
    summary: fact.summary,
    skills: fact.skills,
    impact: fact.impact,
    sourceExcerpt: fact.sourceExcerpt,
  };
}

export async function listDocuments(): Promise<DocumentView[]> {
  const user = await getLocalUser();
  const rows = await getPrisma().document.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    byteSize: asNumber(row.byteSize) ?? 0,
    createdAt: asIso(row.createdAt),
    textPreview: row.textContent.slice(0, 400),
  }));
}

export async function listFacts(): Promise<FactView[]> {
  const user = await getLocalUser();
  const rows = await getPrisma().baselineFact.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(serializeFact);
}

export async function listQuestions(): Promise<QuestionView[]> {
  const user = await getLocalUser();
  const rows = await getPrisma().clarificationQuestion.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    factId: row.factId,
    relatedFactIds: parseStringArray(row.relatedFactIds),
    question: row.question,
    detail: row.detail,
    answer: row.answer,
    status: row.status,
    createdAt: asIso(row.createdAt),
  }));
}

async function assertDocument(userId: string, documentId: string | null | undefined) {
  if (!documentId) return null;
  const document = await getPrisma().document.findFirst({ where: { id: documentId, userId } });
  if (!document) throw new AppError("That document was not found.", 404);
  return document;
}

export async function createFact(
  input: FactInput | ProposedFact,
  options: { status?: string; requireGroundedExcerpt?: boolean; documentId?: string | null } = {},
) {
  const user = await getLocalUser();
  const documentId = options.documentId ?? ("documentId" in input ? input.documentId : null) ?? null;
  const document = await assertDocument(user.id, documentId);
  const sourceExcerpt =
    ("sourceExcerpt" in input && input.sourceExcerpt?.trim()) || "Entered by hand.";
  if (options.requireGroundedExcerpt) {
    if (!document) throw new AppError("Extracted facts need a source document.", 400);
    if (!excerptIsInSource(document.textContent, sourceExcerpt)) {
      throw new AppError("That excerpt is not in the source document.", 400);
    }
  }
  const existing = await listFacts();
  const incoming = {
    title: input.title ?? null,
    company: input.company ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
  };
  const conflicts = existing
    .map((fact) => ({ fact, question: conflictQuestion(fact, incoming) }))
    .filter((item): item is { fact: FactView; question: { question: string; detail: string } } =>
      item.question !== null,
    );
  const created = await getPrisma().baselineFact.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      documentId,
      kind: input.kind || "role",
      title: incoming.title,
      company: incoming.company,
      startDate: incoming.startDate,
      endDate: incoming.endDate,
      location: input.location ?? null,
      summary: input.summary,
      skillsJson: JSON.stringify(input.skills ?? []),
      impact: input.impact ?? null,
      sourceExcerpt,
      sourceLocator: input.sourceLocator ?? null,
      status: conflicts.length > 0 ? "draft" : (options.status ?? "confirmed"),
    },
  });
  const questions = [];
  for (const conflict of conflicts) {
    const row = await getPrisma().clarificationQuestion.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        factId: created.id,
        relatedFactIds: JSON.stringify([conflict.fact.id, created.id]),
        question: conflict.question.question,
        detail: conflict.question.detail,
        status: "open",
      },
    });
    questions.push(row);
  }
  return { fact: serializeFact(created), conflicts: questions.map((row) => row.id) };
}

export async function updateFact(id: string, patch: FactPatch) {
  const user = await getLocalUser();
  const current = await getPrisma().baselineFact.findFirst({ where: { id, userId: user.id } });
  if (!current) throw new AppError("Fact not found.", 404);
  const updated = await getPrisma().baselineFact.update({
    where: { id },
    data: {
      kind: patch.kind ?? current.kind,
      title: patch.title === undefined ? current.title : patch.title,
      company: patch.company === undefined ? current.company : patch.company,
      startDate: patch.startDate === undefined ? current.startDate : patch.startDate,
      endDate: patch.endDate === undefined ? current.endDate : patch.endDate,
      location: patch.location === undefined ? current.location : patch.location,
      summary: patch.summary ?? current.summary,
      skillsJson: patch.skills ? JSON.stringify(patch.skills) : current.skillsJson,
      impact: patch.impact === undefined ? current.impact : patch.impact,
      sourceExcerpt: patch.sourceExcerpt?.trim() || current.sourceExcerpt,
      sourceLocator: patch.sourceLocator === undefined ? current.sourceLocator : patch.sourceLocator,
      status: "confirmed",
    },
  });
  const others = (await listFacts()).filter((fact) => fact.id !== id);
  const conflict = others
    .map((fact) => ({ fact, question: conflictQuestion(fact, updated) }))
    .find((item) => item.question !== null);
  let questionId: string | null = null;
  if (conflict?.question) {
    const row = await getPrisma().clarificationQuestion.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        factId: id,
        relatedFactIds: JSON.stringify([conflict.fact.id, id]),
        question: conflict.question.question,
        detail: conflict.question.detail,
        status: "open",
      },
    });
    questionId = row.id;
    await getPrisma().baselineFact.update({ where: { id }, data: { status: "draft" } });
  }
  const fresh = await getPrisma().baselineFact.findFirstOrThrow({ where: { id } });
  return { fact: serializeFact(fresh), conflictId: questionId };
}

export async function deleteFact(id: string) {
  const user = await getLocalUser();
  const current = await getPrisma().baselineFact.findFirst({ where: { id, userId: user.id } });
  if (!current) throw new AppError("Fact not found.", 404);
  await getPrisma().baselineFact.delete({ where: { id } });
}

export async function answerQuestion(id: string, patch: QuestionPatch) {
  const user = await getLocalUser();
  const current = await getPrisma().clarificationQuestion.findFirst({
    where: { id, userId: user.id },
  });
  if (!current) throw new AppError("Question not found.", 404);
  // TODO: apply the answer to the conflicting facts once the owner settles
  // the resolution format. For now the answer is stored and the facts stay as written.
  const updated = await getPrisma().clarificationQuestion.update({
    where: { id },
    data: {
      answer: patch.answer ?? null,
      status: patch.status,
    },
  });
  return {
    id: updated.id,
    status: updated.status,
    answer: updated.answer,
  };
}

async function storeProposed(
  userId: string,
  documentId: string,
  proposed: Awaited<ReturnType<typeof proposeFacts>>,
) {
  const facts = [];
  const conflictIds: string[] = [];
  const warnings = [...proposed.warnings];
  for (const fact of proposed.facts) {
    try {
      const saved = await createFact(
        { ...fact, summary: fact.summary || fact.sourceExcerpt.slice(0, 280) },
        { status: "draft", requireGroundedExcerpt: true, documentId },
      );
      facts.push(saved.fact);
      conflictIds.push(...saved.conflicts);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save a fact";
      warnings.push(message);
    }
  }
  const questions = [];
  for (const question of proposed.questions) {
    const row = await getPrisma().clarificationQuestion.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        question: question.question,
        detail: question.detail,
        status: "open",
        relatedFactIds: "[]",
      },
    });
    questions.push(row.id);
  }
  return { facts, questionIds: [...questions, ...conflictIds], warnings };
}

export async function saveUpload(file: File) {
  assertUploadSize(file.size);
  const user = await getLocalUser();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = (await textFromUpload(file.name, file.type || "application/octet-stream", bytes)).slice(
    0,
    500_000,
  );
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "upload";
  const directory = path.join(process.cwd(), "data", "uploads");
  await mkdir(directory, { recursive: true });
  const storagePath = path.join(directory, `${id}-${safeName}`);
  await writeFile(storagePath, bytes);
  const document = await getPrisma().document.create({
    data: {
      id,
      userId: user.id,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      byteSize: bytes.byteLength,
      storagePath,
      textContent: text,
    },
  });
  const extracted = await storeProposed(user.id, document.id, await proposeFacts(text));
  return {
    document: {
      id: document.id,
      filename: document.filename,
      mimeType: document.mimeType,
      byteSize: asNumber(document.byteSize) ?? 0,
      createdAt: asIso(document.createdAt),
      textPreview: text.slice(0, 400),
    },
    ...extracted,
  };
}

export async function reextractDocument(id: string) {
  const user = await getLocalUser();
  const document = await getPrisma().document.findFirst({ where: { id, userId: user.id } });
  if (!document) throw new AppError("Document not found.", 404);
  await getPrisma().baselineFact.deleteMany({
    where: { userId: user.id, documentId: id, status: "draft" },
  });
  return storeProposed(user.id, id, await proposeFacts(document.textContent));
}

function serializePreference(row: {
  locationsJson: string;
  workModesJson: string;
  commuteToleranceMinutes: number | bigint | null;
  targetLevelMin: number | bigint;
  targetLevelMax: number | bigint;
  skillsWeight: number | bigint;
  notes: string | null;
}): PreferenceView {
  const modes = parseStringArray(row.workModesJson).filter((mode): mode is WorkMode =>
    WORK_MODES.has(mode as WorkMode),
  );
  return {
    locations: parseStringArray(row.locationsJson),
    workModes: modes.length ? modes : ["remote", "hybrid", "onsite"],
    commuteToleranceMinutes: asNumber(row.commuteToleranceMinutes),
    targetLevelMin: asNumber(row.targetLevelMin) ?? 63,
    targetLevelMax: asNumber(row.targetLevelMax) ?? 65,
    skillsWeight: asNumber(row.skillsWeight) ?? 65,
    notes: row.notes,
  };
}

export async function getPreferences(): Promise<PreferenceView | null> {
  const user = await getLocalUser();
  const row = await getPrisma().preference.findUnique({ where: { userId: user.id } });
  return row ? serializePreference(row) : null;
}

export async function savePreferences(
  input: PreferenceInput,
): Promise<{ preferences: PreferenceView; rescored: number }> {
  const user = await getLocalUser();
  const data = {
    locationsJson: JSON.stringify(input.locations),
    workModesJson: JSON.stringify(input.workModes),
    commuteToleranceMinutes: input.commuteToleranceMinutes,
    targetLevelMin: input.targetLevelMin,
    targetLevelMax: input.targetLevelMax,
    skillsWeight: input.skillsWeight,
    notes: input.notes ?? null,
  };
  const row = await getPrisma().preference.upsert({
    where: { userId: user.id },
    create: { id: crypto.randomUUID(), userId: user.id, ...data },
    update: data,
  });
  const preferences = serializePreference(row);
  const rescored = await recomputeStoredScores(user.id, preferences.skillsWeight);
  return { preferences, rescored };
}

async function recomputeStoredScores(userId: string, skillsWeight: number): Promise<number> {
  const rows = await getPrisma().evaluation.findMany({ where: { userId } });
  let updated = 0;
  for (const row of rows) {
    const overallScore = blendOverall(
      asNumber(row.skillsScore) ?? 0,
      asNumber(row.preferencesScore),
      skillsWeight,
    );
    if (overallScore === asNumber(row.overallScore)) continue;
    await getPrisma().evaluation.update({ where: { id: row.id }, data: { overallScore } });
    updated += 1;
  }
  return updated;
}

function postingFields(text: string) {
  return parsePosting(text, loadLevelMap());
}

export async function evaluateAndStore(input: {
  text: string;
  sourceType: "paste" | "url";
  sourceUrl: string | null;
}) {
  const user = await getLocalUser();
  const preferences = await getPreferences();
  const pauses = findPreferencePauses({ jobText: input.text, preferences });
  const parsed = postingFields(input.text);
  const postingId = crypto.randomUUID();
  if (pauses.length > 0) {
    await getPrisma().jobPosting.create({
      data: {
        id: postingId,
        userId: user.id,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        rawText: input.text.slice(0, 100_000),
        title: parsed.title,
        company: parsed.company,
        requisitionId: parsed.requisitionId,
        location: parsed.location,
        worksite: parsed.worksite,
        levelRaw: parsed.levelRaw,
        microsoftLevel: parsed.microsoftLevel,
        levelLabel: parsed.levelLabel,
        status: "awaiting_preference",
        preferenceHoldJson: JSON.stringify(pauses),
      },
    });
    return {
      status: "needs_decision" as const,
      postingId,
      mismatches: pauses,
      title: parsed.title,
      company: parsed.company,
      requisitionId: parsed.requisitionId,
      location: parsed.location,
      worksite: parsed.worksite,
    };
  }
  return scoreStoredPosting({
    userId: user.id,
    postingId,
    text: input.text,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    mismatches: [],
  });
}

export async function resolvePreferenceHold(postingId: string, continueEvaluation: boolean) {
  const user = await getLocalUser();
  const posting = await getPrisma().jobPosting.findFirst({
    where: { id: postingId, userId: user.id },
  });
  if (!posting) throw new AppError("Job posting not found.", 404);
  if (posting.status !== "awaiting_preference") {
    throw new AppError("This posting is not waiting on a location or worksite decision.", 409);
  }
  const mismatches = parseJson<PreferenceMismatch[]>(posting.preferenceHoldJson, []);
  if (!continueEvaluation) {
    const reason = ruledOutReason(mismatches);
    await getPrisma().jobPosting.update({
      where: { id: posting.id },
      data: { status: "ruled_out", ruledOutReason: reason },
    });
    return { status: "ruled_out" as const, postingId: posting.id, reason, mismatches };
  }
  return scoreStoredPosting({
    userId: user.id,
    postingId: posting.id,
    text: posting.rawText,
    sourceType: posting.sourceType === "url" ? "url" : "paste",
    sourceUrl: posting.sourceUrl,
    mismatches,
    existing: true,
  });
}

async function scoreStoredPosting(input: {
  userId: string;
  postingId: string;
  text: string;
  sourceType: "paste" | "url";
  sourceUrl: string | null;
  mismatches: PreferenceMismatch[];
  existing?: boolean;
}) {
  const facts = await listFacts();
  const preferences = await getPreferences();
  const draft = await produceEvaluation({
    jobText: input.text,
    facts: facts.map(toCited),
    preferences,
    levelMap: loadLevelMap(),
    acknowledgedMismatches: input.mismatches,
  });
  const evaluationId = crypto.randomUUID();
  const evaluationData = {
    id: evaluationId,
    userId: input.userId,
    overallScore: draft.overallScore,
    skillsScore: draft.skillsScore,
    preferencesScore: draft.preferencesScore,
    strengthsJson: JSON.stringify(draft.strengths),
    gapsJson: JSON.stringify(draft.gaps),
    dealBreakersJson: JSON.stringify(draft.dealBreakers),
    summary: draft.summary,
    provider: draft.provider,
    model: draft.model,
    warningsJson: JSON.stringify(draft.warnings),
    mismatchesJson: JSON.stringify(draft.mismatches),
  };
  if (input.existing) {
    await getPrisma().jobPosting.update({
      where: { id: input.postingId },
      data: { status: "pending", evaluation: { create: evaluationData } },
    });
  } else {
    await getPrisma().jobPosting.create({
      data: {
        id: input.postingId,
        userId: input.userId,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        rawText: input.text.slice(0, 100_000),
        title: draft.title,
        company: draft.company,
        requisitionId: draft.requisitionId,
        location: draft.location,
        worksite: draft.worksite,
        levelRaw: draft.levelRaw,
        microsoftLevel: draft.microsoftLevel,
        levelLabel: draft.levelLabel,
        status: "pending",
        evaluation: { create: evaluationData },
      },
    });
  }
  return { postingId: input.postingId, evaluationId, status: "pending" as const, ...draft };
}

export async function decideEvaluation(evaluationId: string, track: boolean) {
  const user = await getLocalUser();
  const evaluation = await getPrisma().evaluation.findFirst({
    where: { id: evaluationId, userId: user.id },
  });
  if (!evaluation) throw new AppError("Evaluation not found.", 404);
  if (!track) {
    await getPrisma().jobPosting.delete({ where: { id: evaluation.jobPostingId } });
    return { tracked: false as const };
  }
  await getPrisma().jobPosting.update({
    where: { id: evaluation.jobPostingId },
    data: { status: "tracked" },
  });
  const existing = await getPrisma().trackedJob.findUnique({
    where: { jobPostingId: evaluation.jobPostingId },
  });
  if (existing) return { tracked: true as const, trackedJobId: existing.id };
  const tracked = await getPrisma().trackedJob.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      jobPostingId: evaluation.jobPostingId,
      evaluationId: evaluation.id,
    },
  });
  return { tracked: true as const, trackedJobId: tracked.id };
}

type SortKey = "score" | "title" | "requisitionId" | "company" | "worksite" | "level";

function trackedValue(row: TrackedJobView, key: SortKey): string | number | null {
  if (key === "score") return row.score;
  if (key === "title") return row.title;
  if (key === "requisitionId") return row.requisitionId;
  if (key === "company") return row.company;
  if (key === "worksite") return row.locationAndWorksite;
  if (key === "level") return row.microsoftLevel ?? row.level;
  return null;
}

export async function listTrackedJobs(sort: SortKey = "score", direction: "asc" | "desc" = "desc") {
  const user = await getLocalUser();
  const preferences = await getPreferences();
  const skillsWeight = preferences?.skillsWeight ?? 65;
  const rows = await getPrisma().trackedJob.findMany({
    where: { userId: user.id },
    include: { jobPosting: true, evaluation: true },
  });
  const views: TrackedJobView[] = rows.map((row) => {
    const level = row.jobPosting.levelLabel || row.jobPosting.levelRaw;
    const skillsScore = asNumber(row.evaluation.skillsScore) ?? 0;
    const preferencesScore = asNumber(row.evaluation.preferencesScore);
    return {
      id: row.id,
      jobPostingId: row.jobPostingId,
      evaluationId: row.evaluationId,
      score: blendOverall(skillsScore, preferencesScore, skillsWeight),
      skillsScore,
      preferencesScore,
      title: row.jobPosting.title,
      requisitionId: row.jobPosting.requisitionId,
      company: row.jobPosting.company,
      location: row.jobPosting.location,
      worksite: row.jobPosting.worksite,
      locationAndWorksite: formatLocationAndWorksite(row.jobPosting.location, row.jobPosting.worksite),
      level,
      microsoftLevel: asNumber(row.jobPosting.microsoftLevel),
      summary: row.evaluation.summary,
      strengths: parseJson(row.evaluation.strengthsJson, []),
      gaps: parseJson(row.evaluation.gapsJson, []),
      dealBreakers: parseJson(row.evaluation.dealBreakersJson, []),
      warnings: parseJson(row.evaluation.warningsJson, []),
      mismatches: parseJson(row.evaluation.mismatchesJson, []),
      provider: row.evaluation.provider,
      createdAt: asIso(row.createdAt),
    };
  });
  const sign = direction === "asc" ? 1 : -1;
  views.sort((left, right) => {
    const a = trackedValue(left, sort);
    const b = trackedValue(right, sort);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
    return String(a).localeCompare(String(b)) * sign;
  });
  return views;
}

export async function deleteTrackedJob(id: string) {
  const user = await getLocalUser();
  const tracked = await getPrisma().trackedJob.findFirst({ where: { id, userId: user.id } });
  if (!tracked) throw new AppError("Tracked job not found.", 404);
  await getPrisma().jobPosting.delete({ where: { id: tracked.jobPostingId } });
}

export async function listPostings(): Promise<PostingView[]> {
  const user = await getLocalUser();
  const rows = await getPrisma().jobPosting.findMany({
    where: { userId: user.id, status: { in: ["pending", "tracked"] } },
    include: { evaluation: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    title: row.title,
    company: row.company,
    requisitionId: row.requisitionId,
    locationAndWorksite: formatLocationAndWorksite(row.location, row.worksite),
    level: row.levelLabel || row.levelRaw,
    score: asNumber(row.evaluation?.overallScore ?? null),
    createdAt: asIso(row.createdAt),
  }));
}

export async function tailorPosting(jobPostingId: string) {
  const user = await getLocalUser();
  const posting = await getPrisma().jobPosting.findFirst({
    where: { id: jobPostingId, userId: user.id },
    include: { evaluation: true },
  });
  if (!posting) throw new AppError("Job posting not found.", 404);
  const facts = await listFacts();
  const draft = await produceTailor({
    facts: facts.map(toCited),
    job: {
      id: posting.id,
      title: posting.title,
      company: posting.company,
      rawText: posting.rawText,
    },
    displayName: user.displayName,
  });
  const saved = await getPrisma().tailorOutput.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      jobPostingId: posting.id,
      evaluationId: posting.evaluation?.id ?? null,
      resumeEditsJson: JSON.stringify(draft.resumeEdits),
      coverLetter: draft.coverLetter,
      provider: draft.provider,
      model: draft.model,
      warningsJson: JSON.stringify(draft.warnings),
    },
  });
  return {
    ...draft,
    id: saved.id,
    createdAt: asIso(saved.createdAt),
  };
}
