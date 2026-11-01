# Keel

Keel is a self-hosted job search for one person. You keep a source-cited record of your work, set the kind of role you want, and score postings against that record. Keel is the working name.

It is meant to be cloned, run locally, and argued with. A later hosted version may be a small paid subscription. Version 1 has no sign-in and no billing.

## What it does

The owner's list numbered tailoring as item 6. There is no item 5 in the current scope.

1. **Baseline.** Upload a resume or other document (PDF, DOCX, or text). The extractor builds a structured record of roles, dates, companies, skills, scope, and impact, and each fact keeps a source excerpt. If two documents disagree, for example on the dates of the same role, Keel asks a clarifying question instead of merging them. You can review and edit the baseline.
2. **Preferences.** Locations, remote / hybrid / on-site, commute tolerance, and a target pay band as Microsoft-equivalent levels (for example 63 to 65). `data/level-map.json` maps other companies' levels onto that scale. Most rows are labeled examples. Verify them.
3. **Evaluation.** Paste a job description or a URL. Keel fetches the URL and extracts the text, and if the site blocks the fetch it asks you to paste. If the location is outside your saved places, or the role is hybrid or on-site while you want remote only, Keel pauses and asks whether to continue or rule the role out. Continuing scores it and shows that mismatch. Ruling it out stores the reason and skips scoring and tracking. The result is a fit percentage with a skills-and-experience score and a preferences score. The overall blend defaults to 65/35 and can be changed on the Preferences page; changing it recomputes existing overall scores without calling a model.
4. **Tracking.** After each evaluation, Keel asks whether to track the job. Skipping deletes it. Tracked jobs are a ranked, sortable list: Score, Role Title, Requisition ID / Job ID, Company, Location & Worksite (for example Redmond, WA / Hybrid: 3 days), and Level (for example Microsoft L65 (IC5)).
6. **Tailoring.** For a tracked or evaluated job, Keel suggests resume edits and writes a cover letter. Both are limited to facts in the baseline. Nothing is supposed to be invented.

The pages in this repository are a working skeleton, not a finished interface.

## Privacy

In self-hosted mode, resumes, baselines, postings, and letters stay on the machine that runs Keel. They live in the SQLite file (`data/keel.sqlite` by default) and in `data/uploads/`.

With `AI_PROVIDER=local` (the default) or `mock`, Keel does not send that text anywhere. If you set a model provider, the prompt for that call includes the baseline and the posting, and it goes to that provider. A future hosted service would have to say so plainly. This README's privacy promise is about the copy you run yourself.

## Quick start

Requires Node.js 22.

```bash
npm install
npm run dev
```

Open <http://localhost:4317>. `npm install` generates the Prisma client. `npm run dev` creates the database and starts the app. You do not need a `.env` file until you want a model.

Try one evaluation:

1. On **Baseline**, add a role by hand. Put skills the posting will mention, and leave one requirement out so you can see a gap.
2. On **Preferences**, save a level range and a worksite.
3. On **Evaluate**, paste `examples/sample-posting.txt`.
4. Choose **Track it**, then open **Tracked jobs** and **Tailor**.

A text resume can also use blocks the local extractor understands:

```text
ROLE: Senior Technical Program Manager
COMPANY: Contoso
START: March 2019
END: June 2024
LOCATION: Redmond, WA
SKILLS: technical program management, cross-org execution
SUMMARY: Led the platform program.
```

### Docker

```bash
docker compose up --build
```

The app listens on port 4317. The compose file mounts `./data`, so the database and uploads survive a rebuild. Put API keys in a `.env` file next to `docker-compose.yml` if you want a provider. Compose passes those variables through. Without them, the local heuristic is used.

## Configuration

Copy `.env.example` to `.env` when you need to change a setting. Real keys stay out of git.

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `local` (default), `mock`, `openai`, `anthropic`, `google`, or `openai-compatible` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI. Default model `gpt-4o-mini`. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Anthropic. Default model `claude-sonnet-4-5`. Set the model to one your account can call. |
| `GOOGLE_API_KEY`, `GOOGLE_MODEL` | Google AI. Default model `gemini-2.5-flash`. |
| `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_MODEL` | Any OpenAI-compatible server, including a local one such as `http://127.0.0.1:11434/v1`. The key may be empty. |
| `DATABASE_URL` | Default `file:./data/keel.sqlite`. See [Postgres](docs/design.md#postgres) before pointing this at Postgres. |
| `LOCAL_USER_ID`, `LOCAL_USER_NAME` | The single local user. Default id `local`. |
| `PORT` | `npm run dev` and `npm start` use 4317. |

`mock` runs the adapter and the JSON parser without a network call. It does not invent a work history. `local` is the deterministic heuristic in `src/lib/evaluate.ts`. If you set a provider but omit its key, evaluation returns an error instead of quietly switching scorers.

Prompts live in `prompts/` and are loaded at call time. They are not embedded in the provider classes.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Create the database if needed and start the app on port 4317 |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests |
| `npm run lint` | ESLint |
| `npm run typecheck` | Prisma generate, Next typegen, `tsc --noEmit` |
| `npm run db:push` | Apply `prisma/schema.prisma` to the SQLite file |

## Roadmap

- Tighter extraction, including page-level citations for PDFs, and a way to apply an answer to a date conflict instead of only storing it.
- Commute tolerance is saved and not yet scored.
- Sign-in. Every table already has `userId`, so this should not require a new schema shape.
- Postgres for a hosted deployment. The switch is documented in `docs/design.md`.
- A hosted multi-user service, and possibly a paid subscription. The people using that service would get the corresponding source, which is what AGPL requires. Whether to stay on AGPL, dual-license, or pick another license is an open decision and can be revisited before anyone is charged.

## License

[AGPL-3.0](LICENSE). Keel may later be offered as a paid hosted service. AGPL keeps a modified server-side version shareable with the people who use that service, which matches "you can run it yourself" better than a license that allows a closed hosted fork. The choice is deliberate and not permanent. If hosting plans change, the license can be revisited before a paid launch.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports, feature requests, and "this score seems wrong" each have a GitHub issue template. Please do not paste a full resume into a public issue.
