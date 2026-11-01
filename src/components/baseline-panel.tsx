"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import type { DocumentView, FactView, QuestionView } from "@/lib/types";

type BaselineResponse = { facts: FactView[]; questions: QuestionView[] };
type DocumentResponse = { documents: DocumentView[] };

export function BaselinePanel() {
  const [facts, setFacts] = useState<FactView[]>([]);
  const [questions, setQuestions] = useState<QuestionView[]>([]);
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [skills, setSkills] = useState("");

  const reload = useCallback(async () => {
    const [baseline, docs] = await Promise.all([
      api<BaselineResponse>("/api/baseline"),
      api<DocumentResponse>("/api/documents"),
    ]);
    setError(null);
    setFacts(baseline.facts);
    setQuestions(baseline.questions);
    setDocuments(docs.documents);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await reload();
      } catch (reason: unknown) {
        if (alive) setError(reason instanceof Error ? reason.message : "Could not load");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    try {
      await api("/api/documents", { method: "POST", body: data });
      event.currentTarget.reset();
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed");
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api("/api/baseline", {
        method: "POST",
        body: JSON.stringify({
          kind: "role",
          title,
          company,
          startDate,
          endDate,
          summary,
          skills: skills
            .split(",")
            .map((skill) => skill.trim())
            .filter(Boolean),
        }),
      });
      setSummary("");
      setTitle("");
      setCompany("");
      setStartDate("");
      setEndDate("");
      setSkills("");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the fact");
    }
  }

  async function onDelete(id: string) {
    setError(null);
    try {
      await api(`/api/baseline/${id}`, { method: "DELETE" });
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete");
    }
  }

  async function onAnswer(id: string, answer: string) {
    setError(null);
    try {
      await api(`/api/clarifications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ answer, status: "answered" }),
      });
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the answer");
    }
  }

  if (loading) return <p>Loading baseline…</p>;

  return (
    <div className="stack">
      {error ? <p role="alert">{error}</p> : null}
      <form onSubmit={onUpload}>
        <label>
          Resume or notes (PDF, DOCX, or text)
          <input name="file" type="file" accept=".pdf,.docx,.txt,.md,text/plain" required />
        </label>
        <button type="submit">Upload</button>
      </form>
      {documents.length === 0 ? <p>No documents yet.</p> : null}
      <ul>
        {documents.map((document) => (
          <li key={document.id}>
            {document.filename}{" "}
            <button
              type="button"
              onClick={() => {
                api(`/api/documents/${document.id}/extract`, { method: "POST" })
                  .then(() => reload())
                  .catch((reason: unknown) =>
                    setError(reason instanceof Error ? reason.message : "Extract failed"),
                  );
              }}
            >
              Extract again
            </button>
          </li>
        ))}
      </ul>
      <h2>Add a fact by hand</h2>
      <form onSubmit={onCreate}>
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label>
          Company
          <input value={company} onChange={(event) => setCompany(event.target.value)} required />
        </label>
        <label>
          Start
          <input value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>
          End
          <input value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <label>
          Skills, comma separated
          <input value={skills} onChange={(event) => setSkills(event.target.value)} />
        </label>
        <label>
          Summary
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required />
        </label>
        <button type="submit">Save fact</button>
      </form>
      <h2>Facts</h2>
      {facts.length === 0 ? <p>No facts yet. Upload a document or add one by hand.</p> : null}
      {facts.map((fact) => (
        <article key={fact.id}>
          <h3>
            {fact.title || "Untitled"} {fact.company ? `at ${fact.company}` : ""}{" "}
            <small>({fact.status})</small>
          </h3>
          <p>
            {fact.startDate || "?"} – {fact.endDate || "?"}
          </p>
          <p>{fact.summary}</p>
          {fact.skills.length ? <p>Skills: {fact.skills.join(", ")}</p> : null}
          <p>
            <small>Source: {fact.sourceExcerpt}</small>
          </p>
          <button type="button" onClick={() => onDelete(fact.id)}>
            Delete
          </button>
        </article>
      ))}
      <h2>Clarifying questions</h2>
      {questions.filter((question) => question.status === "open").length === 0 ? (
        <p>No open questions.</p>
      ) : null}
      {questions
        .filter((question) => question.status === "open")
        .map((question) => (
          <QuestionForm key={question.id} question={question} onAnswer={onAnswer} />
        ))}
    </div>
  );
}

function QuestionForm({
  question,
  onAnswer,
}: {
  question: QuestionView;
  onAnswer: (id: string, answer: string) => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onAnswer(question.id, answer);
      }}
    >
      <p>{question.question}</p>
      {question.detail ? <p>{question.detail}</p> : null}
      <label>
        Your answer
        <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} required />
      </label>
      <button type="submit">Save answer</button>
    </form>
  );
}
