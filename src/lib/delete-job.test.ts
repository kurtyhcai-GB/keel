import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { deleteJobPostingForUser } from "@/lib/delete-job";
import { AppError } from "@/lib/errors";

const dir = mkdtempSync(path.join(tmpdir(), "keel-delete-job-"));
const databaseUrl = `file:${path.join(dir, "test.sqlite")}`;

let prisma: PrismaClient;

beforeAll(() => {
  execSync(`npx prisma db push --url ${JSON.stringify(databaseUrl)}`, {
    stdio: "pipe",
  });
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

async function seedPosting(userId: string, postingId: string) {
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, displayName: userId },
  });
  await prisma.jobPosting.create({
    data: {
      id: postingId,
      userId,
      sourceType: "paste",
      rawText: "Role text",
      title: "Program Manager",
      company: "Northwind",
      status: "tracked",
      ruledOutReason: "kept for the record",
    },
  });
  await prisma.evaluation.create({
    data: {
      id: `${postingId}-eval`,
      userId,
      jobPostingId: postingId,
      overallScore: 80,
      skillsScore: 70,
      strengthsJson: "[]",
      gapsJson: "[]",
      dealBreakersJson: "[]",
      summary: "Strong match",
      provider: "mock",
    },
  });
  await prisma.trackedJob.create({
    data: {
      id: `${postingId}-tracked`,
      userId,
      jobPostingId: postingId,
      evaluationId: `${postingId}-eval`,
    },
  });
  await prisma.tailorOutput.create({
    data: {
      id: `${postingId}-tailor`,
      userId,
      jobPostingId: postingId,
      evaluationId: `${postingId}-eval`,
      resumeEditsJson: "[]",
      coverLetter: "Dear hiring team",
      provider: "mock",
    },
  });
  await prisma.tailorAnswer.create({
    data: {
      id: `${postingId}-answer`,
      userId,
      jobPostingId: postingId,
      question: "Why this role?",
      answer: "Because of the scope.",
    },
  });
}

describe("deleteJobPostingForUser", () => {
  it("removes the posting and every dependent row", async () => {
    await seedPosting("owner", "post-1");

    await deleteJobPostingForUser(prisma, "owner", "post-1");

    expect(await prisma.jobPosting.findUnique({ where: { id: "post-1" } })).toBeNull();
    expect(await prisma.evaluation.count({ where: { jobPostingId: "post-1" } })).toBe(0);
    expect(await prisma.trackedJob.count({ where: { jobPostingId: "post-1" } })).toBe(0);
    expect(await prisma.tailorOutput.count({ where: { jobPostingId: "post-1" } })).toBe(0);
    expect(await prisma.tailorAnswer.count({ where: { jobPostingId: "post-1" } })).toBe(0);
  });

  it("returns 404 for a missing posting and for another user's posting", async () => {
    await seedPosting("owner", "post-2");
    await seedPosting("other", "post-3");

    await expect(deleteJobPostingForUser(prisma, "owner", "missing")).rejects.toMatchObject({
      status: 404,
      message: "Job posting not found.",
    });
    await expect(deleteJobPostingForUser(prisma, "owner", "post-3")).rejects.toBeInstanceOf(AppError);

    expect(await prisma.jobPosting.findUnique({ where: { id: "post-2" } })).not.toBeNull();
    expect(await prisma.jobPosting.findUnique({ where: { id: "post-3" } })).not.toBeNull();
    expect(await prisma.tailorAnswer.count({ where: { jobPostingId: "post-3" } })).toBe(1);
  });
});
