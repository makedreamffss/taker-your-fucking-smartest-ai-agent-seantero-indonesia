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
- No NVIDIA GPU, ffmpeg, Tesseract, or .NET runtime currently installed
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

## Desktop shell

Decision: Electron, pinned exactly, with local packaged content only. It fits the
existing Node runtime and gives Chromium audio and screen APIs without introducing a
second application stack.

Required controls are based on Electron's official security checklist:

- renderer Node integration disabled
- context isolation and process sandbox enabled
- restrictive content security policy
- secure custom application protocol rather than remote pages
- navigation, new windows, and unexpected permissions denied
- a narrow preload API; never expose raw IPC
- later packaged builds will enable Electron fuses and ASAR integrity

The character is a transparent, frameless, always-on-top 188 by 188 window. It has
no visible background and no permanent control surface. Native menus and future
separate short-lived popovers keep the idle footprint to the pet alone.

Sources:

- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)

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
- sherpa-onnx 1.13.6: Apache-2.0, exact-pinned native Node runtime.
- Supertonic 3 INT8: OpenRAIL-M model weights, ten included voices, 31-language support,
  and a 44.1 kHz output path. The upstream repository is archived, so the provider
  boundary and artifact manifest are mandatory exit conditions, not optional polish.
- Kokoro 82M: Apache-2.0 alternative candidate for natural English speech.
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
- Silero VAD v5, ONNX Runtime Web 1.29.0, and the AudioWorklet load successfully
  from local built assets in a sandboxed hidden Electron smoke test.
- Supertonic 3 INT8 synthesized the same 115-character operator response across all
  ten supplied voices on this machine. Real-time factors ranged from 0.413 to 0.559.
  M2 is the selected operator profile because the official voice documentation
  describes it as deep, robust, calm, composed, serious, and grounded. At ten
  synthesis steps and 0.92 speed, the selected 113-character preview measured 0.468
  RTF. Timing is an engineering measurement, not a claim that automation can judge
  subjective fit.
- The exact model archive is 128,774,318 bytes with SHA-256
  `82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427`.
- Both Node and Electron-native synthesis smoke tests generate valid PCM WAVE output.
- Live microphone, echo/barge-in, Indonesian accuracy, memory, and the required
  second-provider comparison remain open exit criteria.

Sources:

- [Silero VAD](https://github.com/snakers4/silero-vad)
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- [sherpa-onnx Node examples](https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/README.md)
- [sherpa-onnx Supertonic documentation](https://k2-fsa.github.io/sherpa/onnx/tts/supertonic.html)
- [Supertonic](https://github.com/supertone-inc/supertonic)
- [Kokoro](https://github.com/hexgrad/kokoro)
- [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M)
- [OHF Piper](https://github.com/OHF-voice/piper1-gpl)
- [Piper voices](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md)
- [LiveKit Agents](https://github.com/livekit/agents)
- [Pipecat](https://github.com/pipecat-ai/pipecat)

## Screen capture and OCR

Decision: Electron desktopCapturer for explicit screen/window frames, then bounded
image jobs in a utility worker. Tesseract 5 is the lightweight Apache-2.0 baseline.
PaddleOCR is a heavier Apache-2.0 optional provider only if benchmarks justify its
quality and resource cost.

Captures are observations, not trusted instructions. OCR text is marked with source
coordinates and time, passed to the model as untrusted data, and never converted
directly into an action without the normal tool and approval path.

Sources:

- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)
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

Decision: a packaged per-user application launched with Electron login-item
settings. The interactive UI will not be installed as a Windows service because
services run in session 0 and cannot safely own a user's desktop interaction. A
future noninteractive broker may use WinSW if a concrete need survives threat
modeling.

Sources:

- [Electron application login settings](https://www.electronjs.org/docs/latest/api/app)
- [Microsoft interactive services guidance](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services)
- [WinSW](https://github.com/winsw/winsw)

## Explicitly rejected shortcuts

- Blind full-file rewriting after a stale read
- One monolithic process for UI, audio inference, OCR, and automation
- A single conversational-state enum that cannot represent simultaneous listening
  and speaking
- Hidden remote content or broad IPC in a privileged desktop renderer
- Keeping all neural models resident on an 8 GB integrated-GPU machine
- Coordinate-only application control when semantic controls are available
- Multi-connection SQLite WAL on the currently embedded vulnerable SQLite version
- Downloading model artifacts without exact licenses and checksums
- Running the interactive desktop pet as a Windows service
- A fixed count of model tool rounds as a substitute for cancellation and recovery
- Copying whole GitHub projects without dependency, license, and threat review
