# Contributing

Thanks for trying Keel and for sending feedback. The useful reports are the ones that say which baseline fact should have counted, and which sentence in the posting was missed.

## Ground rules

- Do not invent employers, dates, titles, metrics, or scope. If a change touches extraction, scoring, or tailoring, the output has to stay inside the user's documents and the facts they confirmed.
- Do not commit `.env`, API keys, `data/*.sqlite`, `data/level-map-overrides.json`, or files under `data/uploads/`.
- This repository is AGPL-3.0. Contributions are under that license.

## Setup

```bash
npm install
npm test
npm run dev
```

`npm install` generates the Prisma client. `npm run dev` creates the SQLite file and starts the app at <http://localhost:4317>.

Before a pull request:

```bash
npm test
npm run lint
npm run typecheck
```

## Where things live

- Product behavior: `docs/design.md`
- Prompts: `prompts/`. Keep them out of the TypeScript that calls the provider.
- Providers: `src/lib/ai/`. Add a class that implements `AiProvider`, then teach `resolveProvider` about a new `AI_PROVIDER` value and document it in `.env.example`.
- Level comparisons: `data/level-map.json` is the researched map. Edits from the Level map page belong in `data/level-map-overrides.json` on the machine that runs Keel. New researched rows need `verification` and a note. Do not present an unverified example as an anchor.
- Schema: `prisma/schema.prisma`. New tables still need `userId`.

## Score feedback

If a percentage looks wrong, open the "This score seems wrong" issue template. Say whether you used the local heuristic or a model. A wrong local score is a bug in `src/lib/evaluate.ts`. A wrong model score may be the prompt, the citation filter, or the level map.

## Local checks without a key

`AI_PROVIDER=local` is the default. `AI_PROVIDER=mock` exercises the adapter and the JSON parser without a network call. Neither one sends resume text anywhere.
