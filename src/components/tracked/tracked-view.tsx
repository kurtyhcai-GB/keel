"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EvaluationView } from "@/components/evaluation-view";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/client-api";
import { scoreChipClass } from "@/lib/score-style";
import type { TrackedJobView } from "@/lib/types";
import { cn } from "@/lib/utils";

type SortKey = "score" | "title" | "requisitionId" | "company" | "worksite" | "level";

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "score", label: "Score", className: "w-28" },
  { key: "title", label: "Role title" },
  { key: "requisitionId", label: "Requisition ID / Job ID", className: "w-44" },
  { key: "company", label: "Company", className: "w-36" },
  { key: "worksite", label: "Location & worksite" },
  { key: "level", label: "Level", className: "w-56" },
];

export function TrackedView() {
  const [jobs, setJobs] = useState<TrackedJobView[]>([]);
  const [weight, setWeight] = useState(65);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<TrackedJobView | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api<{ jobs: TrackedJobView[] }>(`/api/jobs?sort=${sortKey}&dir=${direction}`),
      api<{ preferences: { skillsWeight: number } | null }>("/api/preferences"),
    ]).then(([list, prefs]) => {
      if (!alive) return;
      setJobs(list.jobs);
      setWeight(prefs.preferences?.skillsWeight ?? 65);
    });
    return () => {
      alive = false;
    };
  }, [sortKey, direction]);

  const rows = useMemo(() => jobs, [jobs]);
  const open = rows.find((job) => job.id === openId) ?? null;

  async function confirmDelete() {
    if (!pending || deleting) return;
    const target = pending;
    setDeleting(true);
    try {
      await api(`/api/jobs/${target.jobPostingId}`, { method: "DELETE" });
      setJobs((current) => current.filter((job) => job.id !== target.id));
      if (openId === target.id) setOpenId(null);
      setPending(null);
    } catch (reason: unknown) {
      toast.error(reason instanceof Error ? reason.message : "Could not delete this job.");
    } finally {
      setDeleting(false);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setDirection(key === "score" || key === "level" ? "desc" : "asc");
  }

  return (
    <div>
      <PageHeader
        step="Step 4 of 5"
        title="Tracked jobs"
        description="Roles you decided to pursue. The score uses the weight saved in Preferences, including a change you just made."
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tracked jobs yet. Evaluate a posting and choose Track it.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th key={column.key} className={cn("border-b px-2 py-2 text-left font-medium", column.className)}>
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort(column.key)}>
                      {column.label}
                      {sortKey === column.key ? (
                        direction === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3 text-muted-foreground" />
                      )}
                    </button>
                  </th>
                ))}
                <th className="w-28 border-b px-2 py-2 text-left font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((job) => (
                <tr key={job.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpenId(job.id)}>
                  <td className="border-b px-2 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium ring-1", scoreChipClass(job.score))}>
                      {job.score}
                    </span>
                  </td>
                  <td className="border-b px-2 py-3 font-medium">
                    <div>{job.title || "Untitled"}</div>
                    {job.payLabel ? <div className="mt-0.5 text-xs font-normal text-muted-foreground">{job.payLabel}</div> : null}
                  </td>
                  <td className="border-b px-2 py-3 text-muted-foreground">{job.requisitionId || "—"}</td>
                  <td className="border-b px-2 py-3">{job.company || "—"}</td>
                  <td className="border-b px-2 py-3">{job.locationAndWorksite || "—"}</td>
                  <td className="border-b px-2 py-3">{job.level || "—"}</td>
                  <td className="border-b px-2 py-3">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      aria-label={`Delete ${job.title || "Untitled"} at ${job.company || "unknown company"}`}
                      disabled={deleting && pending?.id === job.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPending(job);
                      }}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={open !== null} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle>{open.title || "Evaluation"}</SheetTitle>
                <SheetDescription>{open.company}</SheetDescription>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="mt-2 w-fit"
                  aria-label={`Delete ${open.title || "Untitled"} at ${open.company || "unknown company"}`}
                  disabled={deleting && pending?.id === open.id}
                  onClick={() => setPending(open)}
                >
                  <Trash2 />
                  Delete
                </Button>
              </SheetHeader>
              <div className="px-4 pb-6">
                <EvaluationView
                  title={open.title || "Untitled"}
                  company={open.company || "Company unknown"}
                  location={open.location || "Location unknown"}
                  worksite={open.worksite || "Worksite unknown"}
                  level={open.level || "Level unknown"}
                  pay={open.payLabel}
                  requisitionId={open.requisitionId || "No req id"}
                  summary={open.summary}
                  strengths={open.strengths}
                  gaps={open.gaps}
                  preferencesSaved
                  scored={{
                    overallScore: open.score,
                    skillsScore: open.skillsScore,
                    preferencesScore: open.preferencesScore,
                    preferenceParts: open.preferenceParts,
                    mismatches: open.mismatches,
                    dealBreakers: open.dealBreakers,
                    warnings: open.warnings,
                    skillsWeight: weight,
                  }}
                />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={pending !== null} onOpenChange={(next) => !next && !deleting && setPending(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              Delete {pending?.title || "Untitled"} at {pending?.company || "unknown company"}?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes the posting and everything linked to it: evaluations, tailored resumes and
              cover letters, saved application answers, notes, and status. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={deleting} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              <Trash2 />
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
