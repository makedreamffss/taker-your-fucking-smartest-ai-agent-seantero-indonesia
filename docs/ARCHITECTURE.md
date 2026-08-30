# Foundation architecture

## Runtime flow

```text
Terminal / transient text popover / VAD speech segment
  -> SessionController
     -> ActivityStateStore -> transparent pet renderer
     -> VoiceOrchestrator
        -> local Silero VAD in sandboxed Chromium
        -> cancellable whisper.cpp subprocess
        -> future TTS provider
     -> Agent
     -> Conversation (whole-turn bounded history)
     -> OllamaClient -> local Ollama API -> gpt-oss:120b-cloud
     -> ToolRegistry
        -> PermissionPolicy
        -> global filesystem tools
        -> PowerShell / CMD / Bash command tool
        -> optional Windows UAC elevation
     -> observation returned to model
     -> final response
```

There is no configured tool-round ceiling. The loop ends when the model returns a
normal assistant message, approval is denied, the request fails, or the user stops
the process.

## Component boundaries

- `src/llm/ollama-client.js` owns the model transport. The agent does not know URL
  or HTTP details, so another model provider can later implement the same boundary.
- `src/core/agent.js` owns the observe/reason/execute loop. It cannot execute an
  unregistered capability directly.
- `src/core/session-controller.js` owns the single active turn, cancellation,
  interruption, approval lifecycle, and event fan-out.
- `src/core/activity-state.js` keeps service, turn, audio-input, and audio-output
  state independent and derives the compact visual state shown by the pet.
- `src/core/conversation.js` retains complete turns. An assistant tool call and its
  tool result are never separated by naive message-count truncation.
- `src/tools/registry.js` converts registered tools to Ollama schemas, validates
  model arguments, enforces permission policy, and serializes every result.
- `src/tools/permission-policy.js` does not remove capabilities. It assesses each
  invocation and either authorizes it automatically under the selected semi policy
  or requests interactive approval.
- `src/tools/builtins/filesystem-tools.js` provides machine-wide structured read,
  search, create, write, copy, move, and delete operations. Relative paths use the
  workspace; absolute paths are accepted.
- `src/tools/builtins/command-tools.js` executes arbitrary PowerShell, CMD, or Bash
  with captured streams, timeout/cancellation, process-tree termination, and an
  explicit UAC elevation path on Windows.
- `src/runtime.js` is the composition root shared by terminal, desktop, and
  future voice interfaces.
- `src/desktop/main.js` owns the trusted Electron main process and runtime. It
  serves only path-bounded packaged assets, denies navigation and new windows, and
  grants microphone permission only after the native Start listening action.
- `src/desktop/preload.cjs` exposes narrow state and validated voice channels.
  It never exposes raw Electron IPC or filesystem/command primitives.
- `src/desktop/renderer/` contains the sandboxed, Node-free pet, local Silero
  VAD capture path, and transient popover renderer.
- `src/voice/voice-orchestrator.js` owns speech-cycle generation, stale-result
  rejection, barge-in, agent turns, and the TTS provider boundary.
- `src/voice/whisper-cpp-stt.js` writes a bounded temporary PCM WAV, launches
  the pinned local CLI with cancellation/timeout, reads the transcript, and erases
  temporary audio and output.
- `src/infra/jsonl-logger.js` records event metadata, not prompt/file contents.

## Target process topology

```text
Electron main process
  - composition root and policy
  - SessionController and model/tool orchestration
  - approval coordinator
  |
  +-- sandboxed pet renderer
  |     - state animation and user activation
  |     - Chromium audio processing and local Silero VAD
  |     - no Node.js or arbitrary IPC
  |
  +-- transient sandboxed popovers
  |     - conversation and approval views
  |
  +-- cancellable child/utility workers
        - whisper.cpp STT and future TTS
        - screen image processing/OCR
        - crash isolation and bounded queues
```

The pet window is 124 by 124 pixels, transparent, frameless, draggable,
always-on-top, and absent from the taskbar. Normal use shows the pet only. Larger
surfaces are separate short-lived windows so invisible transparent areas never
intercept desktop clicks.

## Reliability choices

1. Non-streaming model requests are used in v0.3. They are simpler to validate and
   preserve correctly across tool calls. Text streaming can be added at the model
   boundary without changing tool implementations.
2. Tool calls execute sequentially. This preserves deterministic observations and
   leaves a clean insertion point for future approval prompts and cancellation.
3. Failed tool calls become structured observations instead of terminating the
   whole turn. The model may correct an invalid path or argument in the next round.
4. There is no artificial tool-round limit. Cancellation, explicit denials, command
   timeouts, model errors, and user interruption are the termination controls.
5. Approval mode confirms every call. Semi mode auto-authorizes only an explicitly
   safe subset; destructive, elevated, external-path, overwrite, and ambiguous
   operations always require confirmation.
6. Failed model turns are discarded from conversation memory so partial tool-call
   state cannot poison the next request.
7. Text edits require the hash of the exact file the model observed, exact match
   counts, a final pre-write recheck, atomic replacement, and a default backup.
8. The renderer is not a capability boundary. It receives sanitized state only;
   machine powers remain behind the registry and permission policy in the main
   process.
9. VAD inference and audio resampling remain in the sandboxed renderer. Only bounded
   speech segments cross the typed preload bridge. Temporary STT audio is removed in
   a finally block.
10. Normal desktop state is pet-only. Prompt, response, and approval surfaces are a
   separate window that is hidden again after the interaction.

## Gated roadmap

Each gate should be tested before the next is opened.

The authoritative gates and exit criteria are in
[DELIVERY-ROADMAP.md](DELIVERY-ROADMAP.md). No gate is opened merely because a
library can be installed; it must pass functional, failure, security, and resource
tests on the target machine.
