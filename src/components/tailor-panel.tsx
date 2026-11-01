"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import type { PostingView, TailorDraft } from "@/lib/types";

export function TailorPanel() {
  const [postings, setPostings] = useState<PostingView[]>([]);
  const [jobPostingId, setJobPostingId] = useState("");
  const [draft, setDraft] = useState<TailorDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<{ postings: PostingView[] }>("/api/postings")
      .then((response) => {
        setPostings(response.postings);
        const first = response.postings[0];
        if (first) setJobPostingId(first.id);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load"))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await api<TailorDraft>("/api/tailor", {
        method: "POST",
        body: JSON.stringify({ jobPostingId }),
      });
      setDraft(response);
    } catch (reason) {
      setDraft(null);
      setError(reason instanceof Error ? reason.message : "Could not tailor");
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
    link.download = "cover-letter.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <p>Loading postings…</p>;

  return (
    <div className="stack">
      {error ? <p role="alert">{error}</p> : null}
      {postings.length === 0 ? <p>Evaluate a posting first. Tailor uses a tracked or pending job.</p> : null}
      <form onSubmit={onSubmit}>
        <label>
          Job
          <select value={jobPostingId} onChange={(event) => setJobPostingId(event.target.value)} required>
            <option value="">Choose a posting</option>
            {postings.map((posting) => (
              <option key={posting.id} value={posting.id}>
                {(posting.title || "Untitled") + (posting.company ? ` — ${posting.company}` : "")} ({posting.status})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending || !jobPostingId}>
          {pending ? "Writing…" : "Draft edits and a letter"}
        </button>
      </form>
      {draft ? (
        <section>
          <p>
            Provider: {draft.provider}
            {draft.model ? ` (${draft.model})` : ""}. Limited to facts in the baseline.
          </p>
          <h2>Resume edits</h2>
          <ul>
            {draft.resumeEdits.map((edit) => (
              <li key={`${edit.factId ?? "gap"}-${edit.suggestion}`}>
                {edit.suggestion}
                {edit.sourceExcerpt ? <small> Source: {edit.sourceExcerpt}</small> : null}
              </li>
            ))}
          </ul>
          <h2>Cover letter</h2>
          <pre>{draft.coverLetter}</pre>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(draft.coverLetter);
            }}
          >
            Copy letter
          </button>{" "}
          <button type="button" onClick={download}>
            Download letter
          </button>
          {draft.warnings.length ? (
            <ul>
              {draft.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
