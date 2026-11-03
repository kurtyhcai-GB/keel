# Keel

Keel is a self-hosted job search for one person. You keep a source-cited record of your work, set the kind of role you want, and score postings against that record. Keel is the working name.

It is meant to be cloned, run locally, and argued with. A later hosted version may be a small paid subscription. Version 1 has no sign-in and no billing.

**New here?** Follow the step-by-step guide: **[docs/SETUP.md](docs/SETUP.md)**. It assumes you have never used a terminal, Git, or Node, and it has separate Windows and Mac steps. When you are done, the app is at [http://localhost:4317](http://localhost:4317).

## What it does

1. **Baseline.** Upload a resume or other document (PDF, DOCX, or text). The extractor builds a structured record of roles, dates, companies, skills, scope, and impact, and each fact keeps a source excerpt. If two documents disagree, for example on the dates of the same role, Keel asks a clarifying question instead of merging them. You can review and edit the baseline.
2. **Preferences.** Locations, remote / hybrid / on-site, commute tolerance, and a target band as Microsoft-equivalent levels (for example 63 to 65). `data/level-map.json` maps other companies' levels onto that scale, and rows can carry a base-pay range where reliable data exists. **Level map** in the sidebar lists every row, and each row, including its pay range, can be edited. Corrections, new companies, and removals are saved in `data/level-map-overrides.json` on this machine and are not committed. Most rows are labeled examples. Verify them.
3. **Evaluation.** Paste a job description or a URL. Keel fetches the URL and extracts the text, and if the site blocks the fetch it asks you to paste. If the location is outside your saved places, or the role is hybrid or on-site while you want remote only, Keel pauses and asks whether to continue or rule the role out. Continuing scores it and shows that mismatch. Ruling it out stores the reason and skips scoring and tracking. Fully remote postings (for example "United States - Remote") match when you accept remote, and no commute is applied to them; a posting that says both remote and hybrid is flagged. Commute is scored only for Seattle-area office roles with a known drive time. Keel reads the pay range from the posting (hourly pay is converted to annual) and, when the posting names no level, estimates one from pay and labels it as an estimate. It warns when the stated pay and level disagree. The result is a fit percentage with a skills-and-experience score and a preferences score. The overall blend defaults to 65/35 and can be changed on the Preferences page; changing it recomputes existing overall scores without calling a model.
4. **Tracking.** After each evaluation, Keel asks whether to track the job. Skipping deletes it. Tracked jobs are a ranked, sortable list: Score, Role Title, Requisition ID / Job ID, Company, Location & Worksite (for example Redmond, WA / Hybrid: 3 days), and Level (for example Microsoft L65 (IC5)). When the posting gives a salary range, it is shown under the role title. Each row has a **Delete** button that, after you confirm, permanently removes the posting and everything linked to it (evaluation, tailored documents, saved answers, notes, and status).
5. **Tailoring.** For a tracked or evaluated job, Keel suggests resume edits, writes a cover letter, and answers free-form application questions such as "Why do you want to work here?". Resume and cover letter each have their own generate button, plus **Generate both**, so skipping the cover letter does not call the model for it, and regenerating one leaves the other alone. For a question, paste it, optionally set a character or word limit, and generate. Answers are saved with the job and can be edited, copied, regenerated, or deleted. All of it is limited to facts in the baseline. Nothing is supposed to be invented.

The pages in this repository are a working skeleton, not a finished interface.

## Privacy

In self-hosted mode, resumes, baselines, postings, and letters stay on the machine that runs Keel. They live in the SQLite file (`data/keel.sqlite` by default) and in `data/uploads/`.

With `AI_PROVIDER=local` (the default) or `mock`, Keel does not send that text anywhere. If you set a model provider, the prompt for that call includes the baseline and the posting, and it goes to that provider. A future hosted service would have to say so plainly. This README's privacy promise is about the copy you run yourself.

## Setup

Install, API keys, updates, and troubleshooting are in **[docs/SETUP.md](docs/SETUP.md)**. Short version, once Node.js 22 and Git are installed:

```bash
git clone https://github.com/kurtyhcai-GB/keel.git
cd keel
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Open <http://localhost:4317>. You do not need a `.env` file until you want a model. Copy `.env.example` to `.env` when you do. Real keys stay out of git. The first screen is empty. Use **Load sample** in the sidebar for a labeled senior TPM example, then clear it before you add your own record.

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

Docker (`docker compose up --build`) is covered at the end of [docs/SETUP.md](docs/SETUP.md). Provider variables, the default SQLite file (`data/keel.sqlite`), and the script list are in that guide and in `.env.example`. `npm run dev` listens on port 4317 and creates the database if needed. Postgres notes stay in [docs/design.md](docs/design.md#postgres).

## Roadmap

- Tighter extraction, including page-level citations for PDFs, and a way to apply an answer to a date conflict instead of only storing it.
- Commute times are built-in estimates for Seattle-area cities. Other metro areas are not estimated yet.
- Sign-in. Every table already has `userId`, so this should not require a new schema shape.
- Postgres for a hosted deployment. The switch is documented in `docs/design.md`.
- A hosted multi-user service, and possibly a paid subscription. The people using that service would get the corresponding source, which is what AGPL requires. Whether to stay on AGPL, dual-license, or pick another license is an open decision and can be revisited before anyone is charged.

## License

[AGPL-3.0](LICENSE). Keel may later be offered as a paid hosted service. AGPL keeps a modified server-side version shareable with the people who use that service, which matches "you can run it yourself" better than a license that allows a closed hosted fork. The choice is deliberate and not permanent. If hosting plans change, the license can be revisited before a paid launch.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports, feature requests, and "this score seems wrong" each have a GitHub issue template. Please do not paste a full resume into a public issue.
