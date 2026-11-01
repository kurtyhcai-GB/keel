import { z } from "zod";

export const workMode = z.enum(["remote", "hybrid", "onsite"]);

export const factKinds = ["role", "skill", "education", "scope", "impact", "other"] as const;

export const factInput = z.object({
  kind: z.enum(factKinds).default("role"),
  title: z.string().max(200).nullish(),
  company: z.string().max(200).nullish(),
  startDate: z.string().max(80).nullish(),
  endDate: z.string().max(80).nullish(),
  location: z.string().max(200).nullish(),
  summary: z.string().min(1).max(4000),
  skills: z.array(z.string().min(1).max(80)).max(40).optional(),
  impact: z.string().max(4000).nullish(),
  sourceExcerpt: z.string().max(4000).optional(),
  sourceLocator: z.string().max(200).nullish(),
  documentId: z.string().nullish(),
});

export const factPatch = factInput.partial();

export const questionPatch = z.object({
  answer: z.string().max(4000).nullish(),
  status: z.enum(["open", "answered", "dismissed"]).default("answered"),
});

export const preferenceInput = z
  .object({
    locations: z.array(z.string().trim().min(1).max(120)).max(20),
    workModes: z.array(workMode).min(1),
    commuteToleranceMinutes: z.number().int().min(0).max(240).nullable(),
    targetLevelMin: z.number().int().min(50).max(80),
    targetLevelMax: z.number().int().min(50).max(80),
    skillsWeight: z.number().int().min(0).max(100).default(65),
    notes: z.string().max(2000).nullish(),
  })
  .refine((value) => value.targetLevelMin <= value.targetLevelMax, {
    message: "targetLevelMin must be less than or equal to targetLevelMax",
    path: ["targetLevelMax"],
  });

export const evaluateInput = z
  .object({
    text: z.string().max(100_000).optional(),
    url: z.string().max(2000).optional(),
  })
  .refine((value) => Boolean(value.text?.trim() || value.url?.trim()), {
    message: "Provide a job description or a URL",
  });

export const decisionInput = z.object({
  track: z.boolean(),
});

export const preferenceDecisionInput = z.object({
  continue: z.boolean(),
});

export const tailorInput = z.object({
  jobPostingId: z.string().min(1),
});

export const jobSort = z.enum([
  "score",
  "title",
  "requisitionId",
  "company",
  "worksite",
  "level",
]);
