# GuitarLab

**English** · [Português](README.pt-BR.md) · [Español](README.es.md)

A desktop app for consolidating your band's setlist and actually practising the
guitar — Guitar Pro tablature, YouTube lessons, chord sheets, chords detected
straight from the audio, tuning, GPU stem separation, and progress tracked per
section rather than per song.

Electron + React + TypeScript + SQLite. Dark neumorphic interface.

[![CI](https://github.com/paulobrandaodev/GuitarLab/actions/workflows/ci.yml/badge.svg)](https://github.com/paulobrandaodev/GuitarLab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Install

Grab an installer from [Releases](https://github.com/paulobrandaodev/GuitarLab/releases):

| Platform | File |
|---|---|
| Windows | `GuitarLab-<version>-instalador.exe`, or the portable build |
| Linux | `.AppImage` (no install) or `.deb` |

**One requirement, and only one: [FFmpeg](https://ffmpeg.org/download.html)**
must be installed and on your `PATH`. Everything else the app can live without.
Without FFmpeg, importing audio fails — the app tells you so on the first run.

**The Windows builds are not code-signed.** SmartScreen will say "unknown
publisher": click *More info* → *Run anyway*. A signing certificate costs
US$200–400 a year, which is not a reasonable cost for a free hobby project. If
that makes you uncomfortable, build it yourself — see below.

### From source

```bash
git clone https://github.com/paulobrandaodev/GuitarLab.git
cd GuitarLab
npm install          # also rebuilds better-sqlite3 for Electron
npm run dev
```

Node 22+. There is no database migration step: the schema is created on first
launch.

---

## Setting it up

Open the app, go to **Ajustes** (Settings), and paste in whatever keys you have.
**Every integration is optional** — each one that is missing simply switches off
its own feature and says so.

Keys are encrypted with your operating system's own key store (DPAPI on Windows,
Keychain on macOS, libsecret on Linux) and never leave the machine. If the OS
refuses to encrypt — a Linux box with no keyring — the app stores nothing rather
than writing your keys in plain text, and tells you why.

| Integration | What you get | Where to get the key |
|---|---|---|
| **Gemini / OpenAI / Groq** | Practice plans, technique breakdowns, tone patches | [aistudio.google.com](https://aistudio.google.com/apikey) · [platform.openai.com](https://platform.openai.com/api-keys) · [console.groq.com](https://console.groq.com/keys) |
| **Ollama** | The same, running locally — no key, nothing leaves your machine | [ollama.com](https://ollama.com) |
| **YouTube** | Finding lessons, backing tracks and playthroughs | [console.cloud.google.com](https://console.cloud.google.com) → YouTube Data API v3 |
| **Spotify** | Metadata, and driving the Spotify you already have open | [developer.spotify.com](https://developer.spotify.com/dashboard) |

Nothing to configure, no key needed: LRCLIB (synced lyrics), MusicBrainz,
archive.org (audio download), alphaTab, and every local model.

Running from a clone, a `.env` file at the project root also works — copy
[.env.example](.env.example). Precedence is: environment variable > what you
saved in Settings > `.env` > default. The Settings screen shows which one is
winning for each field, so a shell variable quietly outranking a key you just
pasted is visible rather than baffling.

---

## Using it

1. Put `.gp3/.gp4/.gp5/.gpx/.gp` files in [gptabs/](gptabs/) and audio
   (`mp3/wav/flac/m4a/ogg`) in [songs/](songs/) — or point the app at your own
   folders in Settings.
2. Open the app → **Importar pastas**.
3. Songs appear with tuning, tempo, key, sections, lyrics and chords already
   pulled out of the Guitar Pro files.
4. Add them to a setlist, open **Estudar**, and start.

Matching tablature to audio happens **by metadata** (ID3 in MP3, RIFF INFO in
WAV, the GP header). `02.-Master Of Puppets.wav` and
`master_of_puppets_metallica_gp_v2.gp` become one song, automatically. With no
tags it falls back to a normalised filename with fuzzy comparison.

> **On the interface language:** GuitarLab picks its language from your
> operating system and you can override it in Settings. The translation itself
> is partway there — the machinery, the shared labels and the Settings screen
> speak all three languages, and the rest of the screens are still Portuguese
> only. Migrating a screen is self-contained and a genuinely useful first
> contribution; see [CONTRIBUTING.md](CONTRIBUTING.md#translations).

---

## Screens

| Screen | What it does |
|---|---|
| **Setlist** | Show-readiness ring, per-song mastery, a warning when two consecutive songs need different tunings, sorting by band, title, tuning (standard E always pinned to the top) and duration, plus per-row **GP** and **WAV** shortcuts to find the tab and fetch the track |
| **Practice — Guitar Pro** | Score and tablature (alphaTab), transport with an A/B loop per section, speed slider, metronome, count-in, per-track mute/solo, speed trainer |
| **Practice — Stems** | Current chord shown against the previous one and the next two, 50–100% speed without touching pitch, semitone transposition without touching speed, an A–B loop dragged over the waveform and snapped to the beat, a metronome locked to the audio, per-track mute/solo and volume |
| **Song** | Progress per section, videos, chords and lyrics, **automatic chord chart** synced to the audio, a **generated chart** from chords plus synced lyrics, **tone patches** per section, data |
| **Lab** | Stem separation (Demucs), BPM and beats, key plus a chord track, audio→MIDI, lyric transcription |
| **Progress** | Today's queue (spaced repetition), consistency heatmap, BPM curve, AI-generated practice plan |
| **Tuner** | Microphone and pitch detection, preset taken from the GP file |
| **Stage mode** | Full screen, large lyrics and chords, advance by keyboard or foot pedal (arrows / PageUp / PageDown) |

---

## The audio lab (optional)

Stem separation and automatic BPM/key/chord analysis run in a container. **The
app works completely without it** — this is the only part that needs Docker.

```bash
npm run lab:up       # CPU; works anywhere
npm run lab:up:gpu   # NVIDIA, needs the NVIDIA Container Toolkit
npm run lab:logs
npm run lab:down
```

Be warned: the CUDA base image is large and the final image lands somewhere
around 12–15 GB, plus model weights downloaded on first use. Worth it if you
want stems; skip it entirely otherwise.

Media folders default to the ones in the repository. If yours live elsewhere,
copy [.env.compose.example](.env.compose.example) to `.env` next to
`docker-compose.yml` and point it at the same folders you chose in Settings.

---

## Decisions worth knowing

This is the part that explains why the app is shaped the way it is. If you plan
to contribute, read it — most of these were expensive to learn.

**Spotify no longer provides BPM or key.** The `audio-features` and
`audio-analysis` endpoints were discontinued in Nov 2024 for new apps, with no
replacement. That data comes from the Guitar Pro file or from local analysis.
February 2026 also cut `search` down to 10 results and removed batch lookup, so
the client uses a throttled queue and caches aggressively.

**Spotify playback goes through Connect**, not embedded. The Web Playback SDK
needs Widevine DRM, which stock Electron does not ship — only a fork with a VMP
signature. So the app drives the Spotify already running on the machine. The
driver sits behind an interface, so swapping it later means plugging in another
implementation.

**YouTube: one search per song, not three.** The free quota is about 100
searches a day. The app makes one search returning 25 results and classifies
them locally into roles (Lesson w/ Tabs, Backing Track, Guitar Only) by regex
plus channel reputation, with an AI re-rank only for the ambiguous cases.
Results are cached permanently, and there is a manual path — paste a URL — that
costs no quota at all.

**The YouTube player lives two frames down.** The IFrame player refuses to start
on any origin that is not http(s), and rewriting Origin/Referer from the main
process does not help: it validates the embedding page over `postMessage`
against its real origin. So a one-page local http server hands out a page that
carries the player, and the renderer embeds that. The whole app is deliberately
*not* moved onto that origin — `app://` is what makes alphaTab's workers, the
soundfont and the `media://` fetches behave.

**Chord sheets are pasted, not scraped.** Ultimate Guitar and CifraClub have no
public API and scraping them violates their terms. The app has a ChordPro editor
with AI conversion of pasted text, plus a deep link to the site.

**Tablature: the app does not download, but it does receive.** For the same
reason, the **GP** button opens the Ultimate Guitar search already filtered to
`type=500` (Guitar Pro only) with `rating[0]=4&rating[1]=5` — the parameters the
site's own filters use, so they follow the site rather than guessing. Downloads
in that window are intercepted: whatever you click lands directly in
[gptabs/](gptabs/) and is imported into the song it came from, never passing
through your Downloads folder. You choose and you click; the app only decides
where the file lives. The session is persistent and separate from the app's, so
a Pro login survives between runs.

**Audio comes from archive.org, and that part is automatic.** archive.org has a
public search and public metadata, so the **WAV** button does the whole journey:
find the item, score each track against the song's title and artist (the same
matcher the importer uses), prefer wav/flac over mp3, download into
[songs/](songs/) and import — duration, EBU R128 loudness and waveform come out
immediately. A partial download is deleted: a truncated wav in `songs/` would be
a corrupt track forever.

**The sidecar runs the repository's code, not the image's.** The Dockerfile
copies `lab/app` into the image, so editing the Python and running
`npm run lab:up` left the container serving the old version — the analysis
answered `done` with a result that had no chords and the app had nothing to
store. Now compose mounts `lab/app` over the top (read-only) and uvicorn runs
with `--reload`: save the file, the container reloads.

**Automatic chord charts, Chordify-style.** The lab's `/harmony` stopped
returning just the key: it tracks the beats, takes a chroma per beat from the
harmonic signal (percussion smears the chroma) and matches against chord
templates — major, minor, 7, m7, maj7 and power chord, which is half of any
metal riff. The final pass is a Viterbi with a fixed penalty for changing chord;
without it the label changes every beat and is unreadable. The screen shows the
blocks in order, lights the one playing, jumps to that point on click, and
transposes by semitone. The little bar under each chord is confidence — red
means an ambiguous passage worth checking by ear.

**Speed and pitch are separate controls, and that cost a worklet.** In Web
Audio, `playbackRate` and `detune` are the same thing — resampling — so half
speed is also an octave down, which is no use for learning a riff. What
separates them is SoundTouch (WSOLA time-stretch plus a rate transposer) running
as an AudioWorklet. The division of labour is not obvious from the names: what
changes the speed is still the *source*, through its `playbackRate`, and the
node's `playbackRate` parameter tells the processor how far to push the pitch
back (it computes `pitch × 2^(semitones/12) ÷ playbackRate`). Both get the same
number, and `pitchSemitones` is free transposition on top. Get it backwards and
70% speed comes out an octave and a half down while everything still compiles,
plays, and looks right on screen. That is why `npm run test:stretch` renders a
real 440 Hz sine and measures what came out. At 100% with no transposition the
node steps out of the path: latency and artefacts for free are not a bargain.

**The metronome click goes through the bus, not straight to the output.** The
time-stretcher delays the audio by tens of milliseconds. A click that skipped
that path would arrive early relative to the beat it is marking — and at 150 bpm,
50 ms is half a sixteenth. So the metronome joins the same bus as the tracks,
before the stretcher: both take the same delay and stay locked. In exchange, the
click passes through the transposer, so its frequency is pre-compensated to come
out at the same pitch every time. The beat grid comes from the lab when one
exists (recordings speed up in the chorus; a rigid BPM grid drifts off the band
within a minute) and falls back to the declared BPM when it does not.

**The A–B loop is native, and the playhead knows it.** Repetition uses the
`AudioBufferSourceNode`'s own `loop`/`loopStart`/`loopEnd`, so the wrap is
sample-exact and nothing restarts. The price is that the clock has to discover
the wrap itself — and, when it does, re-anchor at the *exact instant* it
happened, not at "now": rounding to the current frame adds an error per lap, and
a two-bar section practised for five minutes ends with the metronome a beat out.
`resolvePosition` does that arithmetic and `npm run test:tempo` runs two hundred
laps to prove it does not accumulate.

**The chord chart comes from arithmetic, not from the model.** Two analyses
already sit in the database without ever meeting: the chord track the lab hears
in the audio, and the synced lyrics from LRCLIB. Each alone is half a chart. On
the same clock they become ChordPro: for each sung line, the chord already
sounding opens the line and the following changes fall proportionally in time,
always snapped to the start of a word — a chord mid-syllable is impossible to
sing. A long gap between two lines becomes an instrumental block; whatever is
left after the last line becomes an outro. A model asked to "put the chords in
the right place" invents both; the timestamps are true. A hand-written chart is
never silently overwritten: when one exists, the generated one opens in the
editor instead.

**Tunings do not sort alphabetically.** Sorting a setlist by tuning is not A–Z:
standard E is *pinned* to the top, whichever way the arrow points. It is the
block you can play without touching a peg, and it is the only useful reading of
that column — only the rest flips between A–Z and Z–A. Sorting is a way to
*read* the setlist, never to rewrite it: rows keep showing their place in the
show, and the drag handle is only live in show order, because dropping a row in
a list sorted by duration would record an order nobody asked for.

**One patch per tone, not one per song.** Master of Puppets has a dirty riff, a
clean section in the middle, and a solo — an averaged patch serves none of the
three. The AI returns a list in chronological order (at most 4), each with a
name, the section it belongs to, its own drawn signal chain, and the knobs. The
section names come from the Guitar Pro file, so the patch says "comes in at the
solo" rather than "in the heavy part".

**The guitar stays in standard E; the pitch shifter does the rest.** Retuning
between songs mid-show is not an option, so the rule is: the guitar lives in
standard E, at most a Drop D done by hand, and the PS block covers the
difference. This is arithmetic over the tuning the Guitar Pro file declares, not
an AI guess — `planPitchShifter` compares the six strings against standard E and
decides: a uniform shift becomes pure PS (Eb → −1), a drop pattern becomes a
hand-tuned Drop D plus PS (Drop C# → Drop D −1), and for open or 7-string
tunings it says outright that it cannot be done. The number goes into the prompt
as a fact and comes back in the plan without passing through the model.

**The CTRL switch has an owner.** The GT-1 has a single assignable footswitch,
so each patch declares what is worth putting on it for that section — wah,
whammy, solo boost, kicking in the delay — with what one press does and when you
would use it. When nothing justifies it, the field comes back null instead of
inventing something.

**AI answers are markdown, and are read as markdown.** Responses used to arrive
with literal `###` and `**` on screen. A small renderer (headings, nested lists,
bold, code, fences) draws that with the headings in the interface's orange
gradient. No library: nothing here needs a table or a link, and a full parser
would be a new dependency plus more injection surface for text that came from a
model.

**A title is the name of the song, not the shop packaging.** Spotify hands over
"The Four Horsemen - Remastered" and "The Trooper (Original Album Version)".
Beyond being ugly in a setlist, no tablature site or archive.org item is
catalogued that way — the searches came back empty. `cleanTitle` drops only the
tail that is *purely* a qualifier (remaster, album version, live, feat.), so
"Sgt. Pepper - Reprise" and "Show Me How to Live" survive intact. It applies on
import, in searches, and once over what is already in the database.

**Guitar only.** The data model still has a progress row per instrument (the
Guitar Pro file carries every track), but the interface stopped asking: no
guitar/bass/drums tabs, and the daily queue filters to guitar. The track panel in
the Practice screen still shows any track on demand.

**Re-importing the same playlist updates the setlist.** A setlist remembers the
id of the Spotify playlist that created it. A second import syncs instead of
duplicating: whatever left the playlist leaves the setlist, whatever joined is
appended, and the order becomes the playlist's. Surviving rows keep their id, so
planned key and transition notes are not thrown away on every update.

**The renderer runs on `app://`, not `file://`.** Under `file://` the browser
blocks Web Workers and blobs, which alphaTab needs to lay the score out off the
main thread.

**One track at a time in the score.** Master of Puppets has 5 guitars across 425
bars; drawing them all takes ~27s and is unreadable. The default is the main
track for the chosen instrument, and the side panel adds the others on demand. A
normal-length song renders in ~2s.

**Guitar Pro text is recovered, not trusted.** GP3/GP4/GP5 store strings as raw
bytes in whatever code page the author's machine used — for Brazilian and
European tabs, almost always Windows-1252. alphaTab decodes as UTF-8, so every
one of those bytes becomes U+FFFD, in the score header and in every section
marker the importer copies into the database. Detection reads the *decoded
text*, not the bytes: a GP7 file really is UTF-8 and must be left alone, and a
byte heuristic cannot tell the two apart on a string as short as "Solo".

**Volume is levelled across sources.** FFmpeg measures EBU R128 loudness on
import (Master of Puppets came out at −16.0 LUFS; The Trooper, −9.3) and the app
compensates the gain, so switching source mid-loop does not make you jump.

**API keys live outside the database.** The database is your library — the file
you copy between machines. `safeStorage` ciphertext is bound to the OS user, so
keys stored inside it would decrypt to garbage on the other machine, with no way
to tell that apart from "wrong key". They live in `settings.json` next to it
instead. OAuth tokens are the exception and stay in the database: a token is
derivable — one click on Connect mints a new one — and an API key you pasted is
not.

---

## Layout

```
src/main/          main process: SQLite, IPC, importers, integrations
  db/              Drizzle schema, bootstrap DDL, queries
  importers/       Guitar Pro (headless alphaTab), audio (ffprobe), matcher
  media/ffmpeg.ts  tags, loudness, waveform, conversions
  services/        spotify, youtube, lrclib, lab, llm/, ytplayer
  settings*.ts     the settings store, its precedence rules and cache effects
  secretbox.ts     the one place that encrypts a value at rest
  practice/        spaced repetition, tempo ladder, mastery
src/shared/        imported by both processes — no electron, no DOM
  chords.ts        transposition, chord-track parsing, lab JSON validation
  tempo.ts         beat grid, snapping, the playhead inside an A–B loop
  cifra.ts         detected chords + synced lyrics → ChordPro
  sort.ts          list ordering (standard E pinned to the top)
  gp.ts            Guitar Pro text-encoding recovery
  i18n/            locale selection and the string catalogues
src/preload/       the typed bridge (contextBridge)
src/renderer/      React: design system + screens
lab/               Python sidecar (FastAPI + Demucs + librosa + basic-pitch + whisper)
scripts/           the test suite
```

The database lives at `%APPDATA%/guitarlab/guitarlab.db` — one file, back it up
by copying it.

---

## Tests

```bash
npm test        # typecheck plus the full battery
npm run test:ci # the subset that needs no keys, no GPU and no local library
```

Individual suites are listed in [CONTRIBUTING.md](CONTRIBUTING.md). They are
plain TypeScript, no framework, and several boot a real Electron instance and
drive the real app.

---

## Contributing

Pull requests are welcome — from developers and from guitarists. A good bug
report about how something feels while you are actually practising is worth as
much as a patch. See [CONTRIBUTING.md](CONTRIBUTING.md).

Particularly wanted right now: **translations** (the interface is still
Portuguese-only), **screenshots**, and **testing on Linux and macOS** — the app
has really only been exercised on Windows.

---

## Support

If GuitarLab is useful to you, you can [buy me a coffee on
Ko-fi](https://ko-fi.com/paulobrandaodev). Entirely optional, and it will never
gate a feature — this stays free and open source either way.

---

## Licence

MIT — see [LICENSE](LICENSE). Third-party components and their terms are listed
in [NOTICE](NOTICE), including why FFmpeg is deliberately *not* bundled.

GuitarLab does not distribute music, tablature, or any copyrighted material. It
organises files you already have.
