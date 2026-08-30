"""Download and verify that the pinned Pocket TTS model and voice can load."""

from __future__ import annotations

import argparse
import json

from pocket_tts import TTSModel


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", default="english")
    parser.add_argument("--voice", default="peter_yearsley")
    args = parser.parse_args()
    model = TTSModel.load_model(language=args.language)
    model.get_state_for_audio_prompt(args.voice)
    print(
        json.dumps(
            {
                "ready": True,
                "engine": "pocket-tts",
                "language": args.language,
                "voice": args.voice,
                "sampleRate": model.sample_rate,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
