"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client-api";

type Confidence = "high" | "medium" | "low";
type Origin = "researched" | "edited" | "added";

type LevelRow = {
  id: string;
  company: string;
  companyLevel: string;
  companyTitle?: string;
  displayLabel: string;
  confidence: Confidence;
  microsoftLevelMin: number;
  microsoftLevelMax: number;
  notes: string;
  source: string;
  origin: Origin;
};

type LevelMapResponse = {
  disclaimer: string;
  entries: LevelRow[];
  removed?: LevelRow[];
};

type Draft = {
  company: string;
  companyLevel: string;
  companyTitle: string;
  microsoftLevelMin: string;
  microsoftLevelMax: string;
  confidence: Confidence;
  notes: string;
};

type Editor =
  | { mode: "edit"; row: LevelRow; draft: Draft }
  | { mode: "add"; draft: Draft }
  | null;

const selectClass = "h-8 rounded-lg border bg-background px-2.5 text-sm";

function bandKey(row: Pick<LevelRow, "microsoftLevelMin" | "microsoftLevelMax">): string {
  return row.microsoftLevelMin === row.microsoftLevelMax
    ? String(row.microsoftLevelMin)
    : `${row.microsoftLevelMin}-${row.microsoftLevelMax}`;
}

function bandLabel(row: Pick<LevelRow, "microsoftLevelMin" | "microsoftLevelMax">): string {
  return row.microsoftLevelMin === row.microsoftLevelMax
    ? `L${row.microsoftLevelMin}`
    : `L${row.microsoftLevelMin}–${row.microsoftLevelMax}`;
}

function sourceLabel(source: string): string {
  if (!source.startsWith("http")) return source;
  try {
    return new URL(source).host.replace(/^www\./, "");
  } catch {
    return source;
  }
}

function draftFromRow(row: LevelRow): Draft {
  return {
    company: row.company,
    companyLevel: row.companyLevel,
    companyTitle: row.companyTitle ?? "",
    microsoftLevelMin: String(row.microsoftLevelMin),
    microsoftLevelMax: String(row.microsoftLevelMax),
    confidence: row.confidence,
    notes: row.notes,
  };
}

function emptyDraft(): Draft {
  return {
    company: "",
    companyLevel: "",
    companyTitle: "",
    microsoftLevelMin: "63",
    microsoftLevelMax: "65",
    confidence: "low",
    notes: "",
  };
}

export function LevelMapView() {
  const [entries, setEntries] = useState<LevelRow[]>([]);
  const [removed, setRemoved] = useState<LevelRow[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState("all");
  const [band, setBand] = useState("all");
  const [confidence, setConfidence] = useState("all");
  const [sort, setSort] = useState<"company" | "band">("company");
  const [editor, setEditor] = useState<Editor>(null);
  const [pendingDelete, setPendingDelete] = useState<LevelRow | null>(null);
  const [saving, setSaving] = useState(false);

  function applyMap(map: LevelMapResponse) {
    setDisclaimer(map.disclaimer);
    setEntries(map.entries);
    setRemoved(map.removed ?? []);
    setLoaded(true);
  }

  async function reload(): Promise<LevelMapResponse> {
    const map = await api<LevelMapResponse>("/api/level-map");
    applyMap(map);
    return map;
  }

  useEffect(() => {
    let alive = true;
    void api<LevelMapResponse>("/api/level-map")
      .then((map) => {
        if (alive) applyMap(map);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setLoaded(true);
        toast.error(reason instanceof Error ? reason.message : "Could not load the level map");
      });
    return () => {
      alive = false;
    };
  }, []);

  const companies = useMemo(
    () => [...new Set(entries.map((row) => row.company))].sort((a, b) => a.localeCompare(b)),
    [entries],
  );
  const bands = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; min: number; max: number }>();
    for (const row of entries) {
      const key = bandKey(row);
      if (!seen.has(key)) {
        seen.set(key, { key, label: bandLabel(row), min: row.microsoftLevelMin, max: row.microsoftLevelMax });
      }
    }
    return [...seen.values()].sort((a, b) => a.min - b.min || a.max - b.max);
  }, [entries]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const next = entries.filter((row) => {
      if (company !== "all" && row.company !== company) return false;
      if (band !== "all" && bandKey(row) !== band) return false;
      if (confidence !== "all" && row.confidence !== confidence) return false;
      if (!query) return true;
      const haystack = [row.company, row.companyLevel, row.companyTitle, row.notes, row.displayLabel, row.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
    next.sort((a, b) => {
      if (sort === "band") {
        return (
          a.microsoftLevelMin - b.microsoftLevelMin ||
          a.microsoftLevelMax - b.microsoftLevelMax ||
          a.company.localeCompare(b.company) ||
          a.companyLevel.localeCompare(b.companyLevel, undefined, { numeric: true })
        );
      }
      return (
        a.company.localeCompare(b.company) ||
        a.companyLevel.localeCompare(b.companyLevel, undefined, { numeric: true })
      );
    });
    return next;
  }, [entries, search, company, band, confidence, sort]);

  const groups = useMemo(() => {
    const chunks: Array<{ key: string; label: string; rows: LevelRow[] }> = [];
    for (const row of visible) {
      const key = sort === "band" ? bandKey(row) : row.company;
      const label = sort === "band" ? `Microsoft ${bandLabel(row)}` : row.company;
      const last = chunks[chunks.length - 1];
      if (!last || last.key !== key) chunks.push({ key, label, rows: [row] });
      else last.rows.push(row);
    }
    return chunks;
  }, [visible, sort]);

  const lowCount = entries.filter((row) => row.confidence === "low").length;
  const editedCount = entries.filter((row) => row.origin !== "researched").length;

  async function saveEditor(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const min = Number(editor.draft.microsoftLevelMin);
    const max = Number(editor.draft.microsoftLevelMax);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      toast.error("Microsoft minimum must be a whole number at or below the maximum.");
      return;
    }
    if (editor.mode === "add" && !editor.draft.company.trim()) {
      toast.error("Company is required.");
      return;
    }
    if (!editor.draft.companyLevel.trim()) {
      toast.error("Company level is required.");
      return;
    }
    const body = {
      company: editor.draft.company.trim(),
      companyLevel: editor.draft.companyLevel.trim(),
      companyTitle: editor.draft.companyTitle.trim(),
      microsoftLevelMin: min,
      microsoftLevelMax: max,
      confidence: editor.draft.confidence,
      notes: editor.draft.notes,
    };
    setSaving(true);
    try {
      if (editor.mode === "add") {
        await api("/api/level-map", { method: "POST", body: JSON.stringify(body) });
        toast.success("Row added on this machine");
      } else {
        await api("/api/level-map", {
          method: "PATCH",
          body: JSON.stringify({ id: editor.row.id, ...body }),
        });
        toast.success("Level row updated on this machine");
      }
      setEditor(null);
      await reload();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(row: LevelRow) {
    setSaving(true);
    try {
      await api("/api/level-map", { method: "DELETE", body: JSON.stringify({ id: row.id }) });
      toast.success(
        row.origin === "added" ? "Added row deleted" : "Row removed from scoring. The researched file is unchanged.",
      );
      setPendingDelete(null);
      setEditor(null);
      await reload();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not delete");
    } finally {
      setSaving(false);
    }
  }

  async function resetRow(row: LevelRow) {
    setSaving(true);
    try {
      await api("/api/level-map/reset", { method: "POST", body: JSON.stringify({ id: row.id }) });
      toast.success("Restored the researched value");
      setEditor(null);
      await reload();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not reset");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        step="Reference"
        title="Level map"
        description={
          disclaimer ||
          "Company levels mapped onto the Microsoft scale. Changes stay on this machine and apply to the next evaluation."
        }
        action={
          <Button type="button" onClick={() => setEditor({ mode: "add", draft: emptyDraft() })}>
            Add row
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Search
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Company, level, title, or notes"
            className="w-64"
            aria-label="Search the level map"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Company
          <select className={selectClass} value={company} onChange={(event) => setCompany(event.target.value)} aria-label="Filter by company">
            <option value="all">All companies</option>
            {companies.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Microsoft band
          <select className={selectClass} value={band} onChange={(event) => setBand(event.target.value)} aria-label="Filter by Microsoft band">
            <option value="all">All bands</option>
            {bands.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Confidence
          <select
            className={selectClass}
            value={confidence}
            onChange={(event) => setConfidence(event.target.value)}
            aria-label="Filter by confidence"
          >
            <option value="all">All confidence</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Sort
          <select
            className={selectClass}
            value={sort}
            onChange={(event) => setSort(event.target.value === "band" ? "band" : "company")}
            aria-label="Sort the level map"
          >
            <option value="company">Company, then level</option>
            <option value="band">Microsoft band, then company</option>
          </select>
        </label>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        {loaded ? (
          <>
            {visible.length} of {entries.length} rows
            {lowCount > 0 ? ` · ${lowCount} low confidence` : ""}
            {editedCount > 0 ? ` · ${editedCount} changed on this machine` : ""}
          </>
        ) : (
          "Loading the level map…"
        )}
      </p>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full min-w-[960px] border-collapse text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Company level</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Microsoft level</th>
              <th className="px-3 py-2 font-medium">Confidence</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Notes</th>
              <th className="sticky right-0 bg-muted/80 px-3 py-2 font-medium shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.2)]">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <GroupRows
                key={`${sort}-${group.key}`}
                label={group.label}
                rows={group.rows}
                onEdit={(row) => setEditor({ mode: "edit", row, draft: draftFromRow(row) })}
                onDelete={setPendingDelete}
                onReset={(row) => void resetRow(row)}
              />
            ))}
            {loaded && visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No rows match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Researched rows stay in <span className="font-mono">data/level-map.json</span>. Your edits are stored in{" "}
        <span className="font-mono">data/level-map-overrides.json</span>, which is not committed. The next evaluation uses this table.{" "}
        <Link href="/preferences" className="underline underline-offset-4">
          Preferences
        </Link>{" "}
        still holds your target band.
      </p>

      {removed.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Removed from scoring</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These researched rows are hidden from evaluations. Restore puts the researched value back.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {removed.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1 ring-foreground/10">
                <span className="text-sm">
                  {row.company} {row.companyLevel}
                  <span className="ml-2 text-muted-foreground">{row.displayLabel}</span>
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => void resetRow(row)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editor?.mode === "add" ? "Add a company level" : `Edit ${editor?.row.company ?? ""} ${editor?.row.companyLevel ?? ""}`}
            </DialogTitle>
            <DialogDescription>
              {editor?.mode === "add"
                ? "The new row is saved on this machine and used the next time a posting is scored."
                : "Saving writes a correction on this machine. The researched row in the repository stays as it is."}
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <form id="level-map-editor" className="grid gap-3" onSubmit={(event) => void saveEditor(event)}>
              {editor.mode === "add" ? (
                <Label className="grid gap-1.5">
                  Company
                  <Input
                    value={editor.draft.company}
                    onChange={(event) =>
                      setEditor({ ...editor, draft: { ...editor.draft, company: event.target.value } })
                    }
                    required
                  />
                </Label>
              ) : (
                <p className="text-sm text-muted-foreground">{editor.row.company}</p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Label className="grid gap-1.5">
                  Company level
                  <Input
                    value={editor.draft.companyLevel}
                    onChange={(event) =>
                      setEditor({ ...editor, draft: { ...editor.draft, companyLevel: event.target.value } })
                    }
                    required
                  />
                </Label>
                <Label className="grid gap-1.5">
                  Title
                  <Input
                    value={editor.draft.companyTitle}
                    onChange={(event) =>
                      setEditor({ ...editor, draft: { ...editor.draft, companyTitle: event.target.value } })
                    }
                  />
                </Label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Label className="grid gap-1.5">
                  Microsoft minimum
                  <Input
                    type="number"
                    min={50}
                    max={90}
                    value={editor.draft.microsoftLevelMin}
                    onChange={(event) =>
                      setEditor({ ...editor, draft: { ...editor.draft, microsoftLevelMin: event.target.value } })
                    }
                    required
                  />
                </Label>
                <Label className="grid gap-1.5">
                  Microsoft maximum
                  <Input
                    type="number"
                    min={50}
                    max={90}
                    value={editor.draft.microsoftLevelMax}
                    onChange={(event) =>
                      setEditor({ ...editor, draft: { ...editor.draft, microsoftLevelMax: event.target.value } })
                    }
                    required
                  />
                </Label>
              </div>
              <Label className="grid gap-1.5">
                Confidence
                <select
                  className={selectClass}
                  value={editor.draft.confidence}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      draft: { ...editor.draft, confidence: event.target.value as Confidence },
                    })
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </Label>
              <Label className="grid gap-1.5">
                Notes
                <Textarea
                  value={editor.draft.notes}
                  onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, notes: event.target.value } })}
                />
              </Label>
              {editor.mode === "edit" ? (
                <p className="text-xs leading-5 text-muted-foreground">Source: {editor.row.source}</p>
              ) : null}
            </form>
          ) : null}
          <DialogFooter className="sm:justify-between">
            <div className="flex gap-2">
              {editor?.mode === "edit" && editor.row.origin === "edited" ? (
                <Button type="button" variant="outline" disabled={saving} onClick={() => void resetRow(editor.row)}>
                  Reset to researched
                </Button>
              ) : null}
              {editor?.mode === "edit" ? (
                <Button type="button" variant="destructive" disabled={saving} onClick={() => setPendingDelete(editor.row)}>
                  Delete
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button type="submit" form="level-map-editor" disabled={saving}>
                {editor?.mode === "add" ? "Add row" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDelete?.origin === "added" ? "Delete this added row?" : "Remove this row from scoring?"}
            </DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? pendingDelete.origin === "added"
                  ? `${pendingDelete.company} ${pendingDelete.companyLevel} was added on this machine. Deleting it does not change the researched map, and it cannot be restored from that file.`
                  : `${pendingDelete.company} ${pendingDelete.companyLevel} stays in the researched file. Evaluations will skip it until you restore it.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={saving || !pendingDelete}
              onClick={() => pendingDelete && void removeRow(pendingDelete)}
            >
              {pendingDelete?.origin === "added" ? "Delete row" : "Remove from scoring"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupRows({
  label,
  rows,
  onEdit,
  onDelete,
  onReset,
}: {
  label: string;
  rows: LevelRow[];
  onEdit: (row: LevelRow) => void;
  onDelete: (row: LevelRow) => void;
  onReset: (row: LevelRow) => void;
}) {
  return (
    <>
      <tr className="bg-muted/40">
        <th colSpan={8} className="px-3 py-1.5 text-left text-xs font-medium text-foreground">
          {label}
          <span className="ml-2 font-normal text-muted-foreground">{rows.length}</span>
        </th>
      </tr>
      {rows.map((row) => (
        <tr
          key={row.id}
          className={
            row.confidence === "low"
              ? "border-t border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/40"
              : "border-t border-border/80"
          }
        >
          <td className="px-3 py-2 align-top font-medium">
            <div className="flex flex-wrap items-center gap-1.5">
              <span>{row.company}</span>
              {row.origin === "edited" ? <Badge variant="secondary">Edited</Badge> : null}
              {row.origin === "added" ? <Badge variant="secondary">Added</Badge> : null}
            </div>
          </td>
          <td className="px-3 py-2 align-top whitespace-nowrap">{row.companyLevel}</td>
          <td className="max-w-48 px-3 py-2 align-top text-muted-foreground">{row.companyTitle || "—"}</td>
          <td className="px-3 py-2 align-top whitespace-nowrap">{row.displayLabel}</td>
          <td className="px-3 py-2 align-top">
            {row.confidence === "low" ? (
              <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                Low confidence
              </Badge>
            ) : (
              <span className="capitalize">{row.confidence}</span>
            )}
          </td>
          <td className="max-w-36 px-3 py-2 align-top">
            {row.source.startsWith("http") ? (
              <a href={row.source} target="_blank" rel="noreferrer" className="underline underline-offset-4" title={row.source}>
                {sourceLabel(row.source)}
              </a>
            ) : (
              <span className="text-muted-foreground">{sourceLabel(row.source)}</span>
            )}
          </td>
          <td className="max-w-xs px-3 py-2 align-top text-muted-foreground" title={row.notes}>
            <span className="line-clamp-3">{row.notes}</span>
          </td>
          <td
            className={
              row.confidence === "low"
                ? "sticky right-0 bg-amber-50 px-3 py-2 align-top shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)] dark:bg-amber-950"
                : "sticky right-0 bg-background px-3 py-2 align-top shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)]"
            }
          >
            <div className="flex justify-end gap-1">
              {row.origin === "edited" ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onReset(row)}>
                  Reset
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => onEdit(row)} aria-label={`Edit ${row.company} ${row.companyLevel}`}>
                Edit
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(row)} aria-label={`Delete ${row.company} ${row.companyLevel}`}>
                Delete
              </Button>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
