"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { TrackedJobView } from "@/lib/types";

const columns = [
  ["score", "Score"],
  ["title", "Role title"],
  ["requisitionId", "Requisition ID / Job ID"],
  ["company", "Company"],
  ["worksite", "Location & worksite"],
  ["level", "Level"],
] as const;

type SortKey = (typeof columns)[number][0];

export function JobsTable() {
  const [jobs, setJobs] = useState<TrackedJobView[]>([]);
  const [sort, setSort] = useState<SortKey>("score");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (nextSort: SortKey, nextDir: "asc" | "desc") => {
    const response = await api<{ jobs: TrackedJobView[] }>(`/api/jobs?sort=${nextSort}&dir=${nextDir}`);
    setJobs(response.jobs);
    setError(null);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await reload(sort, dir);
      } catch (reason: unknown) {
        if (alive) setError(reason instanceof Error ? reason.message : "Could not load");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload, sort, dir]);

  function onSort(key: SortKey) {
    const nextDir = sort === key && dir === "desc" ? "asc" : "desc";
    setSort(key);
    setDir(nextDir);
  }

  async function onDelete(id: string) {
    setError(null);
    try {
      await api(`/api/jobs/${id}`, { method: "DELETE" });
      await reload(sort, dir);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove");
    }
  }

  if (loading) return <p>Loading tracked jobs…</p>;

  return (
    <div className="stack">
      {error ? <p role="alert">{error}</p> : null}
      {jobs.length === 0 ? <p>No tracked jobs yet. Score a posting and choose Track it.</p> : null}
      {jobs.length > 0 ? (
        <table>
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th key={key}>
                  <button type="button" onClick={() => onSort(key)}>
                    {label}
                    {sort === key ? (dir === "desc" ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              <th> </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <Fragment key={job.id}>
                <tr>
                  <td>{job.score}</td>
                  <td>
                    <button type="button" onClick={() => setOpenId(openId === job.id ? null : job.id)}>
                      {job.title || "Untitled role"}
                    </button>
                  </td>
                  <td>{job.requisitionId || "—"}</td>
                  <td>{job.company || "—"}</td>
                  <td>{job.locationAndWorksite || "—"}</td>
                  <td>{job.level || "—"}</td>
                  <td>
                    <button type="button" onClick={() => onDelete(job.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
                {openId === job.id ? (
                  <tr>
                    <td colSpan={7}>
                      <p>{job.summary}</p>
                      <p>
                        Skills {job.skillsScore}
                        {job.preferencesScore == null ? "" : ` · Preferences ${job.preferencesScore}`} ·{" "}
                        {job.provider}
                      </p>
                      {job.mismatches.length ? (
                        <ul>
                          {job.mismatches.map((mismatch) => (
                            <li key={mismatch.reason}>Continued despite this: {mismatch.reason}</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
