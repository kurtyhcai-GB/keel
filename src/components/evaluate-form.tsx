"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import type { EvaluationDraft } from "@/lib/types";

type EvaluationResponse = EvaluationDraft & {
  postingId: string;
  evaluationId: string;
  status: string;
};

export function EvaluateForm() {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<EvaluationResponse | null>(null);
  const [decision, setDecision] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDecision(null);
    setPending(true);
    try {
      const body: { text?: string; url?: string } = {};
      if (url.trim()) body.url = url.trim();
      else body.text = text;
      const response = await api<EvaluationResponse>("/api/evaluate", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setResult(response);
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : "Evaluation failed");
    } finally {
      setPending(false);
    }
  }

  async function decide(track: boolean) {
    if (!result) return;
    setError(null);
    try {
      await api(`/api/evaluations/${result.evaluationId}/decision`, {
        method: "POST",
        body: JSON.stringify({ track }),
      });
      setDecision(track ? "Tracked. It is on the Tracked jobs page." : "Discarded.");
      if (!track) setResult(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save that choice");
    }
  }

  return (
    <div className="stack">
      <form onSubmit={onSubmit}>
        <label>
          Job description
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste a posting, or leave this blank and use the URL below."
          />
        </label>
        <label>
          Or a URL
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/jobs/123"
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Scoring…" : "Score this posting"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <section>
          <h2>
            {result.overallScore}% fit
            {result.title ? ` — ${result.title}` : ""}
          </h2>
          <p>{result.summary}</p>
          <p>
            Skills and experience: {result.skillsScore}%. Preferences:{" "}
            {result.preferencesScore == null ? "not set" : `${result.preferencesScore}%`}. Provider:{" "}
            {result.provider}
            {result.model ? ` (${result.model})` : ""}.
          </p>
          <p>
            {result.company || "Company unknown"} · {result.requisitionId || "No req id"} ·{" "}
            {result.location || "Location unknown"} / {result.worksite || "Worksite unknown"} ·{" "}
            {result.levelLabel || result.levelRaw || "Level unknown"}
          </p>
          <h3>Strengths</h3>
          <ul>
            {result.strengths.map((item) => (
              <li key={item.text}>{item.text}</li>
            ))}
          </ul>
          <h3>Gaps</h3>
          <ul>
            {result.gaps.map((item) => (
              <li key={item.text}>{item.text}</li>
            ))}
          </ul>
          <h3>Deal-breakers</h3>
          {result.dealBreakers.length === 0 ? <p>None from the saved preferences.</p> : null}
          <ul>
            {result.dealBreakers.map((item) => (
              <li key={item.text}>{item.text}</li>
            ))}
          </ul>
          {result.warnings.length ? (
            <>
              <h3>Notes</h3>
              <ul>
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p>Track this job? Untracked evaluations are deleted when you skip.</p>
          <button type="button" onClick={() => decide(true)}>
            Track it
          </button>{" "}
          <button type="button" onClick={() => decide(false)}>
            Skip
          </button>
        </section>
      ) : null}
      {decision ? <p>{decision}</p> : null}
    </div>
  );
}
