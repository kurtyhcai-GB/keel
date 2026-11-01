"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/client-api";
import type { PreferenceView, WorkMode } from "@/lib/types";

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
  const [lowCount, setLowCount] = useState(0);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api<{ preferences: PreferenceView | null }>("/api/preferences"),
      api<{ entries: Array<{ confidence: string }> }>("/api/level-map"),
    ]).then(([prefs, map]) => {
      if (!alive) return;
      if (prefs.preferences) {
        setDraft(prefs.preferences);
        setLocationText(prefs.preferences.locations.join("\n"));
        setSaved(true);
      }
      setLowCount(map.entries.filter((entry) => entry.confidence === "low").length);
    });
    return () => {
      alive = false;
    };
  }, []);

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
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Company levels are reviewed on the Level map page. Low-confidence rows are flagged there, and corrections stay on this machine.
          {lowCount > 0 ? ` ${lowCount} low-confidence rows need a look.` : ""}
        </p>
        <Link href="/level-map" className="mt-3 inline-flex text-sm font-medium underline underline-offset-4">
          Open the level map
        </Link>
      </section>
    </div>
  );
}
