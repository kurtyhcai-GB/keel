"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EvaluationView } from "@/components/evaluation-view";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";
import type { EvaluationDraft, PreferenceMismatch } from "@/lib/types";

type NeedsDecision = {
  status: "needs_decision";
  postingId: string;
  mismatches: PreferenceMismatch[];
  title: string | null;
  company: string | null;
  location: string | null;
  worksite: string | null;
  requisitionId: string | null;
};

type RuledOut = {
  status: "ruled_out";
  reason: string;
  mismatches: PreferenceMismatch[];
};

type Scored = EvaluationDraft & {
  status: "pending";
  postingId: string;
  evaluationId: string;
  rawText?: string;
};

const SAMPLE = `Senior Technical Program Manager
Company: Northwind Instruments
Location: Redmond, WA
Worksite: Hybrid, 3 days in office
Job ID: NW-18422
Level: L64

Requirements:
- Technical program management across several teams
- Cross-org execution
- Shipping on a schedule
- Azure
`;

export function EvaluateView() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "loading" | "pause" | "ruled-out" | "result">("idle");
  const [pause, setPause] = useState<NeedsDecision | null>(null);
  const [ruled, setRuled] = useState<RuledOut | null>(null);
  const [result, setResult] = useState<Scored | null>(null);
  const [weight, setWeight] = useState(65);
  const [preferencesSaved, setPreferencesSaved] = useState(false);
  const [deciding, setDeciding] = useState(false);

  function resetEvaluation() {
    setText("");
    setResult(null);
    setPause(null);
    setRuled(null);
    setPhase("idle");
  }

  async function run() {
    const trimmed = text.trim();
    if (!trimmed || phase === "loading") return;
    setPhase("loading");
    try {
      const prefs = await api<{ preferences: { skillsWeight: number } | null }>("/api/preferences");
      setWeight(prefs.preferences?.skillsWeight ?? 65);
      setPreferencesSaved(Boolean(prefs.preferences));
      const response = await api<NeedsDecision | Scored>("/api/evaluate", {
        method: "POST",
        body: JSON.stringify(trimmed.startsWith("http://") || trimmed.startsWith("https://") ? { url: trimmed } : { text: trimmed }),
      });
      if (response.status === "needs_decision") {
        setPause(response);
        setPhase("pause");
        return;
      }
      setResult({ ...response, rawText: trimmed });
      setPhase("result");
    } catch (error) {
      setPhase("idle");
      toast.error(error instanceof Error ? error.message : "Evaluation failed");
    }
  }

  async function resolve(continueEvaluation: boolean) {
    if (!pause) return;
    setPhase("loading");
    try {
      const response = await api<Scored | RuledOut>(`/api/postings/${pause.postingId}/preference-decision`, {
        method: "POST",
        body: JSON.stringify({ continue: continueEvaluation }),
      });
      if (response.status === "ruled_out") {
        setRuled(response);
        setPhase("ruled-out");
        return;
      }
      setResult({ ...response, rawText: text });
      setPhase("result");
    } catch (error) {
      setPhase("pause");
      toast.error(error instanceof Error ? error.message : "Could not save that choice");
    }
  }

  async function track(keep: boolean) {
    if (!result || deciding) return;
    setDeciding(true);
    try {
      await api(`/api/evaluations/${result.evaluationId}/decision`, {
        method: "POST",
        body: JSON.stringify({ track: keep }),
      });
      resetEvaluation();
      if (keep) {
        toast.success("Tracked", {
          action: {
            label: "Tracked Jobs",
            onClick: () => router.push("/tracked"),
          },
        });
      } else {
        toast.success("Skipped");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that choice");
    } finally {
      setDeciding(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        step="Step 3 of 5"
        title="Evaluate"
        description="Paste a description or a job URL. If the location or worksite conflicts with what you saved, Keel asks before it scores."
      />
      {phase === "idle" || phase === "loading" ? (
        <div>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste a job description, or a URL"
            className="min-h-56 text-sm leading-6"
            aria-label="Job description or URL"
          />
          <div className="mt-3">
            <button
              type="button"
              className="rounded-full px-2.5 py-1 text-xs ring-1 ring-foreground/10 hover:bg-muted"
              onClick={() => setText(SAMPLE)}
            >
              Load the Northwind sample
            </button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {text.trim() ? `${text.trim().length} characters` : "Waiting for a description"}
            </p>
            <Button type="button" disabled={!text.trim() || phase === "loading"} onClick={() => void run()}>
              Evaluate
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-6 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setPhase("idle");
              setResult(null);
              setPause(null);
            }}
          >
            Edit description
          </Button>
        </div>
      )}

      {phase === "loading" && (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Reading the posting against your baseline and preferences.
        </div>
      )}

      {phase === "pause" && pause && (
        <section className="rounded-xl border border-amber-300/80 bg-amber-50 p-5 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-50">
          <p className="text-sm text-amber-800 dark:text-amber-200">{pause.company || "Company not stated"}</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">{pause.title || "This role"}</h2>
          <p className="mt-2 text-sm">
            {pause.location || "Location unknown"} / {pause.worksite || "Worksite unknown"}
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6">
            {pause.mismatches.map((item) => (
              <li key={item.reason}>{item.reason}</li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void resolve(true)}>
              Keep evaluating
            </Button>
            <Button type="button" variant="outline" onClick={() => void resolve(false)}>
              Rule this role out
            </Button>
          </div>
        </section>
      )}

      {phase === "ruled-out" && ruled && (
        <section className="rounded-xl border border-dashed px-5 py-8">
          <h2 className="text-xl font-semibold">Ruled out</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{ruled.reason}</p>
          <p className="mt-2 text-sm text-muted-foreground">No score was saved, and the role is not tracked.</p>
          <Button type="button" className="mt-4" onClick={resetEvaluation}>
            Evaluate another role
          </Button>
        </section>
      )}

      {phase === "result" && result && (
        <div className="mt-6">
          <EvaluationView
            title={result.title || "Untitled role"}
            company={result.company || "Company unknown"}
            location={result.location || "Location unknown"}
            worksite={result.worksite || "Worksite unknown"}
            level={result.levelLabel || result.levelRaw || "Level unknown"}
            requisitionId={result.requisitionId || "No req id"}
            summary={result.summary}
            rawText={result.rawText}
            strengths={result.strengths}
            gaps={result.gaps}
            preferencesSaved={preferencesSaved}
            scored={{ ...result, skillsWeight: weight }}
            actions={
              <>
                <Button type="button" disabled={deciding} onClick={() => void track(true)}>
                  Track it
                </Button>
                <Button type="button" variant="outline" disabled={deciding} onClick={() => void track(false)}>
                  Skip
                </Button>
              </>
            }
          />
        </div>
      )}
    </div>
  );
}
