import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { statSync } from 'node:fs'
import { config } from '../config'
import type { AudioProbe } from '@shared/types'

const exec = promisify(execFile)

const BIG_BUFFER = { maxBuffer: 32 * 1024 * 1024 }

let _cachedVersion: string | null | undefined

/** Returns the ffmpeg version string, or null when ffmpeg is not usable. */
export async function ffmpegVersion(): Promise<string | null> {
  if (_cachedVersion !== undefined) return _cachedVersion
  try {
    const { stdout } = await exec(config.ffmpeg.path, ['-version'], BIG_BUFFER)
    _cachedVersion = stdout.split('\n')[0]?.trim() ?? 'unknown'
  } catch {
    _cachedVersion = null
  }
  return _cachedVersion
}

/**
 * Forget the memoised version string.
 *
 * `ffmpegVersion` caches because it spawns a process, but the path it spawns is
 * now user-editable: after someone points FFMPEG_PATH at a real binary, the
 * cached null would keep the app insisting FFmpeg is missing.
 */
export function resetFfmpegCache(): void {
  _cachedVersion = undefined;
}

export async function ffmpegAvailable(): Promise<boolean> {
  return (await ffmpegVersion()) !== null
}

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  sample_rate?: string
  channels?: number
  bit_rate?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: {
    duration?: string
    bit_rate?: string
    tags?: Record<string, string>
  }
}

/** Tag keys vary by container (ID3 vs RIFF INFO vs Vorbis); look them up case-insensitively. */
function pickTag(tags: Record<string, string>, ...names: string[]): string | undefined {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(tags)) lower[k.toLowerCase()] = v
  for (const n of names) {
    const v = lower[n.toLowerCase()]
    if (v && v.trim()) return v.trim()
  }
  return undefined
}

export async function probeAudio(path: string): Promise<AudioProbe> {
  const { stdout } = await exec(
    config.ffmpeg.probePath,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', path],
    BIG_BUFFER
  )
  const data = JSON.parse(stdout) as FfprobeOutput
  const audio = (data.streams ?? []).find((s) => s.codec_type === 'audio')
  if (!audio) throw new Error(`Nenhuma trilha de áudio encontrada em ${path}`)

  const tags = data.format?.tags ?? {}
  const durationSec = Number.parseFloat(data.format?.duration ?? '0')
  const bitrate = Number.parseInt(audio.bit_rate ?? data.format?.bit_rate ?? '0', 10)

  return {
    path,
    durationMs: Math.round(durationSec * 1000),
    sampleRate: Number.parseInt(audio.sample_rate ?? '0', 10),
    channels: audio.channels ?? 0,
    codec: audio.codec_name ?? 'unknown',
    bitrateKbps: Number.isFinite(bitrate) && bitrate > 0 ? Math.round(bitrate / 1000) : null,
    bytes: statSync(path).size,
    tags: {
      title: pickTag(tags, 'title', 'INAM'),
      artist: pickTag(tags, 'artist', 'IART'),
      album: pickTag(tags, 'album', 'IPRD'),
      albumArtist: pickTag(tags, 'album_artist', 'albumartist'),
      genre: pickTag(tags, 'genre', 'IGNR'),
      date: pickTag(tags, 'date', 'year', 'ICRD'),
      track: pickTag(tags, 'track', 'IPRT')
    }
  }
}

/**
 * Integrated loudness in LUFS via the EBU R128 filter. Used to gain-match the
 * GP synth, stems, YouTube and Spotify so switching source mid-loop keeps level.
 * Returns null when the measurement cannot be parsed rather than throwing —
 * a missing loudness value only costs auto-leveling, not playback.
 */
export async function measureLoudness(path: string): Promise<number | null> {
  try {
    // loudnorm prints its JSON summary on stderr
    const { stderr } = await exec(
      config.ffmpeg.path,
      ['-hide_banner', '-nostats', '-i', path, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
      { ...BIG_BUFFER, windowsHide: true }
    ).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? '' }))

    const match = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as { input_i?: string }
    const lufs = Number.parseFloat(parsed.input_i ?? '')
    return Number.isFinite(lufs) ? lufs : null
  } catch {
    return null
  }
}

/**
 * Decode to mono f32 PCM at `sampleRate` and reduce to `buckets` peak pairs for
 * waveform drawing. Doing this once at import keeps the renderer from ever
 * having to decode a 90 MB wav just to draw a timeline.
 */
export async function generateWaveformPeaks(
  path: string,
  buckets = 2000,
  sampleRate = 8000
): Promise<{ peaks: number[]; buckets: number }> {
  const { stdout } = await exec(
    config.ffmpeg.path,
    [
      '-hide_banner', '-nostats', '-v', 'quiet',
      '-i', path,
      '-ac', '1',
      '-ar', String(sampleRate),
      '-f', 'f32le',
      '-'
    ],
    { ...BIG_BUFFER, maxBuffer: 512 * 1024 * 1024, encoding: 'buffer', windowsHide: true }
  )

  const buf = stdout as unknown as Buffer
  const total = Math.floor(buf.length / 4)
  if (total === 0) return { peaks: [], buckets: 0 }

  const per = Math.max(1, Math.floor(total / buckets))
  const peaks: number[] = []
  for (let b = 0; b < buckets; b++) {
    const start = b * per
    if (start >= total) break
    const end = Math.min(start + per, total)
    let max = 0
    for (let i = start; i < end; i++) {
      const v = Math.abs(buf.readFloatLE(i * 4))
      if (v > max) max = v
    }
    peaks.push(Math.round(Math.min(1, max) * 1000) / 1000)
  }
  return { peaks, buckets: peaks.length }
}

/** Convert any audio to 44.1k stereo wav — the format the lab container expects. */
export async function toWav(input: string, output: string): Promise<void> {
  await exec(
    config.ffmpeg.path,
    ['-hide_banner', '-v', 'quiet', '-y', '-i', input, '-ac', '2', '-ar', '44100', output],
    { ...BIG_BUFFER, windowsHide: true }
  )
}

/** Compress a separated stem to FLAC: lossless at roughly half the size of wav. */
export async function toFlac(input: string, output: string): Promise<void> {
  await exec(
    config.ffmpeg.path,
    ['-hide_banner', '-v', 'quiet', '-y', '-i', input, '-c:a', 'flac', '-compression_level', '5', output],
    { ...BIG_BUFFER, windowsHide: true }
  )
}
