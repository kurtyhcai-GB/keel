"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import type { PreferenceView, WorkMode } from "@/lib/types";

type LevelEntry = {
  id: string;
  company: string;
  companyLevel: string;
  displayLabel: string;
  verification: string;
  notes: string;
};

const modes: WorkMode[] = ["remote", "hybrid", "onsite"];

export function PreferencesForm() {
  const [locations, setLocations] = useState("Redmond, WA");
  const [selected, setSelected] = useState<WorkMode[]>(["remote", "hybrid"]);
  const [commute, setCommute] = useState("45");
  const [minLevel, setMinLevel] = useState("63");
  const [maxLevel, setMaxLevel] = useState("65");
  const [notes, setNotes] = useState("");
  const [skillsWeight, setSkillsWeight] = useState(65);
  const [rescored, setRescored] = useState<number | null>(null);
  const [entries, setEntries] = useState<LevelEntry[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<{ preferences: PreferenceView | null }>("/api/preferences"),
      api<{ disclaimer: string; entries: LevelEntry[] }>("/api/level-map"),
    ])
      .then(([prefs, map]) => {
        if (prefs.preferences) {
          setLocations(prefs.preferences.locations.join("\n"));
          setSelected(prefs.preferences.workModes);
          setCommute(
            prefs.preferences.commuteToleranceMinutes == null
              ? ""
              : String(prefs.preferences.commuteToleranceMinutes),
          );
          setMinLevel(String(prefs.preferences.targetLevelMin));
          setMaxLevel(String(prefs.preferences.targetLevelMax));
          setNotes(prefs.preferences.notes ?? "");
          setSkillsWeight(prefs.preferences.skillsWeight);
        }
        setDisclaimer(map.disclaimer);
        setEntries(map.entries);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load"))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setRescored(null);
    try {
      const saved = await api<{ preferences: PreferenceView; rescored: number }>("/api/preferences", {
        method: "PUT",
        body: JSON.stringify({
          locations: locations
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          workModes: selected,
          commuteToleranceMinutes: commute.trim() === "" ? null : Number(commute),
          targetLevelMin: Number(minLevel),
          targetLevelMax: Number(maxLevel),
          skillsWeight,
          notes: notes.trim() || null,
        }),
      });
      setRescored(saved.rescored);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save");
    }
  }

  if (loading) return <p>Loading preferences…</p>;

  return (
    <div className="stack">
      {error ? <p role="alert">{error}</p> : null}
      {saved ? (
        <p>
          Saved.
          {rescored == null
            ? ""
            : ` Recalculated overall fit for ${rescored} evaluation${rescored === 1 ? "" : "s"} without calling a model. Tracked jobs use the new order.`}
        </p>
      ) : null}
      <form onSubmit={onSubmit}>
        <label>
          Locations, one per line
          <textarea value={locations} onChange={(event) => setLocations(event.target.value)} />
        </label>
        <fieldset>
          <legend>Worksite</legend>
          {modes.map((mode) => (
            <label key={mode}>
              <input
                type="checkbox"
                checked={selected.includes(mode)}
                onChange={(event) => {
                  setSelected((current) =>
                    event.target.checked ? [...current, mode] : current.filter((item) => item !== mode),
                  );
                }}
              />{" "}
              {mode}
            </label>
          ))}
        </fieldset>
        <label>
          Commute tolerance, minutes
          <input value={commute} onChange={(event) => setCommute(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          Microsoft level minimum
          <input value={minLevel} onChange={(event) => setMinLevel(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          Microsoft level maximum
          <input value={maxLevel} onChange={(event) => setMaxLevel(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          Score weight: skills {skillsWeight}% · preferences {100 - skillsWeight}%
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={skillsWeight}
            onChange={(event) => setSkillsWeight(Number(event.target.value))}
          />
        </label>
        <p>The default is 65% skills and 35% preferences. Saving recalculates overall fit from the scores you already have.</p>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <button type="submit">Save preferences</button>
      </form>
      <h2>Level map</h2>
      <p>{disclaimer}</p>
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Level</th>
            <th>Shown as</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.company}</td>
              <td>{entry.companyLevel}</td>
              <td>{entry.displayLabel}</td>
              <td>{entry.verification}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
