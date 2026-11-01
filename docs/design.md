# Design

Keel is a single-user, self-hosted job search. The record of someone's work is the source of truth. Scores, resume edits, and cover letters are commentary on that record. They do not get to add employers, dates, titles, metrics, or scope.

The pages shipped here are a skeleton: they call the API and render the results. Visual design is expected to change.

## Product functions

Numbering follows the owner's list. Item 5 is intentionally absent. Tailoring is item 6.

### 1. Baseline

The user uploads PDF, DOCX, or text. The file is stored under `data/uploads/`, and the extracted text is stored on the `Document` row.

Facts are rows, not one blob. A fact has a kind (`role`, `skill`, `education`, `scope`, `impact`, `other`), optional role fields, a summary, skills, and a `sourceExcerpt` plus an optional `sourceLocator`. Hand-entered facts start as `confirmed`. Extracted facts start as `draft` until the user edits them.

Extraction:

- `AI_PROVIDER=local` parses `ROLE` / `COMPANY` / `START` / `END` / `SKILLS` / `SUMMARY` blocks and does not guess. If there are no blocks, it opens a clarifying question.
- A configured provider is asked, via `prompts/extract-baseline.md`, to return JSON. A fact is kept only when `sourceExcerpt` is an exact substring of the document (at least 12 characters). Anything else is dropped and reported as a warning.
- If the model fails or returns nothing grounded, Keel falls back to the ROLE blocks when they exist.

Conflicts: two facts with the same normalized title and company and different non-empty dates are not merged. Both are kept, and a `ClarificationQuestion` states both versions. Answering the question stores the answer. It does not yet rewrite the facts. That application step is a TODO.

### 2. Preferences

One `Preference` row per user: locations, work modes (`remote`, `hybrid`, `onsite`), commute tolerance in minutes, `targetLevelMin` / `targetLevelMax` on the Microsoft level scale, and `skillsWeight`.

`skillsWeight` is the percent of overall fit that comes from the skills score. Preferences get the rest. The default is 65, so the blend is 65/35. Saving preferences recomputes `overallScore` on existing evaluations from the stored skills and preferences scores. It does not call a model. The tracked-jobs list sorts by that overall score, using the current weight at read time, so the order follows the slider.

`data/level-map.json` is the crosswalk. Microsoft rows that map a Microsoft level onto itself are `anchor`. The `Microsoft L65 (IC5)` label is `example-from-owner`, because that display string came from the product brief and the IC nickname is community shorthand, not an official Microsoft title. Other companies are `unverified-example`. The scorer uses a row only when the posting also names that company, so "L64" at an unmapped employer is not silently called Microsoft L64.

Commute tolerance is stored and not scored. TODO.

### 3. Evaluation

`POST /api/evaluate` accepts `{ text }` or `{ url }`.

URL fetch (`src/lib/fetch-posting.ts`) allows only public `http` and `https` URLs, refuses local and private addresses, and checks each redirect the same way. It does not resolve DNS, so a public hostname that later points at a private address is still a gap. A blocked, empty, or non-text response returns HTTP 422 with `needsPaste: true` and does not invent a posting.

Before any score is stored, `findPreferencePauses` checks two cases:

- The posting names a location, the user has preferred locations, and the posting location matches none of them.
- The user's only work mode is remote, and the posting reads as hybrid or on-site.

If either is true, `POST /api/evaluate` does not score and does not call a model. It stores the posting as `awaiting_preference` and returns `status: "needs_decision"` with the reasons. The Evaluate page asks the user to keep evaluating or rule the role out.

`POST /api/postings/:id/preference-decision` with `{ "continue": true }` then runs the score and stores an evaluation. The mismatches are saved on the evaluation and shown in the result. They are not score penalties and not deal-breakers. `{ "continue": false }` sets the posting to `ruled_out`, stores `ruledOutReason`, and creates no evaluation and no tracked job.

The score has:

- `skillsScore` — overlap between baseline skills and the posting
- `preferencesScore` — worksite (other than the remote-only pause above) and mapped level against saved preferences, or `null` when no preferences are saved. Location is not a silent penalty.
- `overallScore` — `blendOverall(skillsScore, preferencesScore, skillsWeight)`. When preferences are missing, overall equals the skills score. The server always derives overall this way, including when a model returns its own overall.

The local heuristic is the default and is what `npm test` locks in. A configured provider must return the JSON shape in `prompts/evaluate-posting.md`. The server drops any strength that does not cite a real fact id, drops deal-breakers that repeat an acknowledged location or worksite mismatch, and fills blank title, company, requisition id, location, worksite, and level from the deterministic parser so the tracking table still has columns.

Deal-breakers that remain in the heuristic:

- The posting's worksite does not intersect the saved work modes, except the remote-only pause above, which asks first.
- The mapped Microsoft level is two or more levels outside the target range.

A missing or unknown provider key is an error. Keel does not silently fall back to the heuristic after the user asked for a model.

A scored posting is stored as `pending`. It does not appear on the tracked list until the user tracks it. Ruled-out postings stay in the database with the reason and are left out of Tailor and the tracked list.

### 4. Tracking

`POST /api/evaluations/:id/decision` with `{ "track": true }` creates a `TrackedJob` and marks the posting `tracked`. `{ "track": false }` deletes the posting, and the evaluation goes with it.

`GET /api/jobs?sort=score&dir=desc` returns only tracked jobs. Sort keys: `score`, `title`, `requisitionId`, `company`, `worksite`, `level`. Default is score descending. Removing a row deletes the posting.

The location column is `location / worksite`, for example `Redmond, WA / Hybrid: 3 days`. The level column prefers the map's `displayLabel`, then the raw level text.

### 6. Tailoring

`POST /api/tailor` with `{ "jobPostingId" }` works for a pending or tracked posting. The local draft only restates baseline facts, names the posting's own title and company, and adds edits that say "do not add it" for requirement lines the baseline does not record.

A model draft is filtered: unknown fact ids are dropped, and a `sourceExcerpt` must appear in the cited fact. The response still carries a warning to read the letter before sending it. The model can phrase a sentence the filter does not catch. That is why the warning stays.

## Architecture

- Next.js App Router and TypeScript. Tailwind is available. The current pages are plain server pages plus small client forms.
- SQLite through Prisma 7 and the `better-sqlite3` driver adapter. See [Why Prisma](#why-prisma).
- One local user, created on first use from `LOCAL_USER_ID` / `LOCAL_USER_NAME`. There is no auth.
- Every persisted record has `userId`, even when a parent row already implies it. Later sign-in should replace `getLocalUser()` with the session user and keep the queries filtered by that id.
- AI access goes through `AiProvider` in `src/lib/ai/types.ts`. Implementations: OpenAI, Anthropic, Google, and an OpenAI-compatible base URL. `resolveProvider()` picks from `AI_PROVIDER`.
- Prompts are markdown files in `prompts/`. `loadPrompt()` reads them from disk.

### Why Prisma

Prisma keeps the database choice in `prisma/schema.prisma` and `prisma7.config.ts`, which is the smallest place to document a later Postgres move. Contributors cloning the repo already know `prisma db push`. Prisma 7 talks to SQLite through a driver adapter instead of its own query engine, so the native dependency is `better-sqlite3`, which ships prebuilds for the usual platforms.

Drizzle would also work. The schema would be TypeScript, which is nice, but the SQLite and Postgres table builders are different types, so "change the URL" is less true there than it first looks. Prisma's provider field is the switch this project is designed around.

v1 applies the schema with `prisma db push` on startup (`scripts/prepare-db.mjs`) so `npm run dev` is one command. That is acceptable for a local SQLite file. A hosted Postgres deployment should switch to committed migrations before anyone else has data.

### Postgres

The generated client is bound to the SQLite provider until you regenerate it. The code seam is `src/lib/db.ts`.

1. In `prisma/schema.prisma`, set `provider = "postgresql"`.
2. Set `DATABASE_URL=postgresql://user:pass@host:5432/keel`.
3. Run `npx prisma generate`, then create a real migration (`prisma migrate`) instead of `db push` if the database is shared.
4. In `src/lib/db.ts`, construct the client with the Postgres adapter (`@prisma/adapter-pg` is already a dependency):

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
export const prisma = new PrismaClient({ adapter });
```

JSON columns are strings today (`skillsJson`, and the evaluation arrays). They can become Postgres `jsonb` later. Do that in the migration, not by assuming the SQLite client can speak Postgres without step 3.

If `DATABASE_URL` already starts with `postgres`, the current SQLite build throws instead of writing to the wrong place.

## Schema

| Model | Role |
| --- | --- |
| `User` | The local user. v1 upserts one row. |
| `Document` | Original file path, mime type, and extracted text. |
| `BaselineFact` | One cited fact. `userId` plus optional `documentId`. |
| `ClarificationQuestion` | An open disagreement or a gap the extractor would not guess. `relatedFactIds` is a JSON array. |
| `Preference` | One row per user, including `skillsWeight` (default 65). |
| `JobPosting` | Raw text plus the columns the tracker needs. `pending`, `awaiting_preference`, `tracked`, or `ruled_out`. |
| `Evaluation` | Scores, cited strengths, gaps, deal-breakers, acknowledged mismatches, provider, warnings. |
| `TrackedJob` | The decision to keep a posting. |
| `TailorOutput` | A stored letter and the resume edits that produced it. |

Skipping a job deletes the `JobPosting`. Evaluations, tailor output, and the tracked row cascade with it.

## API

| Method | Path | Status |
| --- | --- | --- |
| GET | `/api/health` | Process is up, and which provider would be used. No secrets. |
| GET, POST | `/api/documents` | List, or multipart upload field `file`. |
| POST | `/api/documents/:id/extract` | Delete draft facts for that document and extract again. |
| GET, POST | `/api/baseline` | List facts and questions, or add a fact. |
| PATCH, DELETE | `/api/baseline/:id` | Edit (marks the fact confirmed) or delete. |
| GET | `/api/clarifications` | List questions. |
| PATCH | `/api/clarifications/:id` | Store an answer. Does not rewrite facts yet. |
| GET, PUT | `/api/preferences` | Read or replace preferences. Saving recomputes stored overall scores. |
| GET | `/api/level-map` | The JSON file, including the disclaimer. |
| POST | `/api/evaluate` | Score pasted text or a URL, or pause with `needs_decision`. |
| POST | `/api/postings/:id/preference-decision` | `{ "continue": true }` scores a paused posting. `false` rules it out. |
| POST | `/api/evaluations/:id/decision` | `{ "track": true \| false }`. |
| GET | `/api/jobs` | Tracked jobs, sorted. |
| DELETE | `/api/jobs/:id` | Remove a tracked job and its posting. |
| GET | `/api/postings` | Recent pending and tracked postings, for Tailor. |
| POST | `/api/tailor` | `{ "jobPostingId" }`. |

## What is still a stub

- Applying a clarification answer to the facts.
- Page numbers inside PDFs. The excerpt is checked against extracted text, not a page coordinate.
- Commute distance. The minutes are saved only.
- The local skills score is phrase overlap, not a judgment of seniority or scope. The default weight is 65/35, and the user can change it.
- Model output is constrained by the prompt and by the citation filter. It is not a proof that every adjective in a letter is earned.
- URL fetch does not do a DNS-rebinding check.

## Open questions

- Is the working name Keel the one to keep?
- Should L65 keep the IC5 nickname, and what nicknames belong on 63, 64, and 66?
- Which level-map rows are actually trusted, and what source should replace the example rows?
- When a date conflict is answered, which fact is edited, and is the rejected one deleted?
- Before a paid hosted launch, stay on AGPL, dual-license, or choose something else?
