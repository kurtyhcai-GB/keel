"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import type { ResumeEdit, TailorAnswerView, TailorOutputView, TrackedJobView } from "@/lib/types";

type Target = "resume" | "coverLetter";
type LengthUnit = "characters" | "words";

type TailorResponse = {
  output: TailorOutputView;
  errors: { resume: string | null; coverLetter: string | null };
};

function SectionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-2 text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function lengthCount(text: string, unit: LengthUnit): number {
  return unit === "words" ? wordCount(text) : [...text].length;
}

function parseLimit(value: string): { limit: number | null; error: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { limit: null, error: null };
  const limit = Number(trimmed);
  if (!Number.isInteger(limit) || limit < 1) {
    return { limit: null, error: "Length limit must be a positive whole number." };
  }
  return { limit, error: null };
}

export function TailorView() {
  const router = useRouter();
  const [jobs, setJobs] = useState<TrackedJobView[]>([]);
  const [jobId, setJobId] = useState("");
  const [output, setOutput] = useState<TailorOutputView | null>(null);
  const [answers, setAnswers] = useState<TailorAnswerView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resumePending, setResumePending] = useState(false);
  const [coverPending, setCoverPending] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [limit, setLimit] = useState("");
  const [unit, setUnit] = useState<LengthUnit>("words");
  const [asking, setAsking] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const jobIdRef = useRef(jobId);

  useEffect(() => {
    jobIdRef.current = jobId;
  }, [jobId]);

  function selectJob(nextId: string) {
    jobIdRef.current = nextId;
    setJobId(nextId);
    setOutput(null);
    setAnswers([]);
    setLoaded(false);
    setLoadError(null);
    setResumeError(null);
    setCoverError(null);
    setQuestionError(null);
  }

  useEffect(() => {
    void api<{ jobs: TrackedJobView[] }>("/api/jobs").then((response) => {
      setJobs(response.jobs);
      const first = response.jobs[0];
      if (first) {
        jobIdRef.current = first.jobPostingId;
        setJobId(first.jobPostingId);
      }
    });
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    void Promise.all([
      api<{ output: TailorOutputView | null }>(`/api/tailor?jobPostingId=${encodeURIComponent(jobId)}`),
      api<{ answers: TailorAnswerView[] }>(`/api/tailor/answers?jobPostingId=${encodeURIComponent(jobId)}`),
    ])
      .then(([draft, saved]) => {
        if (cancelled) return;
        setOutput(draft.output);
        setAnswers(saved.answers);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setOutput(null);
        setAnswers([]);
        setLoaded(true);
        setLoadError(error instanceof Error ? error.message : "Could not load saved drafts");
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const job = jobs.find((item) => item.jobPostingId === jobId) ?? jobs[0];

  async function generate(targets: Target[]) {
    if (!job) return;
    const postingId = job.jobPostingId;
    if (targets.includes("resume")) {
      setResumePending(true);
      setResumeError(null);
    }
    if (targets.includes("coverLetter")) {
      setCoverPending(true);
      setCoverError(null);
    }
    try {
      const response = await api<TailorResponse>("/api/tailor", {
        method: "POST",
        body: JSON.stringify({ jobPostingId: postingId, targets }),
      });
      if (jobIdRef.current !== postingId) return;
      setOutput(response.output);
      if (targets.includes("resume")) setResumeError(response.errors.resume);
      if (targets.includes("coverLetter")) setCoverError(response.errors.coverLetter);
    } catch (error) {
      if (jobIdRef.current !== postingId) return;
      const message = error instanceof Error ? error.message : "Could not tailor";
      if (targets.includes("resume")) setResumeError(message);
      if (targets.includes("coverLetter")) setCoverError(message);
    } finally {
      if (targets.includes("resume")) setResumePending(false);
      if (targets.includes("coverLetter")) setCoverPending(false);
    }
  }

  async function askQuestion() {
    if (!job || asking) return;
    const postingId = job.jobPostingId;
    const trimmed = question.trim();
    if (!trimmed) {
      setQuestionError("Paste a question first.");
      return;
    }
    const parsed = parseLimit(limit);
    if (parsed.error) {
      setQuestionError(parsed.error);
      return;
    }
    setAsking(true);
    setQuestionError(null);
    try {
      const saved = await api<TailorAnswerView>("/api/tailor/answers", {
        method: "POST",
        body: JSON.stringify({
          jobPostingId: postingId,
          question: trimmed,
          lengthLimit: parsed.limit,
          lengthUnit: parsed.limit ? unit : null,
        }),
      });
      if (jobIdRef.current !== postingId) return;
      setAnswers((current) => [...current, saved]);
      setQuestion("");
    } catch (error) {
      if (jobIdRef.current !== postingId) return;
      setQuestionError(error instanceof Error ? error.message : "Could not answer that question");
    } finally {
      setAsking(false);
    }
  }

  function download() {
    if (!output?.hasCover) return;
    const blob = new Blob([output.coverLetter], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${job?.company ?? "cover"}-letter.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!job) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader
          step="Step 5 of 5"
          title="Tailor"
          description="Resume edits, a cover letter, and answers to application questions for one role you are actually pursuing."
        />
        <div className="rounded-xl border border-dashed px-6 py-16 text-center">
          <p className="text-sm font-medium">Track a role first</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Tailoring uses a job you decided to keep, and it will not invent experience.
          </p>
          <Button type="button" className="mt-4" onClick={() => router.push("/evaluate")}>
            Go to Evaluate
          </Button>
        </div>
      </div>
    );
  }

  const materialsBusy = resumePending || coverPending;

  return (
    <div>
      <PageHeader
        step="Step 5 of 5"
        title="Tailor"
        description="Resume edits, a cover letter, and application answers. Each document is generated on its own, and only from facts already in the baseline."
        action={
          <label className="text-sm">
            <span className="sr-only">Role</span>
            <select
              value={job.jobPostingId}
              onChange={(event) => selectJob(event.target.value)}
              className="rounded-lg border bg-background px-3 py-2"
            >
              {jobs.map((item) => (
                <option key={item.id} value={item.jobPostingId}>
                  {item.title} · {item.company}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {loadError ? (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {loadError}
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <Button type="button" onClick={() => void generate(["resume"])} disabled={!loaded || resumePending} aria-busy={resumePending}>
          {resumePending ? "Writing resume…" : "Generate resume"}
        </Button>
        <Button type="button" onClick={() => void generate(["coverLetter"])} disabled={!loaded || coverPending} aria-busy={coverPending}>
          {coverPending ? "Writing letter…" : "Generate cover letter"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void generate(["resume", "coverLetter"])}
          disabled={!loaded || materialsBusy}
          aria-busy={resumePending && coverPending}
        >
          {resumePending && coverPending ? "Writing…" : "Generate both"}
        </Button>
      </div>
      {!loaded ? <p className="mb-4 text-sm text-muted-foreground">Loading saved drafts…</p> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-medium">Resume edits</h2>
          <SectionError message={resumeError} />
          {output?.hasResume ? (
            <>
              <ul className="mt-3 flex flex-col gap-3">
                {output.resumeEdits.length === 0 ? (
                  <li className="rounded-xl p-3 text-sm text-muted-foreground ring-1 ring-foreground/10">
                    No resume edits were suggested.
                  </li>
                ) : (
                  output.resumeEdits.map((edit) => <ResumeEditCard key={edit.suggestion} edit={edit} />)
                )}
              </ul>
              {output.resumeWarnings.map((warning) => (
                <p key={warning} className="mt-2 text-xs text-muted-foreground">
                  {warning}
                </p>
              ))}
              {output.resumeProvider ? (
                <p className="mt-2 text-xs text-muted-foreground">Provider: {output.resumeProvider}</p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No resume edits yet. Generate a resume when you want them.</p>
          )}
        </section>
        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Cover letter</h2>
            {output?.hasCover ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(output.coverLetter);
                    toast.success("Copied");
                  }}
                >
                  Copy
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={download}>
                  Download
                </Button>
              </div>
            ) : null}
          </div>
          <SectionError message={coverError} />
          {output?.hasCover ? (
            <>
              <pre className="mt-3 rounded-xl bg-muted/40 p-4 font-serif text-sm leading-7 whitespace-pre-wrap">{output.coverLetter}</pre>
              {output.coverWarnings.map((warning) => (
                <p key={warning} className="mt-2 text-xs text-muted-foreground">
                  {warning}
                </p>
              ))}
              {output.coverProvider ? (
                <p className="mt-2 text-xs text-muted-foreground">Provider: {output.coverProvider}</p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No cover letter yet. Generate one when you want it.</p>
          )}
        </section>
      </div>
      <section className="mt-8 border-t pt-6">
        <h2 className="text-sm font-medium">Application questions</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Paste a question from the application, such as why you want the role. The answer uses your baseline and this
          posting, including the company named there, and does not add experience that is not in the baseline.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What makes you want to work for us?"
            aria-label="Application question"
          />
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Length limit (optional)</span>
              <Input
                type="number"
                min={1}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                className="w-28"
                aria-label="Length limit"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Unit</span>
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value === "characters" ? "characters" : "words")}
                className="h-8 rounded-lg border bg-background px-2.5 text-sm"
                aria-label="Length unit"
              >
                <option value="words">words</option>
                <option value="characters">characters</option>
              </select>
            </label>
            <Button type="button" onClick={() => void askQuestion()} disabled={!loaded || asking || !question.trim()} aria-busy={asking}>
              {asking ? "Writing answer…" : "Generate"}
            </Button>
          </div>
          <SectionError message={questionError} />
        </div>
        <div className="mt-6 flex flex-col gap-4">
          {answers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No application answers for this role yet.</p>
          ) : (
            answers.map((answer) => (
              <AnswerCard
                key={`${answer.id}:${answer.updatedAt}`}
                answer={answer}
                onReplace={(next) => {
                  if (jobIdRef.current !== next.jobPostingId) return;
                  setAnswers((current) => current.map((item) => (item.id === next.id ? next : item)));
                }}
                onDelete={(id) => setAnswers((current) => current.filter((item) => item.id !== id))}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ResumeEditCard({ edit }: { edit: ResumeEdit }) {
  return (
    <li className="rounded-xl p-3 text-sm leading-6 ring-1 ring-foreground/10">
      {edit.suggestion}
      {edit.sourceExcerpt ? <p className="mt-2 text-xs text-muted-foreground">Source: {edit.sourceExcerpt}</p> : null}
    </li>
  );
}

function AnswerCard({
  answer,
  onReplace,
  onDelete,
}: {
  answer: TailorAnswerView;
  onReplace: (next: TailorAnswerView) => void;
  onDelete: (id: string) => void;
}) {
  const [question, setQuestion] = useState(answer.question);
  const [answerText, setAnswerText] = useState(answer.answer);
  const [limit, setLimit] = useState(answer.lengthLimit?.toString() ?? "");
  const [unit, setUnit] = useState<LengthUnit>(answer.lengthUnit ?? "words");
  const [pending, setPending] = useState<"save" | "regenerate" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseLimit(limit);
  const count = parsed.limit ? lengthCount(answerText, unit) : null;

  function fields() {
    const trimmed = question.trim();
    if (!trimmed) {
      setError("The question cannot be empty.");
      return null;
    }
    const next = parseLimit(limit);
    if (next.error) {
      setError(next.error);
      return null;
    }
    return {
      question: trimmed,
      lengthLimit: next.limit,
      lengthUnit: next.limit ? unit : null,
    };
  }

  async function save() {
    const payload = fields();
    if (!payload || pending) return;
    setPending("save");
    setError(null);
    try {
      const saved = await api<TailorAnswerView>(`/api/tailor/answers/${answer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...payload, answer: answerText }),
      });
      onReplace(saved);
      toast.success("Saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save");
    } finally {
      setPending(null);
    }
  }

  async function regenerate() {
    const payload = fields();
    if (!payload || pending) return;
    setPending("regenerate");
    setError(null);
    try {
      const saved = await api<TailorAnswerView>(`/api/tailor/answers/${answer.id}/generate`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onReplace(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not regenerate");
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (pending) return;
    setPending("delete");
    setError(null);
    try {
      await api<{ deleted: boolean }>(`/api/tailor/answers/${answer.id}`, { method: "DELETE" });
      onDelete(answer.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete");
      setPending(null);
    }
  }

  return (
    <article className="rounded-xl p-4 ring-1 ring-foreground/10">
      <Textarea value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Saved question" />
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Length limit</span>
          <Input
            type="number"
            min={1}
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            className="w-28"
            aria-label="Saved length limit"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Unit</span>
          <select
            value={unit}
            onChange={(event) => setUnit(event.target.value === "characters" ? "characters" : "words")}
            className="h-8 rounded-lg border bg-background px-2.5 text-sm"
            aria-label="Saved length unit"
          >
            <option value="words">words</option>
            <option value="characters">characters</option>
          </select>
        </label>
        <Button type="button" variant="outline" size="sm" onClick={() => void save()} disabled={pending != null}>
          {pending === "save" ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" onClick={() => void regenerate()} disabled={pending != null} aria-busy={pending === "regenerate"}>
          {pending === "regenerate" ? "Writing answer…" : "Regenerate"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(answerText);
            toast.success("Copied");
          }}
        >
          Copy
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void remove()} disabled={pending != null}>
          {pending === "delete" ? "Deleting…" : "Delete"}
        </Button>
      </div>
      <Textarea
        value={answerText}
        onChange={(event) => setAnswerText(event.target.value)}
        className="mt-3 min-h-28"
        aria-label="Answer"
      />
      {count != null && parsed.limit ? (
        <p className={`mt-2 text-xs ${count > parsed.limit ? "text-destructive" : "text-muted-foreground"}`}>
          {count} / {parsed.limit} {unit}
        </p>
      ) : null}
      {answer.warnings.map((warning) => (
        <p key={warning} className="mt-2 text-xs text-muted-foreground">
          {warning}
        </p>
      ))}
      {answer.provider ? <p className="mt-2 text-xs text-muted-foreground">Provider: {answer.provider}</p> : null}
      <SectionError message={error} />
    </article>
  );
}
