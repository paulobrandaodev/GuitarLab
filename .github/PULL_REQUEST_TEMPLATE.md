## What this changes

<!-- One or two sentences. -->

## Why

<!-- The reasoning matters more than the diff. If you rejected an obvious
     alternative, say which one and why — that is the kind of comment this
     codebase keeps. -->

## How to check it

<!-- What you ran, and what someone else should do to see it working. -->

## Checklist

- [ ] `npm test` passes (or I explained which tests fail and why)
- [ ] No audio, tablature, `.env` or database file is included in this PR
- [ ] Behaviour that is easy to break silently (timing, tuning maths, file
      parsing) has a test
- [ ] If I added an IPC channel, all four sides are updated: main handler,
      preload bridge, `src/shared/types.ts`, and the `Api` interface in
      `src/renderer/src/lib/api.ts`
