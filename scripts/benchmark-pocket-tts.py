"""Generate identical Pocket TTS auditions and report objective pitch/latency data."""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import numpy as np
from pocket_tts import TTSModel
from scipy.io import wavfile
from scipy.signal import correlate


DEFAULT_VOICES = (
    "bill_boerst",
    "charles",
    "george",
    "javert",
    "michael",
    "paul",
    "peter_yearsley",
    "stuart_bell",
)


def median_pitch_hz(audio: np.ndarray, sample_rate: int) -> float | None:
    """Estimate median voiced-frame F0 with normalized autocorrelation."""
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    frame_length = int(sample_rate * 0.04)
    hop_length = int(sample_rate * 0.02)
    minimum_lag = max(1, sample_rate // 260)
    maximum_lag = min(frame_length - 1, sample_rate // 60)
    pitches: list[float] = []

    for start in range(0, max(0, samples.size - frame_length), hop_length):
        frame = samples[start : start + frame_length]
        frame = frame - np.mean(frame)
        rms = float(np.sqrt(np.mean(frame * frame)))
        if rms < 0.012:
            continue
        windowed = frame * np.hanning(frame.size)
        autocorrelation = correlate(windowed, windowed, mode="full", method="fft")
        autocorrelation = autocorrelation[autocorrelation.size // 2 :]
        if autocorrelation[0] <= 0:
            continue
        normalized = autocorrelation / autocorrelation[0]
        search = normalized[minimum_lag : maximum_lag + 1]
        if search.size == 0:
            continue
        lag = int(np.argmax(search)) + minimum_lag
        if normalized[lag] >= 0.35:
            pitches.append(sample_rate / lag)

    return float(np.median(pitches)) if pitches else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--voice", action="append", dest="voices")
    parser.add_argument("--language", default="english")
    parser.add_argument(
        "--text",
        default=(
            "The machine is ready. I will handle the work, verify the result, "
            "and tell you the truth without wasting your time."
        ),
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    started = time.perf_counter()
    model = TTSModel.load_model(language=args.language)
    model_load_seconds = time.perf_counter() - started
    results = []

    for voice in args.voices or DEFAULT_VOICES:
        voice_started = time.perf_counter()
        voice_state = model.get_state_for_audio_prompt(voice)
        voice_load_seconds = time.perf_counter() - voice_started
        generation_started = time.perf_counter()
        audio = model.generate_audio(voice_state, args.text).detach().cpu().numpy()
        generation_seconds = time.perf_counter() - generation_started
        output_path = args.output / f"pocket-{voice}.wav"
        wavfile.write(output_path, model.sample_rate, audio)
        duration_seconds = len(audio) / model.sample_rate
        results.append(
            {
                "voice": voice,
                "sampleRate": model.sample_rate,
                "durationSeconds": round(duration_seconds, 3),
                "voiceLoadSeconds": round(voice_load_seconds, 3),
                "generationSeconds": round(generation_seconds, 3),
                "realTimeFactor": round(generation_seconds / duration_seconds, 3),
                "medianPitchHz": round(median_pitch_hz(audio, model.sample_rate) or 0, 1),
                "path": str(output_path.resolve()),
            }
        )

    print(
        json.dumps(
            {
                "engine": "pocket-tts",
                "version": "3.0.2",
                "language": args.language,
                "modelLoadSeconds": round(model_load_seconds, 3),
                "results": results,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    raise SystemExit(main())
