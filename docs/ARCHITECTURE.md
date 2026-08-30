# Foundation architecture

## Runtime flow

```text
Terminal input
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
- `src/runtime.js` is the composition root shared by the terminal today and a
  desktop or voice interface later.
- `src/infra/jsonl-logger.js` records event metadata, not prompt/file contents.

## Reliability choices

1. Non-streaming model requests are used in v0.2. They are simpler to validate and
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

## Gated roadmap

Each gate should be tested before the next is opened.

1. **Current:** model transport, unlimited tool loop, global filesystem arsenal,
   arbitrary shells, self-built helpers, interactive approvals, semi mode, and UAC.
2. Add cancellable task plans, retry policy, and resumable task state.
3. Add screen capture and OCR as observation tools.
4. Add application mouse/keyboard control through the same approval policy.
5. Add persistent memory with inspection, retention, and deletion controls.
6. Add modular VAD, STT, streaming TTS, and interruption handling.
7. Add the compact always-on-top desktop interface and state animation.
8. Add startup-on-login only after crash recovery and safe idle behavior are
    verified.
