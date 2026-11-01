"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/client-api";
import type { PreferenceView, WorkMode } from "@/lib/types";

type LevelEntry = {
  id: string;
  company: string;
  companyLevel: string;
  companyTitle?: string;
  displayLabel: string;
  confidence: "high" | "medium" | "low";
  microsoftLevelMin: number;
  microsoftLevelMax: number;
  notes: string;
  source: string;
};

const EMPTY: PreferenceView = {
  locations: [],
  workModes: ["remote", "hybrid"],
  commuteToleranceMinutes: 45,
  targetLevelMin: 63,
  targetLevelMax: 65,
  skillsWeight: 65,
  notes: null,
};

export function PreferencesView() {
  const [draft, setDraft] = useState<PreferenceView>(EMPTY);
  const [locationText, setLocationText] = useState("");
  const [saved, setSaved] = useState(false);
  const [entries, setEntries] = useState<LevelEntry[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const [editing, setEditing] = useState<LevelEntry | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api<{ preferences: PreferenceView | null }>("/api/preferences"),
      api<{ disclaimer: string; entries: LevelEntry[] }>("/api/level-map"),
    ]).then(([prefs, map]) => {
      if (!alive) return;
      if (prefs.preferences) {
        setDraft(prefs.preferences);
        setLocationText(prefs.preferences.locations.join("\n"));
        setSaved(true);
      }
      setDisclaimer(map.disclaimer);
      setEntries(map.entries);
    });
    return () => {
      alive = false;
    };
  }, []);

  const low = entries.filter((entry) => entry.confidence === "low");

  async function persistWeight(skillsWeight: number) {
    setDraft((current) => ({ ...current, skillsWeight }));
    if (!saved) return;
    await api("/api/preferences/weight", {
      method: "PATCH",
      body: JSON.stringify({ skillsWeight }),
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        step="Step 2 of 5"
        title="Preferences"
        description="Where you will work, how you will work, and how much skills should count against preferences. The weight applies as you move it. The rest of this form applies when you save."
      />
      <form
        className="flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          const locations = locationText
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          void api<{ rescored: number }>("/api/preferences", {
            method: "PUT",
            body: JSON.stringify({ ...draft, locations }),
          })
            .then((result) => {
              setSaved(true);
              toast.success(`Preferences saved. ${result.rescored} evaluation${result.rescored === 1 ? "" : "s"} updated.`);
            })
            .catch((reason: unknown) => toast.error(reason instanceof Error ? reason.message : "Could not save"));
        }}
      >
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">Score weighting</p>
            <p className="text-sm tabular-nums">
              {draft.skillsWeight}% skills · {100 - draft.skillsWeight}% preferences
            </p>
          </div>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[draft.skillsWeight]}
            onValueChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value;
              if (typeof next === "number") void persistWeight(next);
            }}
            className="mt-4"
            aria-label="Skills and experience weight versus preferences"
          />
        </div>

        <label className="grid gap-2 text-sm font-medium">
          Locations, one per line
          <textarea
            value={locationText}
            onChange={(event) => setLocationText(event.target.value)}
            placeholder={"Seattle\nRedmond, WA"}
            className="min-h-24 rounded-lg border bg-background px-3 py-2 font-normal"
          />
          <span className="font-normal text-muted-foreground">
            Seattle, Redmond, Bellevue, and nearby cities count as one metro.
          </span>
        </label>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Worksite</legend>
          {(["remote", "hybrid", "onsite"] as WorkMode[]).map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.workModes.includes(mode)}
                onChange={(event) => {
                  setDraft((current) => {
                    const has = current.workModes.includes(mode);
                    if (has && current.workModes.length === 1) return current;
                    return {
                      ...current,
                      workModes: event.target.checked
                        ? [...current.workModes, mode]
                        : current.workModes.filter((item) => item !== mode),
                    };
                  });
                }}
              />
              {mode}
            </label>
          ))}
        </fieldset>

        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">Commute tolerance</p>
            <p className="text-sm tabular-nums">{draft.commuteToleranceMinutes ?? 45} min</p>
          </div>
          <Slider
            min={0}
            max={90}
            step={5}
            value={[draft.commuteToleranceMinutes ?? 45]}
            onValueChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value;
              if (typeof next === "number") setDraft((current) => ({ ...current, commuteToleranceMinutes: next }));
            }}
            className="mt-4"
            aria-label="Commute tolerance in minutes"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">Microsoft-equivalent level</p>
            <p className="text-sm tabular-nums">
              {draft.targetLevelMin}–{draft.targetLevelMax}
            </p>
          </div>
          <Slider
            min={59}
            max={70}
            step={1}
            value={[draft.targetLevelMin, draft.targetLevelMax]}
            onValueChange={(value) => {
              if (!Array.isArray(value) || value.length < 2) return;
              const [min, max] = value[0] <= value[1] ? value : [value[1], value[0]];
              setDraft((current) => ({ ...current, targetLevelMin: min, targetLevelMax: max }));
            }}
            className="mt-4"
            aria-label="Microsoft-equivalent level range"
          />
        </div>

        <Button type="submit">Save preferences</Button>
      </form>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Level map</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{disclaimer}</p>
        <p className="mt-2 text-sm text-muted-foreground">{low.length} low-confidence rows need a look.</p>
        <ul className="mt-4 flex flex-col gap-2">
          {low.slice(0, 12).map((entry) => (
            <li key={entry.id} className="rounded-lg px-3 py-2 ring-1 ring-amber-300/80">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {entry.company} {entry.companyLevel}
                    <span className="ml-2 text-xs font-normal text-amber-800 dark:text-amber-200">low confidence</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.companyTitle} · {entry.displayLabel}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(entry)}>
                  Correct
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {editing ? (
        <form
          className="mt-4 grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void api("/api/level-map", {
              method: "PATCH",
              body: JSON.stringify({
                id: editing.id,
                microsoftLevelMin: Number(data.get("min")),
                microsoftLevelMax: Number(data.get("max")),
                notes: String(data.get("notes") ?? ""),
                confidence: String(data.get("confidence") ?? "low"),
              }),
            })
              .then(() => api<{ entries: LevelEntry[]; disclaimer: string }>("/api/level-map"))
              .then((map) => {
                setEntries(map.entries);
                setEditing(null);
                toast.success("Level row updated on this machine");
              })
              .catch((reason: unknown) => toast.error(reason instanceof Error ? reason.message : "Could not save"));
          }}
        >
          <p className="text-sm font-medium">
            Correct {editing.company} {editing.companyLevel}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <input name="min" type="number" defaultValue={editing.microsoftLevelMin} className="rounded-lg border px-3 py-2 text-sm" />
            <input name="max" type="number" defaultValue={editing.microsoftLevelMax} className="rounded-lg border px-3 py-2 text-sm" />
          </div>
          <textarea name="notes" defaultValue={editing.notes} className="min-h-20 rounded-lg border px-3 py-2 text-sm" />
          <select name="confidence" defaultValue={editing.confidence} className="rounded-lg border px-3 py-2 text-sm">
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
          <p className="text-xs text-muted-foreground">Source: {editing.source}</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm">Save correction</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
