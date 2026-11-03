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
  /// Percent of overall fit that comes from skills. Preferences get the rest.
  skillsWeight: number;
  notes: string | null;
};

export type PreferenceMismatch = {
  kind: "location" | "worksite";
  reason: string;
};

export type ScorePoint = {
  text: string;
  factIds: string[];
};

export type PreferencePartView = {
  id: "location" | "worksite" | "level" | "commute";
  label: string;
  score: number;
  detail: string;
  included: boolean;
  mismatch?: boolean;
};

export type EvaluationDraft = {
  title: string | null;
  company: string | null;
  requisitionId: string | null;
  location: string | null;
  worksite: string | null;
  levelRaw: string | null;
  microsoftLevel: number | null;
  microsoftLevelMin?: number | null;
  microsoftLevelMax?: number | null;
  levelLabel: string | null;
  payMin: number | null;
  payMax: number | null;
  payCurrency: string | null;
  payPeriod: string | null;
  payRaw: string | null;
  payRanges: Array<{
    min: number;
    max: number;
    currency: string;
    period: string;
    kind: string | null;
    scope: string;
    label: string;
  }> | null;
  levelFromPay?: boolean;
  payNote?: string | null;
  confidence?: "high" | "medium" | "low" | null;
  skillsScore: number;
  preferencesScore: number | null;
  overallScore: number;
  summary: string;
  strengths: ScorePoint[];
  gaps: ScorePoint[];
  dealBreakers: ScorePoint[];
  preferenceParts: PreferencePartView[];
  warnings: string[];
  mismatches: PreferenceMismatch[];
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
  payLabel: string | null;
  summary: string;
  strengths: ScorePoint[];
  gaps: ScorePoint[];
  dealBreakers: ScorePoint[];
  preferenceParts: PreferencePartView[];
  warnings: string[];
  mismatches: PreferenceMismatch[];
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

export type TailorOutputView = {
  id: string;
  jobPostingId: string;
  createdAt: string;
  resumeEdits: ResumeEdit[];
  coverLetter: string;
  warnings: string[];
  resumeWarnings: string[];
  coverWarnings: string[];
  provider: string;
  model: string | null;
  resumeProvider: string | null;
  coverProvider: string | null;
  hasResume: boolean;
  hasCover: boolean;
};

export type TailorAnswerView = {
  id: string;
  jobPostingId: string;
  question: string;
  lengthLimit: number | null;
  lengthUnit: "characters" | "words" | null;
  answer: string;
  warnings: string[];
  provider: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
};

export function formatLocationAndWorksite(
  location: string | null,
  worksite: string | null,
): string {
  if (location && worksite) return `${location} / ${worksite}`;
  return location || worksite || "";
}
