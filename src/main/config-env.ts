import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

/**
 * The half of the configuration that has no dependencies: the app identity, the
 * paths derived from it, and the `.env` file.
 *
 * This is split out of `config.ts` so the settings store can import it without
 * a cycle. `settings.ts` needs `userData` to find its file, and `config.ts`
 * needs `settings.ts` to resolve values — putting these here breaks the loop.
 *
 * Do not merge this back into `config.ts`. The `app.setName` call below has to
 * run before anything reads a path, and a cycle can silently reorder that.
 */

/**
 * Minimal .env reader. We do not use `dotenv` directly because the user's file
 * may carry inline `# comments` after values, which older parsers keep as part
 * of the value. Everything here is trimmed and comment-stripped defensively.
 */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(path)) return out
  const text = readFileSync(path, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()

    // strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    } else {
      // strip an inline comment only when preceded by whitespace, so that
      // values legitimately containing '#' (rare, but possible) survive
      const hash = value.search(/\s+#/)
      if (hash !== -1) value = value.slice(0, hash).trim()
    }
    if (key) out[key] = value
  }
  return out
}

/**
 * Project root: the directory holding .env and the media folders. Walk up from
 * the app path looking for a marker, because the starting directory differs
 * between `electron-vite dev`, a packaged build and one-off scripts.
 */
function findProjectRoot(): string {
  const candidates = [
    process.env.GUITARLAB_ROOT,
    // the variable this app shipped under before the rename
    process.env.SETLIST_LAB_ROOT,
    app.isPackaged ? join(process.resourcesPath, '..') : app.getAppPath(),
    process.cwd()
  ].filter(Boolean) as string[]

  for (const start of candidates) {
    let dir = resolve(start)
    for (let depth = 0; depth < 6; depth++) {
      if (existsSync(join(dir, '.env')) || existsSync(join(dir, 'gptabs'))) return dir
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  // nothing matched: fall back to the app path and let the folders be configured
  return resolve(app.isPackaged ? join(process.resourcesPath, '..') : app.getAppPath())
}

/*
 * Pin the app name before the first path is read from it.
 *
 * Electron derives the name from the nearest package.json, which resolves to
 * "Electron" when the built bundle is launched directly instead of through
 * electron-vite. That silently moves `userData` — and with it the database — to
 * a different folder, so the app comes up with an empty library. This module is
 * the first thing to read a path, so the name has to be set right here: doing it
 * in main/index.ts is too late, because its imports run first.
 */
export const APP_NAME = 'GuitarLab'
export const APP_SLUG = 'guitarlab'

/** What the app was called before the rename, and where its data still sits. */
export const LEGACY_SLUG = 'setlist-lab'

app.setName(APP_SLUG)

export const userData = app.getPath('userData')

/**
 * The pre-rename userData directory, so the database can be carried over.
 *
 * `userData` is `<appData>/<app name>`, so renaming the app moves it — and a
 * fresh empty library on the next launch is not an acceptable way to ship a new
 * name. `initDb` copies the old database across the first time it finds one
 * here and nothing at the new path.
 */
export const legacyUserData = join(dirname(userData), LEGACY_SLUG)

export const projectRoot = findProjectRoot()

/**
 * Where the media folders default to.
 *
 * In a checkout that is the repo root, which is what every script and every
 * `npm run dev` expects. In an installed build it must not be: `projectRoot`
 * there is the directory the installer wrote to, so the defaults would put a
 * user's music library and several gigabytes of stems inside the program
 * folder — somewhere nobody browses to, and somewhere an uninstall would be
 * entitled to delete.
 *
 * `Music/GuitarLab` is the answer for an installed app. It is still only a
 * default: the folders picked in Settings win, and so does anything in `.env`.
 */
export const mediaRoot = app.isPackaged
  ? join(app.getPath('music'), APP_NAME)
  : projectRoot

/** Everything in the `.env` file at the project root, parsed once. */
export const fileEnv = parseEnvFile(join(projectRoot, '.env'))
