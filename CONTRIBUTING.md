# Contributing to GuitarLab

Thanks for taking a look. This is a guitar-practice app built by a guitarist, so
contributions from players are as welcome as contributions from developers —
a good bug report about how a feature feels while you are actually practising is
worth as much as a patch.

## Ground rules

**Never commit audio or tablature.** `songs/`, `gptabs/` and `.stems/` are your
local library, not code, and they are gitignored for a reason: they hold
copyrighted recordings and third-party tabs. Same for `.env` and `*.db`. If you
need a fixture for a test, generate it in code (see `scripts/test-stretch.mjs`,
which synthesises a 440 Hz sine) or use a short public-domain file.

Be decent to other people. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Getting set up

Requirements: **Node 22+**, **FFmpeg on your PATH** (the only hard dependency),
and Git. Docker with an NVIDIA GPU is optional and only needed for the audio lab.

```bash
git clone https://github.com/paulobrandaodev/GuitarLab.git
cd GuitarLab
npm install            # also rebuilds better-sqlite3 against Electron
cp .env.example .env   # optional — the app runs fine with it empty
npm run dev
```

There is **no database migration step**. The schema is created from plain DDL on
first launch so the app is self-bootstrapping (see the comment at the top of
`src/main/db/client.ts`). `npm run db:generate` is an authoring tool for schema
work, not something you run to get started.

Put a few `.gp3/.gp4/.gp5/.gpx/.gp` files in `gptabs/` and audio in `songs/`,
then hit **Importar pastas** in the app.

## How the code is laid out

Three processes, and the boundary between them matters:

```
src/main/       Node side: SQLite, IPC handlers, importers, external services
  db/           Drizzle schema, bootstrap DDL, queries
  importers/    Guitar Pro (headless alphaTab), audio (ffprobe), tab↔audio matcher
  services/     spotify, youtube, lrclib, lab, llm/, tone, sources
  practice/     spaced repetition, tempo ladder, mastery
src/preload/    the typed contextBridge — the only way the two sides talk
src/renderer/   React: design system + one folder per screen
src/shared/     code both processes import — keep it pure (no electron, no DOM)
lab/            optional Python sidecar (FastAPI + Demucs + librosa + whisper)
scripts/        the test suite
```

Adding an IPC channel means touching **four** places, in this order:
`src/main/ipc/index.ts` → `src/preload/index.ts` → types in `src/shared/types.ts`
→ the hand-written `Api` interface in `src/renderer/src/lib/api.ts`.

`src/shared/` is imported by both processes. Nothing in there may touch
`window`, `document`, `node:*` or `electron`.

## Tests

The suite is plain TypeScript files under `scripts/`, no framework. Several of
them boot a real Electron instance and drive the real app.

```bash
npm test               # typecheck + the whole battery
npm run typecheck      # fastest useful check while working

npm run test:setlist   # setlists, bands, playlist sync, title cleanup
npm run test:sources   # Ultimate Guitar links, ranking, live archive.org search
npm run test:chords    # transposition, chord track parsing, lab JSON validation
npm run test:tempo     # beat grid, snapping, playhead drift inside an A–B loop
npm run test:cifra     # chords + synced lyrics → ChordPro without splitting words
npm run test:sort      # list ordering, with standard E pinned to the top
npm run test:stretch   # renders 440 Hz and measures: speed and pitch really are independent
npm run test:tone      # tuning → pitch shifter, the CTRL switch, the patch list
npm run test:llm       # the tone prompt against real providers
npm run test:chordmap  # end-to-end chord detection (skips if the container is down)
```

Some need context: `test:llm` calls real AI providers and needs a key;
`test:chordmap` skips itself when the lab container is not running; `test:player`
and `test:media` need `npm run build` first.

**If you are on Linux or macOS and the Electron tests fail immediately**, check
that `ELECTRON_RUN_AS_NODE` is not set in your shell:
`env -u ELECTRON_RUN_AS_NODE npm test`.

Add a test when you change behaviour that is easy to break silently — anything
involving timing, tuning maths, or parsing a real file format. The existing
tests are the model: assert against real files and real output, not mocks.

## Pull requests

- Branch off `main`, one topic per PR.
- Run `npm test` before pushing.
- Explain **why**, not just what. This codebase documents its reasoning in
  comments and in the README's "Decisões que valem saber" section — a
  non-obvious decision deserves a sentence about the alternative you rejected.
- Match the surrounding style. There is no formatter config; follow the file
  you are editing.

Issues and PRs in English are easiest for everyone, but Portuguese and Spanish
are fine — the maintainer reads all three, and a report in your own language is
much better than no report.

## Good first contributions

- **Translations.** Interface localisation (English/Portuguese/Spanish) is
  planned and the groundwork is a good entry point.
- **Screenshots and docs.** The README is thorough but has no images.
- **Platform testing.** The app has really only been exercised on Windows.
  Linux and macOS reports are genuinely useful.
- **Chord detection quality.** `lab/app/main.py` scores chroma against chord
  templates with a Viterbi pass; the template set is deliberately small.
