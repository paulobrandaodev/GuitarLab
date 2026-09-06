# Security Policy

## Supported versions

GuitarLab is pre-1.0. Only the latest release gets security fixes.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting instead:
[Security → Report a vulnerability](https://github.com/paulobrandaodev/GuitarLab/security/advisories/new).
That opens a private thread with the maintainer.

Please include what you did, what happened, and what you expected. A proof of
concept helps. Expect a first reply within about a week — this is a hobby
project maintained by one person.

## What GuitarLab does with your data

Worth knowing before you report, and worth reading if you are evaluating the app:

- **Everything is local.** The library lives in a single SQLite file under your
  user data folder. There is no GuitarLab server and no telemetry.
- **OAuth tokens are encrypted at rest** with Electron's `safeStorage` (DPAPI on
  Windows, Keychain on macOS, libsecret on Linux) in the `oauth_tokens` table.
  If the OS refuses to encrypt, the app stores nothing rather than writing a
  bearer token in cleartext.
- **API keys currently live in `.env`**, in plain text, like any other dotfile.
  Moving them into encrypted storage with a settings UI is planned.
- **The renderer is sandboxed**: `contextIsolation` on, `nodeIntegration` off, a
  strict CSP, and window-open handlers that refuse navigation. It talks to the
  main process only over a typed preload bridge.
- **Outbound requests** go only to the services you configure: Spotify, YouTube,
  your chosen AI provider, LRCLIB, MusicBrainz, archive.org, and the lab
  container on `127.0.0.1`. With an empty `.env`, only LRCLIB, MusicBrainz and
  archive.org are ever contacted, and only when you ask for them.
- **The lab container binds to `127.0.0.1` only** and is never exposed to the
  network.

## Scope

In scope: anything that lets a crafted file (Guitar Pro, audio, chord sheet) or
a malicious API response read or write outside the app's own folders, execute
code, or exfiltrate stored tokens.

Out of scope: the SmartScreen "unknown publisher" warning on the Windows
installer (the builds are unsigned — see the README), and vulnerabilities in
FFmpeg itself, which you install and update yourself.
