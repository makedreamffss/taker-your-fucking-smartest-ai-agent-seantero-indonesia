# Foundation architecture

## Runtime flow

```text
Terminal
  -> SessionController
     -> ActivityStateStore
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

Optional engine providers, not attached to a UI host:
  VoiceOrchestrator -> whisper.cpp STT / Pocket TTS worker
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
  state independent for any future interface adapter.
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
- `src/runtime.js` is the composition root used by the terminal and available to
  future independently reviewed interface adapters.
- `src/voice/voice-orchestrator.js` owns speech-cycle generation, stale-result
  rejection, barge-in, agent turns, and the TTS provider boundary.
- `src/voice/whisper-cpp-stt.js` writes a bounded temporary PCM WAV, launches
  the pinned local CLI with cancellation/timeout, reads the transcript, and erases
  temporary audio and output.
- `src/voice/pocket-tts.js` owns the pinned local neural worker, removes non-speech
  markup, chunks long output, pipelines synthesis with playback, and terminates the
  worker on cancellation. It never falls back to an OS or hosted TTS voice.
- `src/voice/pocket-tts-worker.py` keeps the model and voice state resident behind a
  line-delimited JSON protocol and returns only validated PCM WAVE payloads.
- `src/infra/jsonl-logger.js` records event metadata, not prompt/file contents.

## Current process topology

```text
Node.js terminal process
  - composition root and session controller
  - Ollama model/tool orchestration
  - terminal approval coordinator
  - metadata-only logger
  |
  +-- cancellable child process when requested
        - PowerShell / CMD / Bash command
        - optional Windows UAC elevation
        - whisper.cpp or Pocket TTS provider when explicitly integrated
```

There is intentionally no Electron host, renderer, floating window, pet, avatar,
popover, or 3D authoring surface in the current repository.

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
8. Optional speech providers remain isolated from model/tool policy. Temporary STT
   audio is removed in a `finally` block, and TTS work is cancellable and bounded.
9. Any future graphical interface must be proposed as a separate product decision;
   it is not part of the current engine and must not silently reintroduce a renderer.

## Gated roadmap

Each gate should be tested before the next is opened.

The authoritative gates and exit criteria are in
[DELIVERY-ROADMAP.md](DELIVERY-ROADMAP.md). No gate is opened merely because a
library can be installed; it must pass functional, failure, security, and resource
tests on the target machine.
