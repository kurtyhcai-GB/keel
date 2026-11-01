"use client";

import { useCallback, useEffect, useState, type DragEvent, type FormEvent } from "react";
import { TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/client-api";
import type { DocumentView, FactView, QuestionView } from "@/lib/types";
import { cn } from "@/lib/utils";

type UploadResponse =
  | { duplicate: true; existingDocument: DocumentView; filename: string }
  | {
      duplicate?: false;
      document: DocumentView;
      facts: FactView[];
      questionIds: string[];
      warnings: string[];
    };

type ExtractResponse = {
  facts: FactView[];
  questionIds: string[];
  warnings: string[];
};

export function BaselineView() {
  const [facts, setFacts] = useState<FactView[]>([]);
  const [questions, setQuestions] = useState<QuestionView[]>([]);
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    file: File;
    existingDocument: DocumentView;
  } | null>(null);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [baseline, docs] = await Promise.all([
      api<{ facts: FactView[]; questions: QuestionView[] }>("/api/baseline"),
      api<{ documents: DocumentView[] }>("/api/documents"),
    ]);
    setFacts(baseline.facts);
    setQuestions(baseline.questions);
    setDocuments(docs.documents);
    setError(null);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await reload();
      } catch (reason: unknown) {
        if (alive) setError(reason instanceof Error ? reason.message : "Could not load the baseline");
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  function applyExtractionResult(result: { warnings?: string[]; facts?: FactView[] }) {
    const warnings = result.warnings ?? [];
    setExtractionWarnings(warnings);
    if (warnings.length > 0) {
      toast.warning(warnings.length === 1 ? "Extraction finished with a warning" : "Extraction finished with warnings");
    } else if ((result.facts?.length ?? 0) > 0) {
      toast.success("New draft facts were added from extraction");
    }
  }

  async function postUpload(
    file: File,
    options?: { duplicateAction?: "replace" | "keep_both"; replaceDocumentId?: string },
  ) {
    const body = new FormData();
    body.set("file", file);
    if (options?.duplicateAction) body.set("duplicateAction", options.duplicateAction);
    if (options?.replaceDocumentId) body.set("replaceDocumentId", options.replaceDocumentId);
    return api<UploadResponse>("/api/documents", { method: "POST", body });
  }

  async function upload(files: File[]) {
    for (const file of files) {
      const result = await postUpload(file);
      if ("duplicate" in result && result.duplicate) {
        setPendingDuplicate({ file, existingDocument: result.existingDocument });
        return;
      }
      applyExtractionResult(result);
    }
    toast.success(files.length === 1 ? "Document stored" : `${files.length} documents stored`);
    await reload();
  }

  async function resolveDuplicate(action: "replace" | "keep_both") {
    if (!pendingDuplicate) return;
    const { file, existingDocument } = pendingDuplicate;
    setPendingDuplicate(null);
    const result = await postUpload(file, {
      duplicateAction: action,
      replaceDocumentId: action === "replace" ? existingDocument.id : undefined,
    });
    if ("duplicate" in result && result.duplicate) {
      toast.error("That file is still a duplicate of a stored document.");
      return;
    }
    applyExtractionResult(result);
    toast.success(action === "replace" ? "Document replaced and re-extracted" : "Second copy stored");
    await reload();
  }

  async function extractAgain(documentId: string) {
    setBusyDocumentId(documentId);
    try {
      const result = await api<ExtractResponse>(`/api/documents/${documentId}/extract`, { method: "POST" });
      applyExtractionResult(result);
      await reload();
    } finally {
      setBusyDocumentId(null);
    }
  }

  async function removeDocument(documentId: string) {
    setBusyDocumentId(documentId);
    try {
      await api(`/api/documents/${documentId}`, { method: "DELETE" });
      toast.success("Document removed. Accepted facts stay in your baseline.");
      await reload();
    } finally {
      setBusyDocumentId(null);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) void upload(files).catch((reason: unknown) => toast.error(String(reason)));
  }

  const open = questions.filter((question) => question.status === "open");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        step="Step 1 of 5"
        title="Baseline"
        description="Roles Keel cites when it scores a job. Conflicts stay as questions until you answer them. Nothing is merged in silence."
      />
      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
      {extractionWarnings.length > 0 ? (
        <div
          className="mb-4 rounded-xl border border-amber-300/80 bg-amber-50 p-4 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-50"
          role="alert"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert className="size-4 shrink-0" />
            Extraction notes
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
            {extractionWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setExtractionWarnings([])}>
            Dismiss
          </Button>
        </div>
      ) : null}
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-xl border border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-foreground bg-muted" : "border-border bg-card",
        )}
      >
        <Upload className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Drop a resume, LinkedIn export, or review packet</p>
        <p className="mt-1 text-sm text-muted-foreground">PDF, DOCX, or text. Stored only on this machine.</p>
        <label className="mt-4 inline-flex">
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.docx,.txt,.md,text/plain"
            multiple
            onChange={(event) => {
              const files = event.target.files ? Array.from(event.target.files) : [];
              if (files.length) void upload(files).catch((reason: unknown) => toast.error(String(reason)));
              event.target.value = "";
            }}
          />
          <span className="inline-flex h-8 cursor-pointer items-center rounded-lg border bg-background px-3 text-sm font-medium hover:bg-muted">
            Browse files
          </span>
        </label>
        {documents.length > 0 ? (
          <ul className="mt-6 space-y-2 text-left">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{document.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {Math.round(document.byteSize / 1024)} KB · uploaded {new Date(document.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyDocumentId === document.id}
                    onClick={() => {
                      void extractAgain(document.id).catch((reason: unknown) => toast.error(String(reason)));
                    }}
                  >
                    Extract again
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busyDocumentId === document.id}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Remove this stored file? Facts you already confirmed stay in the baseline; only the file link is removed.",
                        )
                      ) {
                        void removeDocument(document.id).catch((reason: unknown) => toast.error(String(reason)));
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <Dialog open={pendingDuplicate !== null} onOpenChange={(open) => !open && setPendingDuplicate(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>You already uploaded this file</DialogTitle>
            <DialogDescription>
              Keel recognized the same content as{" "}
              <span className="font-medium text-foreground">{pendingDuplicate?.existingDocument.filename}</span>. Replace
              updates that document and re-runs extraction. Keep both stores a second copy.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => void resolveDuplicate("keep_both")}>
              Keep both
            </Button>
            <Button type="button" onClick={() => void resolveDuplicate("replace")}>
              Replace existing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {open.map((question) => (
        <form
          key={question.id}
          className="mt-4 rounded-xl border border-amber-300/80 bg-amber-50 p-4 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-50"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void api(`/api/clarifications/${question.id}`, {
              method: "PATCH",
              body: JSON.stringify({ answer: String(data.get("answer") ?? ""), status: "answered" }),
            })
              .then(() => reload())
              .catch((reason: unknown) => toast.error(String(reason)));
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <TriangleAlert className="size-4 shrink-0" />
              Clarifying question
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-amber-950 hover:bg-amber-100/80 dark:text-amber-50"
              onClick={() => {
                void api(`/api/clarifications/${question.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ status: "dismissed" }),
                })
                  .then(() => reload())
                  .catch((reason: unknown) => toast.error(String(reason)));
              }}
            >
              Dismiss
            </Button>
          </div>
          <p className="mt-2 text-sm leading-6">{question.question}</p>
          {question.detail ? <p className="mt-1 text-sm leading-6 opacity-80">{question.detail}</p> : null}
          <textarea name="answer" required className="mt-3 min-h-16 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground" />
          <Button type="submit" className="mt-3" size="sm">
            Save answer
          </Button>
        </form>
      ))}

      <HandFact onSaved={() => void reload()} />

      <div className="mt-8 flex flex-col gap-4">
        {facts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No facts yet. Upload a document or add a role by hand. A sample is available from the sidebar.</p>
        ) : null}
        {facts.map((fact) => (
          <article key={fact.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">
                  {fact.title || "Untitled"} {fact.company ? `· ${fact.company}` : ""}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {fact.startDate || "?"} – {fact.endDate || "?"} · {fact.status}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void api(`/api/baseline/${fact.id}`, { method: "DELETE" }).then(() => reload());
                }}
              >
                Delete
              </Button>
            </div>
            <p className="mt-3 text-sm leading-6">{fact.summary}</p>
            {fact.skills.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">{fact.skills.join(" · ")}</p>
            ) : null}
            <p className="mt-3 text-xs leading-5 text-muted-foreground">Source: {fact.sourceExcerpt}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function HandFact({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await api("/api/baseline", {
      method: "POST",
      body: JSON.stringify({
        kind: "role",
        title: data.get("title"),
        company: data.get("company"),
        startDate: data.get("startDate"),
        endDate: data.get("endDate"),
        summary: data.get("summary"),
        skills: String(data.get("skills") ?? "")
          .split(",")
          .map((skill) => skill.trim())
          .filter(Boolean),
      }),
    });
    toast.success("Fact saved");
    event.currentTarget.reset();
    setOpen(false);
    onSaved();
  }
  if (!open) {
    return (
      <Button type="button" variant="outline" className="mt-4" onClick={() => setOpen(true)}>
        Add a role by hand
      </Button>
    );
  }
  return (
    <form onSubmit={(event) => void onSubmit(event)} className="mt-4 grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
      <input name="title" required placeholder="Title" className="rounded-lg border px-3 py-2 text-sm" />
      <input name="company" required placeholder="Company" className="rounded-lg border px-3 py-2 text-sm" />
      <div className="grid grid-cols-2 gap-3">
        <input name="startDate" placeholder="Start" className="rounded-lg border px-3 py-2 text-sm" />
        <input name="endDate" placeholder="End" className="rounded-lg border px-3 py-2 text-sm" />
      </div>
      <input name="skills" placeholder="Skills, comma separated" className="rounded-lg border px-3 py-2 text-sm" />
      <textarea name="summary" required placeholder="What the source actually says" className="min-h-20 rounded-lg border px-3 py-2 text-sm" />
      <div className="flex gap-2">
        <Button type="submit" size="sm">Save fact</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
