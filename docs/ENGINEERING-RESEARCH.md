# Engineering research record

Research date: 2026-08-30. Sources are primary project repositories or official
documentation. This document records decisions, rejected shortcuts, licensing, and
machine constraints so implementation does not drift toward guesswork.

## Target machine constraints

- Windows 11 Home Single Language, x64, build 10.0.26200
- Intel Core i3-1115G4, 2 physical cores and 4 logical processors
- Approximately 8 GB RAM and Intel integrated graphics
- Node.js 24.11.1, npm 11.6.2, PowerShell 7.6.4, Python 3.13.5, Rust 1.88
- Working microphone array and speakers; one 1536 by 864 display
- No NVIDIA GPU, ffmpeg, or Tesseract; Blender 5.2.1 LTS remains installed globally
  but is no longer used by this project
- Ollama 0.33.2 is installed and gpt-oss:120b-cloud is available

This rules out an architecture that keeps several large neural models resident or
assumes CUDA. Native workers must be optional, lazily loaded, cancellable, and
benchmarked for real-time factor and peak resident memory on this machine.

## Model transport

The configured brain remains gpt-oss:120b-cloud through the local Ollama API.
Ollama documents cloud models as offloaded to Ollama Cloud, and the model page marks
this exact tag as cloud. It therefore needs an Ollama account/network and is not the
same as local 120B inference. The model boundary stays replaceable so the agent is
not structurally dependent on cloud inference and can gain a smaller local fallback.

Sources:

- [Ollama Cloud documentation](https://docs.ollama.com/cloud)
- [gpt-oss:120b-cloud model page](https://ollama.com/library/gpt-oss%3A120b-cloud)

## Desktop shell — rejected and removed

The Electron pet, transient popover, pixel/skull renderer, 3D embodiment, Blender
pipeline, and embodiment MCP were evaluated and rejected. Their source, assets,
dependencies, generated output, tests, and implementation documents are not part of
the current repository. The active product surface is terminal-only. Any future UI
requires a new design decision and cannot treat the rejected work as a foundation.

## Prompt and response surface

The current prompt, response, status, and approval surface is the terminal. It uses
line-oriented commands and explicit `y`/`yes` authorization. There is no graphical
composer or transcript surface.

## Conversational audio

Decision: separate capture, VAD, STT, and TTS providers behind stable interfaces.
Microphone capture never waits for model or speech synthesis work. Input stays live
while output plays so speech onset can stop playback and abort the current agent
turn. A short prefix ring buffer prevents the first phoneme from being clipped.

State is intentionally orthogonal: service, turn, audio input, and audio output may
change independently. This matches real barge-in behavior better than a single
listening/thinking/speaking enum.

Measured stack:

- Silero VAD: MIT, small ONNX model, 8 kHz and 16 kHz support.
- whisper.cpp: MIT, CPU-friendly C/C++ Whisper implementation with quantization.
- Pocket TTS 3.0.2: MIT code, a 100M CPU-oriented model, streaming APIs, and
  voice conditioning. Model weights are CC BY 4.0; the selected Peter Yearsley
  source recording in the official voice-zero catalog is CC0.
- Kokoro 82M: Apache-2.0 alternative benchmarked for natural English speech.
- Chatterbox Nano: MIT alternative benchmarked with zero-shot voice conditioning.
- Qwen3-TTS 0.6B: Apache-2.0 instruction-controlled candidate rejected for this
  machine's 8 GB CPU-only envelope.
- OHF Piper: GPL-3.0 current upstream and an Indonesian id_ID voice. It can be an
  optional compliant adapter, not silently embedded under a permissive claim.

No engine wins by README. The spike must measure first-token latency, real-time
factor, peak memory, cancellation latency, and Indonesian/English intelligibility on
this computer. Voice model files need a manifest containing source, exact revision,
license, SHA-256, language, and sample rate.

Implemented evidence:

- whisper.cpp v1.8.6 Windows x64 release archive and multilingual Whisper base model
  are exact-revision pinned and SHA-256 verified by the installer.
- The 11-second upstream JFK WAV fixture at whisper.cpp commit 23ee035, SHA-256
  59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e,
  transcribed correctly in 6.124 seconds on this machine. This includes cold CLI and
  model startup and is a 0.557 real-time factor.
- Pocket TTS standard with Peter Yearsley measured 88.2 Hz median pitch and 1.211
  real-time factor on the identical audition line. Its cold load was 23.056 seconds;
  the provider therefore uses one persistent worker and reuses it.
- Pocket's 24-layer model measured 3.492 RTF, Chatterbox Nano measured 12.677 RTF,
  and full-precision Kokoro voices measured 2.134-2.282 RTF with roughly 200-222 Hz
  median pitch. Those candidates fail either interaction latency or the requested
  bass aesthetic on this machine and are not the production engine.
- The old Supertonic path was removed after live listening exposed that its measured
  speed did not translate to acceptable naturalness. Subjective audition remains a
  release gate; latency and pitch metrics alone do not establish voice quality.
- The Pocket worker smoke test generates a valid bounded PCM16 WAVE payload and the
  cancellation tests verify that barge-in terminates in-flight inference.
- Live microphone, echo/barge-in, Indonesian accuracy, memory, and the required
  second-provider comparison remain open exit criteria.

Sources:

- [Silero VAD](https://github.com/snakers4/silero-vad)
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts)
- [Pocket TTS model card](https://huggingface.co/kyutai/pocket-tts)
- [Kyutai voice catalog and licenses](https://huggingface.co/kyutai/tts-voices)
- [Chatterbox](https://github.com/resemble-ai/chatterbox)
- [Kokoro](https://github.com/hexgrad/kokoro)
- [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M)
- [OHF Piper](https://github.com/OHF-voice/piper1-gpl)
- [Piper voices](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md)
- [LiveKit Agents](https://github.com/livekit/agents)
- [Pipecat](https://github.com/pipecat-ai/pipecat)

## Screen capture and OCR

No capture provider is currently admitted. A future implementation must use an
explicit Windows screen/window capture boundary and bounded image jobs. Tesseract 5
is the lightweight Apache-2.0 baseline. PaddleOCR is a heavier Apache-2.0 optional
provider only if benchmarks justify its quality and resource cost.

Captures are observations, not trusted instructions. OCR text is marked with source
coordinates and time, passed to the model as untrusted data, and never converted
directly into an action without the normal tool and approval path.

Sources:

- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)
- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)
- [PowerToys Text Extractor design](https://github.com/microsoft/PowerToys/blob/main/doc/devdocs/modules/textextractor.md)

## Application control

Decision: semantic automation before coordinates.

1. Windows UI Automation identifies controls and supported patterns.
2. Playwright handles browser DOM automation.
3. Raw mouse/keyboard input is a fallback after foreground-window verification,
   display-scale conversion, and an approval-bound action plan.

FlaUI is MIT and mature but needs .NET, which is not installed. It remains a
candidate worker rather than an immediate dependency. Microsoft SendInput is
limited by UIPI; it cannot be treated as guaranteed control of higher-integrity
applications.

Sources:

- [Microsoft UI Automation provider overview](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-providersoverview)
- [Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)
- [FlaUI](https://github.com/FlaUI/FlaUI)
- [Playwright](https://github.com/microsoft/playwright)

## Memory and durable work

Decision: a transparent local SQLite store with one writer, explicit schemas,
provenance, confidence, retention, inspection, correction, and deletion. FTS5 is the
first retrieval layer. sqlite-vec is MIT but pre-v1, so vector retrieval is optional
until it is pinned and benchmarked. Mem0 is an Apache-2.0 design reference, not a
wholesale dependency because common defaults introduce hosted services.

The Node 24 runtime exposes experimental node:sqlite and embeds SQLite 3.50.4.
SQLite's official WAL documentation reports a rare multi-connection WAL corruption
issue fixed in newer releases. The first store will therefore use one connection and
rollback journaling, or upgrade and verify SQLite before enabling WAL.

Durable jobs use task and run records, leases, idempotency keys, retry schedules,
approval revisions, and crash recovery. There is no arbitrary model tool-round
ceiling. Timeouts and cancellation belong to actual I/O operations.

Sources:

- [SQLite FTS5](https://www.sqlite.org/fts5.html)
- [SQLite WAL documentation](https://www.sqlite.org/wal.html)
- [Node SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [sqlite-vec](https://github.com/asg017/sqlite-vec)
- [Mem0](https://github.com/mem0ai/mem0)
- [Cline architecture](https://github.com/cline/cline/blob/main/sdk/ARCHITECTURE.md)

## Startup and background execution

Decision: a future packaged, per-user headless process may use Windows Task
Scheduler or a Start-menu startup entry. A user-interactive process will not be
installed as a Windows service because services run in session 0. A future
noninteractive broker may use WinSW if a concrete need survives threat modeling.

Sources:

- [Microsoft interactive services guidance](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services)
- [WinSW](https://github.com/winsw/winsw)

## Explicitly rejected shortcuts

- Blind full-file rewriting after a stale read
- One monolithic process for interface adapters, audio inference, OCR, and automation
- A single conversational-state enum that cannot represent simultaneous listening
  and speaking
- Keeping all neural models resident on an 8 GB integrated-GPU machine
- Coordinate-only application control when semantic controls are available
- Multi-connection SQLite WAL on the currently embedded vulnerable SQLite version
- Downloading model artifacts without exact licenses and checksums
- A fixed count of model tool rounds as a substitute for cancellation and recovery
- Copying whole GitHub projects without dependency, license, and threat review
