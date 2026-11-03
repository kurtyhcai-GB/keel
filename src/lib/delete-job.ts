import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";

/**
 * Permanently remove one job posting and every row that points at it.
 * Scoped to the owner: a missing id and another user's id both return 404.
 * Dependents are deleted in a transaction so removal does not rely only on
 * database cascades (those are also set on JobPosting relations).
 */
export async function deleteJobPostingForUser(
  prisma: PrismaClient,
  userId: string,
  jobPostingId: string,
): Promise<void> {
  const posting = await prisma.jobPosting.findFirst({
    where: { id: jobPostingId, userId },
    select: { id: true },
  });
  if (!posting) throw new AppError("Job posting not found.", 404);

  await prisma.$transaction(async (tx) => {
    await tx.tailorAnswer.deleteMany({ where: { jobPostingId } });
    await tx.tailorOutput.deleteMany({ where: { jobPostingId } });
    await tx.trackedJob.deleteMany({ where: { jobPostingId } });
    await tx.evaluation.deleteMany({ where: { jobPostingId } });
    await tx.jobPosting.delete({ where: { id: jobPostingId } });
  });
}
