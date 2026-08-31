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

## Gate 1 — interruption and conflict-safe editing: complete

- one active turn owned by SessionController
- abort propagation and truthful lifecycle events
- independent service, turn, input-audio, and output-audio state
- conflict-safe exact text editing with backup

The rejected Electron/3D interface, its authoring bridge, and all associated tests
and assets were removed. UI work is not an active delivery gate.

## Gate 2 — audio capture, VAD, and STT: in progress

- multilingual whisper.cpp base STT is pinned, checksum-installed, cancellable, and
  removes temporary audio after every segment
- an 11-second English fixture transcribed correctly in 6.124 seconds including
  model/process startup, a 0.557 real-time factor
- enumerate and persist an explicit microphone choice
- select and implement a non-UI microphone capture host
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
- inspectable terminal/API task and memory controls

Exit criteria: crash-injection and migration tests, corrupt-store recovery drill,
retention/deletion verification, no multi-connection WAL on the current SQLite.

## UI direction — intentionally removed

The desktop pet, 3D embodiment, Electron renderer, transient popovers, Blender
authoring pipeline, and embodiment MCP were rejected and removed. A future UI is a
new design decision, not a continuation of that implementation.

## Gate 7 — headless packaging and startup

- signed/reproducible Node.js packaging path and SBOM
- per-user start-on-login for the headless runtime
- single-instance recovery and terminal/API attachment

Exit criteria: cold-start, upgrade, crash-loop, offline, and login-start tests with
no graphical interface bundled.
