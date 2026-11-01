export type WorkMode = "remote" | "hybrid" | "onsite";

export type CitedFact = {
  id: string;
  title: string | null;
  company: string | null;
  startDate: string | null;
  endDate: string | null;
  summary: string;
  skills: string[];
  impact: string | null;
  sourceExcerpt: string;
};

export type FactView = CitedFact & {
  documentId: string | null;
  kind: string;
  location: string | null;
  sourceLocator: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentView = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  textPreview: string;
};

export type QuestionView = {
  id: string;
  factId: string | null;
  relatedFactIds: string[];
  question: string;
  detail: string | null;
  answer: string | null;
  status: string;
  createdAt: string;
};

export type PreferenceView = {
  locations: string[];
  workModes: WorkMode[];
  commuteToleranceMinutes: number | null;
  targetLevelMin: number;
  targetLevelMax: number;
  notes: string | null;
};

export type ScorePoint = {
  text: string;
  factIds: string[];
};

export type EvaluationDraft = {
  title: string | null;
  company: string | null;
  requisitionId: string | null;
  location: string | null;
  worksite: string | null;
  levelRaw: string | null;
  microsoftLevel: number | null;
  levelLabel: string | null;
  skillsScore: number;
  preferencesScore: number | null;
  overallScore: number;
  summary: string;
  strengths: ScorePoint[];
  gaps: ScorePoint[];
  dealBreakers: ScorePoint[];
  warnings: string[];
  provider: string;
  model: string | null;
};

export type TrackedJobView = {
  id: string;
  jobPostingId: string;
  evaluationId: string;
  score: number;
  skillsScore: number;
  preferencesScore: number | null;
  title: string | null;
  requisitionId: string | null;
  company: string | null;
  location: string | null;
  worksite: string | null;
  locationAndWorksite: string;
  level: string | null;
  microsoftLevel: number | null;
  summary: string;
  strengths: ScorePoint[];
  gaps: ScorePoint[];
  dealBreakers: ScorePoint[];
  warnings: string[];
  provider: string;
  createdAt: string;
};

export type PostingView = {
  id: string;
  status: string;
  title: string | null;
  company: string | null;
  requisitionId: string | null;
  locationAndWorksite: string;
  level: string | null;
  score: number | null;
  createdAt: string;
};

export type ResumeEdit = {
  factId: string | null;
  suggestion: string;
  sourceExcerpt: string | null;
};

export type TailorDraft = {
  id?: string;
  jobPostingId: string;
  resumeEdits: ResumeEdit[];
  coverLetter: string;
  warnings: string[];
  provider: string;
  model: string | null;
  createdAt?: string;
};

export function formatLocationAndWorksite(
  location: string | null,
  worksite: string | null,
): string {
  if (location && worksite) return `${location} / ${worksite}`;
  return location || worksite || "";
}
