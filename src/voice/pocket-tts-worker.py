"""Long-lived, line-delimited JSON worker for the local Pocket TTS runtime."""

from __future__ import annotations

import argparse
import base64
import contextlib
import io
import json
import re
import sys
import traceback

import numpy as np
import torch
from pocket_tts import TTSModel
from scipy.io import wavfile


PROTOCOL_OUTPUT = sys.stdout
VOICE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
LANGUAGE_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
MAX_TEXT_CHARACTERS = 320


def emit(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":")), file=PROTOCOL_OUTPUT, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", required=True)
    parser.add_argument("--language", default="english")
    parser.add_argument("--threads", type=int, default=2)
    return parser.parse_args()


def encode_wave(audio: torch.Tensor, sample_rate: int) -> bytes:
    samples = audio.detach().cpu().numpy().reshape(-1).astype(np.float32)
    if samples.size == 0 or not np.all(np.isfinite(samples)):
        raise ValueError("Pocket TTS returned invalid audio samples.")
    pcm = np.rint(np.clip(samples, -1.0, 1.0) * 32767.0).astype(np.int16)
    output = io.BytesIO()
    wavfile.write(output, sample_rate, pcm)
    return output.getvalue()


def main() -> int:
    args = parse_args()
    if not VOICE_PATTERN.fullmatch(args.voice):
        raise ValueError("Voice name must contain only lowercase letters, digits, and underscores.")
    if not LANGUAGE_PATTERN.fullmatch(args.language):
        raise ValueError("Language must contain only lowercase letters, digits, underscores, and hyphens.")
    if not 1 <= args.threads <= 8:
        raise ValueError("Thread count must be between 1 and 8.")

    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    with contextlib.redirect_stdout(sys.stderr):
        model = TTSModel.load_model(language=args.language)
        voice_state = model.get_state_for_audio_prompt(args.voice)
    emit(
        {
            "type": "ready",
            "engine": "pocket-tts",
            "voice": args.voice,
            "language": args.language,
            "sampleRate": model.sample_rate,
        }
    )

    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            if request.get("op") == "shutdown":
                return 0
            if request.get("op") != "synthesize" or not isinstance(request_id, str):
                raise ValueError("Invalid Pocket TTS request envelope.")
            text = request.get("text")
            if not isinstance(text, str) or not text.strip():
                raise ValueError("Speech text must be a non-empty string.")
            if len(text) > MAX_TEXT_CHARACTERS:
                raise ValueError(f"Speech segment exceeds {MAX_TEXT_CHARACTERS} characters.")

            with contextlib.redirect_stdout(sys.stderr):
                audio = model.generate_audio(voice_state, text.strip())
            wave = encode_wave(audio, model.sample_rate)
            emit(
                {
                    "type": "result",
                    "id": request_id,
                    "waveBase64": base64.b64encode(wave).decode("ascii"),
                }
            )
        except Exception as error:  # The parent needs a structured failure, not a dead worker.
            traceback.print_exc(file=sys.stderr)
            emit(
                {
                    "type": "error",
                    "id": request_id,
                    "code": "POCKET_TTS_GENERATION_ERROR",
                    "message": str(error)[:500],
                }
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
