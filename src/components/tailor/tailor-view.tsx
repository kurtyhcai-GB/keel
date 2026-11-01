"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type { ResumeEdit, TrackedJobView } from "@/lib/types";

type Draft = {
  resumeEdits: ResumeEdit[];
  coverLetter: string;
  warnings: string[];
  provider: string;
};

export function TailorView() {
  const router = useRouter();
  const [jobs, setJobs] = useState<TrackedJobView[]>([]);
  const [jobId, setJobId] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api<{ jobs: TrackedJobView[] }>("/api/jobs").then((response) => {
      setJobs(response.jobs);
      const first = response.jobs[0];
      if (first) setJobId(first.jobPostingId);
    });
  }, []);

  const job = jobs.find((item) => item.jobPostingId === jobId) ?? jobs[0];

  if (!job) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader step="Step 5 of 5" title="Tailor" description="Resume edits and a cover letter for one role you are actually pursuing." />
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

  async function generate() {
    if (!job) return;
    setPending(true);
    try {
      const response = await api<Draft>("/api/tailor", {
        method: "POST",
        body: JSON.stringify({ jobPostingId: job.jobPostingId }),
      });
      setDraft(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not tailor");
    } finally {
      setPending(false);
    }
  }

  function download() {
    if (!draft) return;
    const blob = new Blob([draft.coverLetter], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${job?.company ?? "cover"}-letter.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        step="Step 5 of 5"
        title="Tailor"
        description="Suggestions and a letter limited to facts already in the baseline."
        action={
          <label className="text-sm">
            <span className="sr-only">Role</span>
            <select
              value={job.jobPostingId}
              onChange={(event) => {
                setJobId(event.target.value);
                setDraft(null);
              }}
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
      <div className="mb-4">
        <Button type="button" onClick={() => void generate()} disabled={pending}>
          {pending ? "Writing…" : draft ? "Regenerate" : "Draft from the baseline"}
        </Button>
      </div>
      {draft ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="text-sm font-medium">Resume edits</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {draft.resumeEdits.map((edit) => (
                <li key={edit.suggestion} className="rounded-xl p-3 text-sm leading-6 ring-1 ring-foreground/10">
                  {edit.suggestion}
                  {edit.sourceExcerpt ? (
                    <p className="mt-2 text-xs text-muted-foreground">Source: {edit.sourceExcerpt}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">Cover letter</h2>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(draft.coverLetter);
                    toast.success("Copied");
                  }}
                >
                  Copy
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={download}>
                  Download
                </Button>
              </div>
            </div>
            <pre className="mt-3 rounded-xl bg-muted/40 p-4 font-serif text-sm leading-7 whitespace-pre-wrap">{draft.coverLetter}</pre>
            {draft.warnings.map((warning) => (
              <p key={warning} className="mt-2 text-xs text-muted-foreground">{warning}</p>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">Provider: {draft.provider}</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
