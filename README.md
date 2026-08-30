# Taker Takeover

Taker Takeover is the first working foundation for an always-available desktop AI
agent. It uses `gpt-oss:120b-cloud` through the local Ollama API as its reasoning
engine while keeping the model, agent loop, tools, permissions, conversation, and
interface separated.

This milestone is intentionally a terminal application. It now has a machine-wide
filesystem and arbitrary command-execution arsenal; voice, screen perception, and a
floating desktop window are still future interface layers. Capability is broad while
authorization remains explicit and user-selectable.

## What works now

- Ollama connectivity and an explicit `gpt-oss:120b-cloud` default
- Multi-turn conversation with complete-turn context trimming
- Native Ollama structured tool calling
- An unbounded observe/reason/tool/result loop with cancellation and error handling
- A typed, extensible tool registry
- Machine-wide path inspection, directory listing, text reading, and filename search
- File and directory creation, atomic text writes with backups, copy, move, and delete
- Arbitrary PowerShell, CMD, and Bash commands with stdout/stderr capture and timeouts
- Optional Windows administrator execution through a separate UAC prompt
- `approval` mode, where every tool call requires confirmation
- `semi` mode, where clearly routine operations can run automatically while
  destructive, elevated, external-path, overwrite, and ambiguous actions still ask
- System instructions that tell the model to build, inspect, test, and run helper
  scripts when the exact prebuilt tool does not exist
- Tool failures returned to the model so it can correct a request
- Metadata-only JSONL event logs under `.agent/logs/`
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
npm run doctor
npm start
```

At the prompt, try:

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
| `AGENT_LOG_PATH` | `.agent/logs/events.jsonl` | Metadata event log inside workspace |

Example override for the current PowerShell session:

```powershell
$env:AGENT_HISTORY_TURNS = "20"
npm start
```

## Full-capability arsenal

The model receives structured tools for `inspect_path`, `list_directory`,
`read_text_file`, `search_files`, `write_text_file`, `create_directory`, `copy_path`,
`move_path`, `delete_path`, `get_current_time`, and `execute_command`.

Paths may be relative to the workspace or absolute anywhere on the machine. The
command tool can run arbitrary PowerShell, CMD, or Bash and can request
`run_as_admin: true`. Administrator requests require approval in the agent and then
Windows UAC. If Bash is not installed or on PATH, that invocation returns an error;
PowerShell and CMD remain available on Windows.

The command and file tools are meta-capabilities: when a specialized tool is absent,
the model is instructed to write a helper script or program, inspect and test it,
then execute it. It can also use package managers and installers through a shell after
the relevant approval.

The folder `C:\Users\aminn\OneDrive\Desktop\Taker Takeover` is exclusive to this
agent's codebase, generated helper code, logs, tests, and development artifacts. It
is only the default base for relative paths—not a sandbox around the running agent.
Absolute paths and command working directories make the tools globally useful across
the machine. Approval prompts authorize outside-project actions; they do not remove
those capabilities.

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

Voice/STT/TTS, screen capture/OCR, application mouse/keyboard control, persistent
long-term memory, and the floating always-on-top desktop UI remain future milestones.

## Development

No package installation is required. The runtime uses Node's built-in APIs.

```powershell
npm test
npm run check
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for component boundaries and the
next gated milestones.
