# Gated delivery roadmap

Reliability outranks autonomy, speed, and visual complexity. A gate closes only when
the feature works, fails safely, cancels promptly, is measured on this machine, and
has tests and operator documentation.

## Gate 0 — agent/tool foundation: complete

- Ollama gpt-oss:120b-cloud transport
- whole-turn conversation history
- typed tool registry and structured observations
- full machine-global filesystem and shell potential
- approval and semi-autonomous policies plus Windows UAC
- unlimited tool rounds with cancellation and operation timeouts

## Gate 1 — interruption and 3D embodiment shell: complete

- one active turn owned by SessionController
- abort propagation and truthful lifecycle events
- independent service, turn, input-audio, and output-audio state
- conflict-safe exact text editing with backup
- transparent 320 by 440 Blender-authored 3D embodiment with no visible background
- sandboxed local renderer, CSP, narrow preload bridge, blocked navigation
- coherent 19-joint hierarchy with independent pose, mood, action, gaze, and speech
  tracks; 16 finite action clips captured by a deterministic visual audit
- typed native and MCP scene/asset/Blender boundaries; no arbitrary Blender code

Exit evidence: 71 tests pass; Chromium runtime capture confirms transparent WebGL2,
non-static frames, and the authored GLB. The action auditor captured all 16 named
clips and produced a reviewed contact sheet.

## Gate 2 — audio capture, VAD, and STT: in progress

- native-menu-gated Chromium capture with echo cancellation, noise suppression, and
  AGC is wired; real-device validation remains
- Silero VAD v5, AudioWorklet, matching ONNX/WASM, and local asset hashes are wired
- multilingual whisper.cpp base STT is pinned, checksum-installed, cancellable, and
  removes temporary audio after every segment
- an 11-second English fixture transcribed correctly in 6.124 seconds including
  model/process startup, a 0.557 real-time factor
- renderer-to-VAD and VAD-to-STT lifecycle/error paths are tested
- enumerate and persist an explicit microphone choice
- benchmark sherpa-onnx as the required second STT candidate
- English and Indonesian corpus tests
- push-to-talk fallback and visible listening state
- interruption stops an active turn within a measured latency budget

Exit criteria: no capture-thread blocking, no unbounded queue growth, clean device
loss/recovery, acceptable real-time factor and peak memory on the target machine.

## Gate 3 — streaming TTS and conversational barge-in

- benchmark Kokoro and an Indonesian-capable licensed provider
- chunked synthesis/playback with cancel token
- microphone remains live during playback
- VAD-confirmed user speech fades/stops output and aborts the current turn
- false-interruption recovery and echo tests on the built-in speakers/microphone

Exit criteria: measured time to first audio, cancellation latency, peak memory,
language quality, and no self-interruption in a controlled echo test.

## Gate 4 — screen capture and OCR

- explicit monitor/window selection and capture indicator
- bounded frame sizing and utility-worker processing
- Tesseract baseline; PaddleOCR only if benchmark evidence justifies it
- OCR regions include source, coordinates, scale, and timestamp
- prompt-injection labeling and no automatic action from observed text

Exit criteria: multi-scale/DPI tests, monitor disconnect recovery, memory bounds,
and known-text accuracy fixture.

## Gate 5 — semantic application control

- Windows UI Automation inspection and action tools
- Playwright browser provider
- foreground verification and DPI-safe raw input fallback
- dry-run/action preview and postcondition observation
- approval bound to exact control, window identity, and action revision

Exit criteria: deterministic calculator/editor/browser fixtures, privilege-boundary
tests, safe failure when focus or UI tree changes.

## Gate 6 — persistent memory and durable background tasks

- one-writer SQLite rollback-journal store with migrations and backups
- FTS5 search, provenance, confidence, retention, edit, export, and deletion
- durable task/run/attempt schema, leases, idempotency, retry schedule, recovery
- approval revisions persist across restart without broadening authorization
- inspectable task and memory popovers

Exit criteria: crash-injection and migration tests, corrupt-store recovery drill,
retention/deletion verification, no multi-connection WAL on the current SQLite.

## Gate 7 — transient conversation UI and packaging

- text/response/approval popover anchored to the pet and dismissed when idle is
  implemented
- approval view displays exact arguments and resolves a single immutable request
- keyboard activation and reduced-motion support are implemented
- multi-monitor position persistence
- signed/reproducible packaging path, Electron fuses, ASAR integrity, SBOM
- per-user start-on-login and single-instance recovery

Exit criteria: cold-start, upgrade, crash-loop, offline, and login-start tests. The
normal desktop remains visually only the pet.
