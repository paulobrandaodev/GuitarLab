"""
GuitarLab — audio analysis sidecar.

Runs the heavy models: Demucs for stem separation, librosa for tempo, beats and
chord/key estimation, basic-pitch for audio-to-MIDI and faster-whisper for lyric
timing.

Everything is a background job with progress, because separating an 8-minute
track is not an HTTP-request-shaped operation.

This used to run inside a CUDA container. It is now a child process the app
starts out of a venv it built itself, which is why there is no longer any path
translation here: the caller and this process see the same filesystem, so a
path that arrives is a path that can be opened.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="GuitarLab Lab", version="0.2.0")

# No default. Guessing a directory here would mean silently writing several
# gigabytes of stems somewhere the app will never look for them.
_stems = os.environ.get("STEMS_DIR")
if not _stems:
    raise RuntimeError("STEMS_DIR não foi definido — quem inicia o lab precisa passá-lo")
STEM_DIR = Path(_stems)
STEM_DIR.mkdir(parents=True, exist_ok=True)

MODELS_DIR = Path(os.environ.get("TORCH_HOME", STEM_DIR.parent / "lab-models"))
# One empty file per model that finished downloading. Demucs stores its weights
# under hashed filenames from a remote bag definition, so there is no reliable
# way to ask "is htdemucs_6s here?" offline. Recording it ourselves is honest
# and survives a restart.
FETCHED_DIR = MODELS_DIR / ".fetched"
FETCHED_DIR.mkdir(parents=True, exist_ok=True)


def resolve_audio(p: str) -> Path:
    """Normalise a path from the app. Same filesystem, so nothing to translate."""
    return Path(p.replace("\\", "/"))


def _watch_parent() -> None:
    """
    Exit when the app that started this process is gone.

    `before-quit` covers the normal case, but an Electron crash or a kill -9
    leaves this process holding several gigabytes of VRAM with nothing left to
    talk to it. Polling the parent pid is crude and completely reliable.
    """
    raw = os.environ.get("GUITARLAB_PARENT_PID")
    if not raw or not raw.isdigit():
        return
    parent = int(raw)
    while True:
        time.sleep(5)
        try:
            if os.name == "nt":
                import ctypes

                handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, parent)
                if not handle:
                    break
                ctypes.windll.kernel32.CloseHandle(handle)
            else:
                os.kill(parent, 0)
        except (OSError, ProcessLookupError):
            break
    os._exit(0)


threading.Thread(target=_watch_parent, daemon=True).start()


def _register_cuda_libraries() -> None:
    """
    Put the CUDA libraries that ship inside the torch wheels on the loader path.

    faster-whisper runs on CTranslate2, which links cuDNN and cuBLAS directly
    rather than through torch. Under the old container those libraries were part
    of the base image and simply on the path. Installed as `nvidia-*-cu12`
    wheels they land in `site-packages/nvidia/*/bin` instead, where nothing
    looks for them — so the GPU transcription failed to load its own DLLs while
    torch, which resolves them itself, worked fine two functions away.
    """
    import site

    roots: list[Path] = []
    for base in site.getsitepackages() + [site.getusersitepackages()]:
        nvidia = Path(base) / "nvidia"
        if nvidia.is_dir():
            roots.append(nvidia)

    subdir = "bin" if os.name == "nt" else "lib"
    found: list[str] = []
    for root in roots:
        for lib in sorted(root.glob(f"*/{subdir}")):
            found.append(str(lib))

    if not found:
        return
    if os.name == "nt":
        for path in found:
            try:
                os.add_dll_directory(path)
            except OSError:
                pass
    else:
        existing = os.environ.get("LD_LIBRARY_PATH", "")
        os.environ["LD_LIBRARY_PATH"] = os.pathsep.join([*found, existing]).strip(os.pathsep)


_register_cuda_libraries()


# --------------------------------------------------------------------- jobs


@dataclass
class Job:
    id: str
    type: str
    status: str = "queued"
    progress: float = 0.0
    result: dict[str, Any] | None = None
    error: str | None = None
    logs: list[str] = field(default_factory=list)


JOBS: dict[str, Job] = {}
JOBS_LOCK = threading.Lock()


def run_job(job: Job, fn: Callable[[Job], dict[str, Any]]) -> None:
    def target() -> None:
        job.status = "running"
        try:
            job.result = fn(job)
            job.progress = 1.0
            job.status = "done"
        except Exception as exc:  # noqa: BLE001 - surfaced to the client verbatim
            job.status = "error"
            job.error = f"{type(exc).__name__}: {exc}"
            job.logs.append(traceback.format_exc()[-2000:])

    threading.Thread(target=target, daemon=True).start()


def new_job(job_type: str, fn: Callable[[Job], dict[str, Any]]) -> Job:
    job = Job(id=uuid.uuid4().hex, type=job_type)
    with JOBS_LOCK:
        JOBS[job.id] = job
    run_job(job, fn)
    return job


# ------------------------------------------------------------------- health


def gpu_info() -> tuple[bool, str | None]:
    try:
        import torch

        if torch.cuda.is_available():
            return True, torch.cuda.get_device_name(0)
        return False, None
    except Exception:  # noqa: BLE001
        return False, None


@app.get("/health")
def health() -> dict[str, Any]:
    cuda, gpu = gpu_info()
    models: list[str] = []
    for name, module in [
        ("demucs", "demucs"),
        ("librosa", "librosa"),
        ("basic-pitch", "basic_pitch"),
        ("faster-whisper", "faster_whisper"),
    ]:
        try:
            __import__(module)
            models.append(name)
        except Exception:  # noqa: BLE001
            pass
    return {
        "ok": True,
        "cuda": cuda,
        "gpu": gpu,
        "models": models,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "python": sys.version.split()[0],
        "stems_dir": str(STEM_DIR),
        "models_dir": str(MODELS_DIR),
    }


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "job desconhecido")
    return {
        "job_id": job.id,
        "type": job.type,
        "status": job.status,
        "progress": job.progress,
        "result": job.result,
        "error": job.error,
    }


# -------------------------------------------------------------------- stems


class StemsRequest(BaseModel):
    audio_path: str
    model: str = "htdemucs_6s"
    segment: int = 7
    out_dir: str | None = None


STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"]


@app.post("/stems")
def stems(req: StemsRequest) -> dict[str, str]:
    audio = resolve_audio(req.audio_path)
    if not audio.exists():
        raise HTTPException(400, f"arquivo não encontrado: {audio}")

    def work(job: Job) -> dict[str, Any]:
        # `out_dir` used to be sent and ignored, which meant the app could not
        # actually choose where stems landed. It is the caller's stems folder.
        root = Path(req.out_dir) if req.out_dir else STEM_DIR
        out_root = root / audio.stem
        out_root.mkdir(parents=True, exist_ok=True)

        cuda, _ = gpu_info()
        cmd = [
            # Not the string "python": inside a venv there may be no `python` on
            # PATH at all, and if there is one it is the wrong interpreter with
            # none of these packages in it.
            sys.executable, "-m", "demucs.separate",
            "-n", req.model,
            "--out", str(out_root),
            # FLAC keeps the stems lossless at roughly half the size of wav
            "--flac",
            "-d", "cuda" if cuda else "cpu",
        ]
        # Long tracks blow past 8 GB of VRAM without chunking; Master of Puppets
        # at 8:35 is exactly that case.
        if req.segment:
            cmd += ["--segment", str(req.segment)]
        cmd.append(str(audio))

        job.logs.append(" ".join(cmd))
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, env={**os.environ, "PYTORCH_NO_CUDA_MEMORY_CACHING": "1"},
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if line:
                job.logs.append(line[-200:])
            # demucs prints a percentage as it goes
            if "%" in line:
                for token in line.replace("|", " ").split():
                    if token.endswith("%"):
                        try:
                            job.progress = min(0.99, float(token[:-1]) / 100)
                        except ValueError:
                            pass
                        break
        code = proc.wait()

        if code != 0 and cuda:
            # a CUDA OOM should degrade to CPU rather than fail the job
            job.logs.append("falhou na GPU, tentando CPU")
            cpu_cmd = [c if c != "cuda" else "cpu" for c in cmd]
            code = subprocess.call(cpu_cmd)

        if code != 0:
            raise RuntimeError(f"demucs saiu com código {code}: {job.logs[-1] if job.logs else ''}")

        produced: dict[str, str] = {}
        for path in out_root.rglob("*.flac"):
            name = path.stem.lower()
            if name in STEM_NAMES:
                produced[name] = str(path)
        if not produced:
            raise RuntimeError("demucs terminou mas nenhum stem foi encontrado")
        return {"stems": produced, "model": req.model}

    return {"job_id": new_job("stems", work).id}


# ------------------------------------------------------------------- rhythm


class AudioRequest(BaseModel):
    audio_path: str


@app.post("/rhythm")
def rhythm(req: AudioRequest) -> dict[str, str]:
    audio = resolve_audio(req.audio_path)
    if not audio.exists():
        raise HTTPException(400, f"arquivo não encontrado: {audio}")

    def work(job: Job) -> dict[str, Any]:
        import librosa
        import numpy as np

        job.progress = 0.1
        y, sr = librosa.load(str(audio), mono=True)
        job.progress = 0.5

        tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
        onset = librosa.onset.onset_strength(y=y, sr=sr)
        job.progress = 0.9

        bpm = float(np.atleast_1d(tempo)[0])
        return {
            "bpm": round(bpm, 2),
            "beats": [round(float(b), 4) for b in beats],
            "beat_count": len(beats),
            "duration": round(float(len(y) / sr), 2),
            "onset_mean": round(float(onset.mean()), 4),
        }

    return {"job_id": new_job("rhythm", work).id}


# ------------------------------------------------------------------ harmony

# Krumhansl-Schmuckler profiles for key estimation
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
PITCHES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Chord templates as pitch-class offsets from the root. Kept small on purpose:
# every extra quality is another way for the matcher to be confidently wrong,
# and a guitarist reading along wants the shape, not the exact voicing.
CHORD_TEMPLATES: list[tuple[str, tuple[int, ...]]] = [
    ("", (0, 4, 7)),        # major
    ("m", (0, 3, 7)),       # minor
    ("7", (0, 4, 7, 10)),   # dominant 7
    ("m7", (0, 3, 7, 10)),
    ("maj7", (0, 4, 7, 11)),
    ("5", (0, 7)),          # power chord — half of a metal riff is this
]

# What it costs to change chord between two beats, in the same units as the
# cosine score below. This is what stops the labels from flickering between
# relative major/minor every other beat.
#
# Calibrated against synthetic beat-chroma (a I-vi-IV-V loop plus noise): the
# useful band is 0.2-0.3. Below it the track fragments — twice as many changes
# as there are chords — and above ~0.6 long chords swallow the short ones until,
# by 1.6, the whole song decodes as a single chord. 0.25 holds up from a clean
# signal (99% of beats right) to a heavily distorted one.
CHANGE_PENALTY = 0.25
# Below this share of the frame's energy there is no chord being played.
SILENCE_FLOOR = 0.04


def _build_templates() -> tuple[list[str], "np.ndarray"]:  # type: ignore[name-defined]
    import numpy as np

    labels: list[str] = []
    rows: list[list[float]] = []
    for root in range(12):
        for suffix, offsets in CHORD_TEMPLATES:
            vec = [0.0] * 12
            for off in offsets:
                vec[(root + off) % 12] = 1.0
            labels.append(f"{PITCHES[root]}{suffix}")
            rows.append(vec)
    matrix = np.array(rows, dtype=float)
    # unit rows so the score below is a plain cosine similarity
    matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
    return labels, matrix


def _decode_chords(scores: "np.ndarray") -> list[int]:  # type: ignore[name-defined]
    """Viterbi over chord candidates: best path, not best guess per beat.

    Frame-by-frame argmax gives a chord track that changes on almost every beat.
    A flat penalty on changing chord turns it into the blocks a player reads.
    """
    import numpy as np

    n_frames, n_states = scores.shape
    if n_frames == 0:
        return []

    total = scores[0].copy()
    back = np.zeros((n_frames, n_states), dtype=int)
    for t in range(1, n_frames):
        stay = total
        best_prev = int(np.argmax(total))
        switch = total[best_prev] - CHANGE_PENALTY
        # staying beats switching only when this state is already the best one
        take_switch = switch > stay
        back[t] = np.where(take_switch, best_prev, np.arange(n_states))
        total = np.where(take_switch, switch, stay) + scores[t]

    path = [int(np.argmax(total))]
    for t in range(n_frames - 1, 0, -1):
        path.append(int(back[t][path[-1]]))
    path.reverse()
    return path


@app.post("/harmony")
def harmony(req: AudioRequest) -> dict[str, str]:
    audio = resolve_audio(req.audio_path)
    if not audio.exists():
        raise HTTPException(400, f"arquivo não encontrado: {audio}")

    def work(job: Job) -> dict[str, Any]:
        import librosa
        import numpy as np

        job.progress = 0.1
        y, sr = librosa.load(str(audio), mono=True)
        duration = float(len(y) / sr)
        job.progress = 0.3

        # percussion smears the chroma; the harmonic part is what carries chords
        y_harm = librosa.effects.harmonic(y, margin=3.0)
        chroma = librosa.feature.chroma_cqt(y=y_harm, sr=sr)
        job.progress = 0.6

        # ---- key, from the average chroma over the whole track
        mean = chroma.mean(axis=1)
        mean = mean / (mean.sum() or 1)
        best = ("C", 0.0, "major")
        for i in range(12):
            rotated = np.roll(mean, -i)
            maj = float(np.corrcoef(rotated, MAJOR_PROFILE)[0, 1])
            minr = float(np.corrcoef(rotated, MINOR_PROFILE)[0, 1])
            if maj > best[1]:
                best = (PITCHES[i], maj, "major")
            if minr > best[1]:
                best = (PITCHES[i], minr, "minor")
        key_name = best[0] if best[2] == "major" else f"{best[0]}m"

        # ---- beats, so every chord starts where the player counts it
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        job.progress = 0.75

        n_frames = chroma.shape[1]
        if len(beat_frames) < 2:
            # no usable beat grid: fall back to a fixed half-second frame
            step = max(1, int(librosa.time_to_frames(0.5, sr=sr)))
            beat_frames = np.arange(0, n_frames, step)

        # `bounds` closes the grid at both ends, so each aggregated column has a
        # start and an end time and nothing is off by one segment.
        bounds = librosa.util.fix_frames(beat_frames, x_min=0, x_max=n_frames)
        sync = librosa.util.sync(chroma, bounds, aggregate=np.median, pad=False)
        edges = [float(t) for t in librosa.frames_to_time(bounds, sr=sr)]

        energy = sync.sum(axis=0)
        peak = float(energy.max() or 1.0)
        norms = np.linalg.norm(sync, axis=0)
        norms[norms == 0] = 1.0
        unit = (sync / norms).T  # segments x 12

        labels, templates = _build_templates()
        scores = unit @ templates.T  # frames x chords, cosine similarity
        path = _decode_chords(scores)

        # ---- segments -> spans, merging the repeats
        spans: list[dict[str, Any]] = []
        for i, state in enumerate(path):
            if i + 1 >= len(edges):
                break
            silent = float(energy[i]) < SILENCE_FLOOR * peak
            label = "N" if silent else labels[state]
            confidence = 0.0 if silent else float(scores[i][state])
            start_ms = int(round(edges[i] * 1000))
            end_ms = int(round(min(edges[i + 1], duration) * 1000))
            if spans and spans[-1]["label"] == label:
                spans[-1]["endMs"] = end_ms
                spans[-1]["confidence"] = max(spans[-1]["confidence"], round(confidence, 3))
            else:
                spans.append(
                    {
                        "label": label,
                        "startMs": start_ms,
                        "endMs": end_ms,
                        "confidence": round(confidence, 3),
                    }
                )
        job.progress = 0.95

        return {
            "key": key_name,
            "mode": best[2],
            "confidence": round(best[1], 3),
            "bpm": round(float(np.atleast_1d(tempo)[0]), 2),
            "beats": [int(round(e * 1000)) for e in edges],
            "chords": spans,
            "chord_count": len(spans),
            "chroma_mean": [round(float(v), 4) for v in mean],
        }

    return {"job_id": new_job("harmony", work).id}


# --------------------------------------------------------------- transcribe


@app.post("/transcribe")
def transcribe(req: AudioRequest) -> dict[str, str]:
    audio = resolve_audio(req.audio_path)
    if not audio.exists():
        raise HTTPException(400, f"arquivo não encontrado: {audio}")

    def work(job: Job) -> dict[str, Any]:
        from basic_pitch.inference import predict_and_save
        from basic_pitch import ICASSP_2022_MODEL_PATH

        out = STEM_DIR / audio.stem / "midi"  # noqa: E501
        out.mkdir(parents=True, exist_ok=True)
        job.progress = 0.2
        predict_and_save(
            [str(audio)], str(out),
            save_midi=True, sonify_midi=False,
            save_model_outputs=False, save_notes=False,
            model_or_model_path=ICASSP_2022_MODEL_PATH,
        )
        job.progress = 0.95
        midis = [str(p) for p in out.glob("*.mid")]
        return {"midi": midis}

    return {"job_id": new_job("transcribe", work).id}


# ------------------------------------------------------------------- lyrics


class LyricsRequest(BaseModel):
    audio_path: str
    model_size: str = "small"
    language: str | None = None


def _fmt_lrc_time(seconds: float) -> str:
    minutes = int(seconds // 60)
    rest = seconds - minutes * 60
    return f"[{minutes:02d}:{rest:05.2f}]"


@app.post("/lyrics")
def lyrics(req: LyricsRequest) -> dict[str, str]:
    audio = resolve_audio(req.audio_path)
    if not audio.exists():
        raise HTTPException(400, f"arquivo não encontrado: {audio}")

    def work(job: Job) -> dict[str, Any]:
        from faster_whisper import WhisperModel

        cuda, _ = gpu_info()
        model = WhisperModel(
            req.model_size,
            device="cuda" if cuda else "cpu",
            compute_type="float16" if cuda else "int8",
        )
        job.progress = 0.2
        segments, info = model.transcribe(str(audio), language=req.language, vad_filter=True)

        lines: list[str] = []
        plain: list[str] = []
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            lines.append(f"{_fmt_lrc_time(seg.start)}{text}")
            plain.append(text)
            job.progress = min(0.95, 0.2 + len(lines) / 200)

        return {
            "lrc": "\n".join(lines),
            "plain": "\n".join(plain),
            "language": info.language,
            "line_count": len(lines),
        }

    return {"job_id": new_job("lyrics", work).id}


# ------------------------------------------------------------------- models


def _fetched_marker(family: str, name: str) -> Path:
    return FETCHED_DIR / f"{family}-{name}"


@app.get("/models")
def models_installed() -> dict[str, Any]:
    """Which weights are already on disk, so the UI can hide the download."""
    return {
        "installed": sorted(p.name for p in FETCHED_DIR.glob("*") if p.is_file()),
        "dir": str(MODELS_DIR),
    }


class ModelRequest(BaseModel):
    family: str
    name: str


@app.post("/models/fetch")
def fetch_model(req: ModelRequest) -> dict[str, str]:
    """
    Pull one model ahead of time.

    There is no download API in either library — the weights arrive as a side
    effect of constructing the model — so that is exactly what this does. The
    point is not speed, it is that a first-time user can spend the 320 MB
    deliberately, watching a progress bar, instead of discovering it when their
    first separation appears to hang for ten minutes.
    """
    if req.family not in ("demucs", "whisper"):
        raise HTTPException(400, f"família desconhecida: {req.family}")

    def work(job: Job) -> dict[str, Any]:
        job.progress = 0.1
        if req.family == "demucs":
            from demucs.pretrained import get_model

            get_model(req.name)
        else:
            from faster_whisper import WhisperModel

            # CPU here regardless of the GPU: this only has to touch the files
            # to make the library download them.
            WhisperModel(req.name, device="cpu", compute_type="int8")

        job.progress = 0.95
        _fetched_marker(req.family, req.name).touch()
        return {"family": req.family, "name": req.name}

    return {"job_id": new_job("models", work).id}
