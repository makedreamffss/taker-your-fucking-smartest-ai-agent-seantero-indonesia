# Taker Takeover

Taker Takeover is the first working foundation for an always-available desktop AI
agent. It uses `gpt-oss:120b-cloud` through the local Ollama API as its reasoning
engine while keeping the model, agent loop, tools, permissions, conversation, and
interface separated.

This milestone has both the terminal runtime and the first floating desktop shell.
The shell is a transparent, monochrome pixel operator: no permanent panel, card, or
visible window background. Capability is broad while authorization remains explicit
and user-selectable.

## What works now

- Ollama connectivity and an explicit `gpt-oss:120b-cloud` default
- Multi-turn conversation with complete-turn context trimming
- Native Ollama structured tool calling
- An unbounded observe/reason/tool/result loop with cancellation and error handling
- A typed, extensible tool registry
- A single-turn session controller with interruption and truthful lifecycle events
- Orthogonal agent, microphone, and speech-output state rather than one fragile enum
- Machine-wide path inspection, directory listing, text reading, and filename search
- File and directory creation, atomic text writes with backups, copy, move, and delete
- Conflict-safe exact text edits guarded by a full-file SHA-256 and occurrence counts
- Arbitrary PowerShell, CMD, and Bash commands with stdout/stderr capture and timeouts
- Optional Windows administrator execution through a separate UAC prompt
- `approval` mode, where every tool call requires confirmation
- `semi` mode, where clearly routine operations can run automatically while
  destructive, elevated, external-path, overwrite, and ambiguous actions still ask
- System instructions that tell the model to build, inspect, test, and run helper
  scripts when the exact prebuilt tool does not exist
- Tool failures returned to the model so it can correct a request
- Metadata-only JSONL event logs under `.agent/logs/`
- A sandboxed Electron character shell with a transparent 188-by-188 window, no taskbar
  entry, no Node.js in the renderer, a restrictive CSP, and blocked navigation
- A GPU point-field character made from 12,544 independently displaced pixels,
  12 composable moods, and 40 semantic motion families across six phases
- A compact graphite command surface with a visible Send control, Enter-to-send,
  Shift+Enter newlines, IME-safe keyboard handling, and no decorative HUD chrome
- A sharp transient operator transcript with GFM Markdown parsed by Marked and
  allowlist-sanitized by DOMPurify before insertion
- Self-hosted Silero VAD v5 in the renderer; model, worklet, and ONNX/WASM assets
  are bundled locally with a generated SHA-256 manifest
- Local multilingual speech recognition through pinned whisper.cpp v1.8.6 and the
  Whisper base model, both verified before installation
- Voice barge-in orchestration that rejects stale transcripts, interrupts an active
  agent turn, and stops output through the TTS provider boundary
- Local neural speech through Pocket TTS 3.0.2 with a measured 88 Hz CC0 bass
  source voice, a persistent isolated inference worker, bounded sentence chunks,
  and waveform-driven character motion; typed and spoken prompts both speak replies
- A health/status command and automated unit tests

## Requirements

- Windows, macOS, or Linux
- Node.js 20 or newer (Node 24 is already installed on this machine)
- Ollama running locally
- The `gpt-oss:120b-cloud` model available and Ollama signed in

Ollama's local server listens on `http://127.0.0.1:11434` by default. Cloud-model
authentication is handled by the signed-in local Ollama installation.

## Run it

From PowerShell in this folder:

```powershell
npm install
npm run doctor
npm start
```

Launch the floating pet:

```powershell
npm run desktop
```

Drag the character to move it. Right-click for approval controls, voice capture,
interruption, or quit. Double-click it to open the transient command surface. Install
the verified local speech runtime once with `npm run voice:install`, then choose
Start listening from the right-click menu. Replies to both typed and spoken prompts
are shown as a formatted transcript and spoken by the local neural voice.

At the terminal prompt, try:

```text
List the files in this workspace and briefly explain the project structure.
```

Available terminal commands are `/help`, `/status`, `/mode approval`, `/mode semi`,
`/clear`, and `/exit`.

## Configuration

Configuration is read from environment variables. Defaults are suitable for this
machine.

| Variable | Default | Purpose |
|---|---:|---|
| `OLLAMA_MODEL` | `gpt-oss:120b-cloud` | Reasoning model |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server origin |
| `AGENT_WORKSPACE` | Current directory | Default base for relative paths and generated helpers |
| `AGENT_HISTORY_TURNS` | `12` | Complete prior turns retained in memory |
| `AGENT_REQUEST_TIMEOUT_MS` | `300000` | Ollama request timeout |
| `AGENT_COMMAND_TIMEOUT_MS` | `120000` | Default shell-command timeout |
| `AGENT_APPROVAL_MODE` | `approval` | Startup mode: `approval` or `semi` |
| `AGENT_VOICE_PROFILE` | `peter_yearsley` | Pocket TTS voice; the measured bass operator default |
| `AGENT_LOG_PATH` | `.agent/logs/events.jsonl` | Metadata event log inside workspace |

Example override for the current PowerShell session:

```powershell
$env:AGENT_HISTORY_TURNS = "20"
npm start
```

## Full-capability arsenal

The model receives structured tools for `inspect_path`, `list_directory`,
`read_text_file`, `search_files`, `write_text_file`, `edit_text_file`,
`create_directory`, `copy_path`, `move_path`, `delete_path`,
`get_current_time`, and `execute_command`.

Paths may be relative to the workspace or absolute anywhere on the machine. The
command tool can run arbitrary PowerShell, CMD, or Bash and can request
`run_as_admin: true`. Administrator requests require approval in the agent and then
Windows UAC. If Bash is not installed or on PATH, that invocation returns an error;
PowerShell and CMD remain available on Windows.

The command and file tools are meta-capabilities: when a specialized tool is absent,
the model is instructed to write a helper script or program, inspect and test it,
then execute it. It can also use package managers and installers through a shell after
the relevant approval.

This repository folder is exclusive to the agent's codebase, generated helper code,
logs, tests, and development artifacts. It is only the default base for relative
paths—not a sandbox around the running agent. Absolute paths and command working
directories make the tools globally useful across the machine. Approval prompts
authorize outside-project actions; they do not remove those capabilities.

There is no fixed tool-call ceiling. The loop ends when the model finishes, approval
is denied, the user interrupts, or a real error/blocker occurs. Press Ctrl+C during
an active turn to propagate cancellation through the model request or subprocess.

## Approval modes

`approval` is the startup default. Every tool invocation pauses and displays the
tool, exact action, risk, reason, flags, and arguments. Only `y` or `yes` authorizes
that invocation.

Use `/mode semi` when you want routine work to proceed with fewer interruptions.
Semi mode automatically permits only operations explicitly classified as safe, such
as workspace inspection, creating a new workspace file, or a single allowlisted
read-only shell command. It still asks before deletion, moves, overwrites, admin/UAC,
external paths, complex shell syntax, or any command whose effects are ambiguous.

Switch back at any time:

```text
/mode approval
```

Approval controls authorization, not capability. Denial is returned to the model as
a structured observation, and the system prompt prohibits retrying or disguising the
same denied action through another shell or generated helper.

## Not implemented yet

Live microphone/device benchmark coverage, screen capture/OCR, application
mouse/keyboard control, persistent long-term memory,
durable autonomous jobs, packaging, and start-on-login remain future milestones.
The VAD/STT/TTS path, voice interruption controller, dynamic character, text
conversation, and approval surfaces are implemented.

## Development

Dependencies are exact-pinned and lockfile-controlled. Voice binaries and models use
the committed manifest in `assets/voice/manifest.json` and are installed into the
ignored `.agent/runtime/` directory only after SHA-256 verification.

```powershell
npm test
npm run check
npm run voice:smoke-vad
npm run voice:smoke-tts
npm run voice:benchmark -- .agent/fixtures/jfk.wav
npm run voice:benchmark-tts
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/ENGINEERING-RESEARCH.md](docs/ENGINEERING-RESEARCH.md),
[docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md), and
[docs/DELIVERY-ROADMAP.md](docs/DELIVERY-ROADMAP.md) for the researched design and
gated delivery plan.
