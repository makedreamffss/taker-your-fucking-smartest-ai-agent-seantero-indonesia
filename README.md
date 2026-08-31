# Taker Takeover

> A headless, approval-gated system agent engine powered by Ollama tool calling.

Taker Takeover connects a configurable Ollama model to machine-wide filesystem and
command-execution tools while keeping authorization outside the model. The current
product surface is a terminal application. It has no desktop GUI, pet, avatar, or
background service.

> [!IMPORTANT]
> The default model, `gpt-oss:120b-cloud`, is accessed through the local Ollama API
> but inference is offloaded to Ollama Cloud. It requires an Ollama account and
> network access. The model boundary is configurable if a local model is preferred.

## Project status

This repository is an actively developed engine foundation, not a finished desktop
assistant. The agent loop, tool registry, permission policy, terminal interface,
filesystem operations, shell execution, cancellation, and audit logging are
implemented and tested. Voice providers exist as isolated components but are not
connected to a live microphone or terminal audio host.

## Capabilities

| Area | Implemented behavior |
|---|---|
| Reasoning | Ollama chat transport with native structured tool calls and `gpt-oss:120b-cloud` as the default model |
| Agent loop | Observe, reason, execute, inspect, and correct until completion, denial, interruption, or a real error; no fixed tool-round ceiling |
| Conversation | Bounded multi-turn history trimmed only at complete turn boundaries |
| Filesystem | Inspect, list, search, read, create, copy, move, delete, and write files anywhere on the machine |
| Safe editing | SHA-256 revision checks, exact occurrence counts, atomic replacement, and backups for conflict-sensitive edits |
| Commands | PowerShell, CMD, and optional Bash execution with captured output, timeouts, cancellation, and process-tree termination |
| Elevation | Explicit Windows administrator requests followed by the native UAC prompt |
| Authorization | Full-approval and semi-autonomous modes enforced by a policy layer outside model output |
| Extensibility | Typed tool registry plus permission-aware helper-program creation when a specialized tool does not exist |
| Observability | Metadata-only JSONL events under `.agent/logs/` |
| Voice components | Pinned whisper.cpp STT, Pocket TTS, speech-text normalization, and barge-in orchestration modules |

## Architecture

```text
Terminal
  -> SessionController
     -> Agent
        -> Conversation
        -> OllamaClient -> local Ollama API -> configured model
        -> ToolRegistry
           -> PermissionPolicy
           -> filesystem tools
           -> PowerShell / CMD / Bash
           -> optional Windows UAC elevation
        -> structured observation -> next model step or final response
```

The model can request capabilities, but it cannot invoke operating-system
primitives directly. Every tool call passes through schema validation and the
permission policy before execution.

## Requirements

- Windows 10 or 11 is the primary tested platform.
- Node.js 20 or newer and npm.
- [Ollama](https://docs.ollama.com/) running on the machine.
- An Ollama model with tool-calling support.
- For the default model: an Ollama account, network access, and
  `gpt-oss:120b-cloud` available to the local Ollama installation.

PowerShell and CMD are available on Windows. Bash commands require a Bash
installation discoverable through `PATH`.

## Quick start

```powershell
git clone https://github.com/makedreamffss/taker-your-fucking-smartest-ai-agent-seantero-indonesia.git
Set-Location taker-your-fucking-smartest-ai-agent-seantero-indonesia
npm ci

ollama signin
ollama pull gpt-oss:120b-cloud

npm run doctor
npm start
```

`npm run doctor` checks the Ollama endpoint, selected model, workspace, approval
mode, context configuration, and registered system-level arsenal without starting
an interactive agent session.

A first prompt can be as simple as:

```text
Inspect this repository and explain its architecture.
```

Press Ctrl+C during an active turn to request cancellation. Press Ctrl+C while
idle, or enter `/exit`, to close the agent.

## Terminal commands

| Command | Effect |
|---|---|
| `/help` | Show the command reference |
| `/status` | Recheck Ollama, model availability, capabilities, and current mode |
| `/mode approval` | Require confirmation for every tool invocation |
| `/mode semi` | Automatically allow only operations classified as routine and safe |
| `/clear` | Remove in-memory conversation history |
| `/exit` or `/quit` | End the terminal session |

## Tool surface

| Tool | Purpose |
|---|---|
| `inspect_path` | Inspect file or directory metadata |
| `list_directory` | List bounded directory contents |
| `read_text_file` | Read bounded UTF-8 text |
| `search_files` | Search filenames under a selected root |
| `write_text_file` | Create or replace text using atomic writes and optional backup |
| `edit_text_file` | Apply exact, hash-guarded text replacements |
| `create_directory` | Create a directory and required parents |
| `copy_path` | Copy a file or directory |
| `move_path` | Move or rename a file or directory |
| `delete_path` | Delete a file or directory after authorization |
| `get_current_time` | Read local or IANA-zone time |
| `execute_command` | Run PowerShell, CMD, or Bash, optionally through Windows UAC |

Relative paths resolve from `AGENT_WORKSPACE`. Absolute paths and explicit command
working directories are accepted, so the workspace is a default base rather than
a machine-access sandbox.

## Authorization model

| Mode | Automatic operations | Operations that require approval |
|---|---|---|
| `approval` | None | Every tool call |
| `semi` | Only calls explicitly assessed as routine and safe | Destructive actions, elevation, external paths, overwrites, compound or ambiguous commands, and anything not proven safe |

Approval prompts show the tool, risk class, plain-language action, reason, risk
flags, and arguments. Only `y` or `yes` authorizes the displayed invocation.
Denial is returned to the model as an observation; the system prompt prohibits
retrying or disguising the same denied action.

> [!WARNING]
> This project intentionally exposes powerful machine-wide tools. Run it only under
> a user account and environment you trust, keep backups, and review approval
> prompts as carefully as commands entered directly into a terminal.

## Configuration

Configuration is read from environment variables at startup.

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_MODEL` | `gpt-oss:120b-cloud` | Ollama model name |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server origin |
| `AGENT_WORKSPACE` | Current directory | Base for relative paths and generated helpers |
| `AGENT_HISTORY_TURNS` | `12` | Complete prior turns retained in memory |
| `AGENT_REQUEST_TIMEOUT_MS` | `300000` | Model request timeout |
| `AGENT_COMMAND_TIMEOUT_MS` | `120000` | Default command timeout |
| `AGENT_APPROVAL_MODE` | `approval` | Startup mode: `approval` or `semi` |
| `AGENT_VOICE_PROFILE` | `peter_yearsley` | Pocket TTS provider profile |
| `AGENT_LOG_PATH` | `.agent/logs/events.jsonl` | Metadata event log inside the workspace |

Example for the current PowerShell session:

```powershell
$env:AGENT_APPROVAL_MODE = "semi"
$env:AGENT_HISTORY_TURNS = "20"
npm start
```

## Optional voice components

The repository contains provider-level voice infrastructure:

- whisper.cpp v1.8.6 with a pinned multilingual Whisper base model;
- Pocket TTS 3.0.2 running in an isolated persistent Python worker;
- bounded PCM WAVE handling and speech-oriented text normalization;
- interruption logic that invalidates stale transcripts and cancels output.

Install the verified project-local voice runtime on Windows:

```powershell
npm run voice:install
npm run voice:smoke-tts
```

These modules do not currently make the terminal application listen or speak. A
microphone/VAD capture provider and an audio playback host still need to be
integrated and validated on real devices.

## Development

```powershell
npm ci
npm run check
npm run doctor
```

| Script | Purpose |
|---|---|
| `npm test` | Run the Node.js test suite |
| `npm run check` | Check the CLI syntax and run all tests |
| `npm run doctor` | Verify live Ollama and model availability |
| `npm run voice:smoke-tts` | Validate bounded Pocket TTS worker output |
| `npm run voice:benchmark -- <wav>` | Benchmark whisper.cpp using a supplied WAV fixture |
| `npm run voice:benchmark-tts` | Benchmark the installed Pocket TTS runtime |

Current verification baseline: 47 passing tests and zero npm audit
vulnerabilities. Run the commands above on your checkout rather than relying on
this recorded baseline.

## Repository layout

```text
src/
  cli.js                    terminal entry point and approval UI
  config.js                 validated environment configuration
  runtime.js                composition root
  core/                     agent, conversation, session, and activity state
  llm/                      Ollama transport
  tools/                    registry, policy, filesystem, and command tools
  voice/                    STT, TTS, PCM, speech text, and interruption modules
  infra/                    metadata-only JSONL logging
assets/voice/               pinned voice artifact manifest and Python lock
scripts/                    voice installation, smoke, and benchmark utilities
test/                       Node.js unit and integration tests
docs/                       architecture, security, research, and delivery gates
```

## Current limitations

- No graphical interface.
- No live microphone capture or terminal audio playback.
- No screen capture or OCR.
- No mouse, keyboard, or semantic application-control provider.
- No persistent long-term memory.
- No durable autonomous job scheduler.
- No packaged executable, start-on-login integration, or always-running service.
- The default model is cloud-hosted through Ollama rather than fully local.

Planned work and exit criteria are tracked in the
[delivery roadmap](docs/DELIVERY-ROADMAP.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security and authorization model](docs/SECURITY-MODEL.md)
- [Engineering research record](docs/ENGINEERING-RESEARCH.md)
- [Open-source dependency policy](docs/DEPENDENCY-POLICY.md)
- [Gated delivery roadmap](docs/DELIVERY-ROADMAP.md)

## Licensing

No repository-wide software license has been declared yet. Do not assume permission
to redistribute or incorporate the project merely because the repository is public.
Third-party runtime and model licenses are recorded separately in the
[dependency policy](docs/DEPENDENCY-POLICY.md) and
[voice artifact manifest](assets/voice/manifest.json).

## Maintainer

[makedreamffss](https://github.com/makedreamffss)
