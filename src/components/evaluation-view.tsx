"use client";

import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Meter, ScoreRing } from "@/components/score-ring";
import { fitLabel, scoreTextClass } from "@/lib/score-style";
import type { EvaluationDraft, ScorePoint } from "@/lib/types";
import { cn } from "@/lib/utils";

export function EvaluationView({
  title,
  company,
  location,
  worksite,
  level,
  pay,
  requisitionId,
  summary,
  scored,
  rawText,
  strengths,
  gaps,
  preferencesSaved,
  actions,
}: {
  title: string;
  company: string;
  location: string;
  worksite: string;
  level: string;
  pay?: string | null;
  requisitionId: string;
  summary: string;
  scored: Pick<
    EvaluationDraft,
    | "overallScore"
    | "skillsScore"
    | "preferencesScore"
    | "preferenceParts"
    | "mismatches"
    | "dealBreakers"
    | "warnings"
  > & { skillsWeight: number };
  rawText?: string;
  strengths: ScorePoint[];
  gaps: ScorePoint[];
  preferencesSaved: boolean;
  actions?: ReactNode;
}) {
  const preferencesWeight = 100 - scored.skillsWeight;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{company}</p>
          <h2 className="mt-0.5 text-xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {location} / {worksite}
            <span className="px-1.5 text-border">·</span>
            {level}
            {pay ? (
              <>
                <span className="px-1.5 text-border">·</span>
                {pay}
              </>
            ) : null}
            <span className="px-1.5 text-border">·</span>
            {requisitionId}
          </p>
        </div>
        {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
      </div>

      <div className="flex flex-col gap-5 rounded-xl bg-muted/40 p-4 sm:flex-row sm:items-center">
        <ScoreRing score={scored.overallScore} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium", scoreTextClass(scored.overallScore))}>
            {fitLabel(scored.overallScore)}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{summary}</p>
          <div className="mt-4 grid gap-3">
            <ScoreRow label="Skills and experience" weight={scored.skillsWeight} value={scored.skillsScore} />
            <ScoreRow
              label="Preferences"
              weight={preferencesWeight}
              value={scored.preferencesScore ?? scored.skillsScore}
            />
          </div>
        </div>
      </div>

      {scored.preferenceParts.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {scored.preferenceParts.map((part) => (
            <div key={part.id} className="rounded-lg px-3 py-2 ring-1 ring-foreground/10">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{part.label}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {part.mismatch ? "Mismatch" : part.included ? `${part.score}` : "n/a"}
                </p>
              </div>
              <p className="mt-1 text-sm leading-5">{part.detail}</p>
            </div>
          ))}
        </div>
      )}

      {scored.mismatches.length > 0 && (
        <section className="rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-50">
          <p className="text-sm font-medium">Kept with a mismatch. This does not change the score.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
            {scored.mismatches.map((item) => (
              <li key={item.reason}>{item.reason}</li>
            ))}
          </ul>
        </section>
      )}

      {scored.dealBreakers.length > 0 ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-950 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-50">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert className="size-4" />
            {scored.dealBreakers.length === 1 ? "1 deal-breaker" : `${scored.dealBreakers.length} deal-breakers`}
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
            {scored.dealBreakers.map((item) => (
              <li key={item.text}>{item.text}</li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">No deal-breakers against the current preferences.</p>
      )}

      {!preferencesSaved && (
        <p className="text-sm text-muted-foreground">
          Save preferences if you want this level range and commute tolerance to stick.
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <FindingColumn title="Strengths" items={strengths} />
        <FindingColumn title="Gaps" items={gaps} />
      </div>

      {rawText ? (
        <details className="group rounded-xl ring-1 ring-foreground/10">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">
            Job description used for this result
          </summary>
          <pre className="px-4 pb-4 font-sans text-sm leading-6 whitespace-pre-wrap text-muted-foreground">{rawText}</pre>
        </details>
      ) : null}

      <p className="text-xs leading-5 text-muted-foreground">
        Overall fit is {scored.skillsWeight}% skills and {preferencesWeight}% preferences, then minus 6 points per
        deal-breaker. A kept location or worksite mismatch is shown and not penalized. A level one step outside your
        range is a stretch. Two or more steps, or a Seattle-area commute over your tolerance, is a deal-breaker.
      </p>
    </div>
  );
}

function ScoreRow({ label, weight, value }: { label: string; weight: number; value: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_auto_1fr_auto] items-center gap-3">
      <span className="text-sm">{label}</span>
      <span className="w-10 text-xs tabular-nums text-muted-foreground">{weight}%</span>
      <Meter value={value} />
      <span className={cn("w-8 text-right text-sm tabular-nums", scoreTextClass(value))}>{value}</span>
    </div>
  );
}

function FindingColumn({ title, items }: { title: string; items: ScorePoint[] }) {
  return (
    <section>
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">None recorded.</p> : null}
      <ul className="mt-3 flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.text} className="text-sm leading-6">
            <p>{item.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
