import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { ToolInputError } from "../../core/errors.js";

const SHELLS = Object.freeze({
  powershell: {
    executable: process.platform === "win32" ? "powershell.exe" : "pwsh",
    args: (command) => ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
  },
  cmd: {
    executable: process.platform === "win32" ? "cmd.exe" : "cmd",
    args: (command) => ["/d", "/s", "/c", command],
  },
  bash: {
    executable: "bash",
    args: (command) => ["-lc", command],
  },
});

const MAX_COMMAND_LENGTH = 500_000;
const MAX_STDIN_LENGTH = 2_000_000;
const MAX_OUTPUT_CHARACTERS = 2_000_000;

export function createCommandTools({ workspace, defaultTimeoutMs = 120_000 }) {
  const root = path.resolve(workspace);

  return [
    {
      name: "execute_command",
      description:
        "Execute an arbitrary command through PowerShell, CMD, or Bash with captured output, timeout, cancellation, and optional Windows administrator elevation.",
      risk: "execute",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["shell", "command"],
        properties: {
          shell: { type: "string", enum: ["powershell", "cmd", "bash"] },
          command: { type: "string", minLength: 1, maxLength: MAX_COMMAND_LENGTH },
          working_directory: { type: "string", maxLength: 32_768 },
          timeout_ms: { type: "integer", minimum: 1_000, maximum: 3_600_000 },
          max_output_characters: {
            type: "integer",
            minimum: 1_000,
            maximum: MAX_OUTPUT_CHARACTERS,
          },
          stdin: { type: "string", maxLength: MAX_STDIN_LENGTH },
          run_as_admin: { type: "boolean" },
        },
      },
      describe: ({
        shell,
        command,
        working_directory: workingDirectory = ".",
        run_as_admin: runAsAdmin = false,
      }) =>
        `${runAsAdmin ? "Run as Windows administrator" : "Run"} ${shell} in ${resolveWorkingDirectory(root, workingDirectory)}: ${command}`,
      async assess({
        shell,
        command,
        working_directory: workingDirectory = ".",
        run_as_admin: runAsAdmin = false,
      }) {
        const cwd = resolveWorkingDirectory(root, workingDirectory);
        const insideWorkspace = await resolvesInside(root, cwd);
        const classification = classifyCommand(shell, command);
        const referencesExternalPath = commandReferencesExternalPath(command, root);
        return {
          destructive: classification.destructive,
          elevated: runAsAdmin,
          outsideWorkspace: !insideWorkspace || referencesExternalPath,
          ambiguous: classification.kind === "ambiguous",
          safeInSemiAutonomous:
            classification.kind === "read_only" &&
            insideWorkspace &&
            !referencesExternalPath &&
            !runAsAdmin,
          reason: runAsAdmin
            ? "This command requests Windows administrator elevation and will also trigger UAC."
            : !insideWorkspace || referencesExternalPath
              ? `This command runs in or explicitly references a path outside the codebase workspace. Global access is available after authorization.`
              : classification.reason,
        };
      },
      async execute(
        {
          shell,
          command,
          working_directory: workingDirectory = ".",
          timeout_ms: timeoutMs = defaultTimeoutMs,
          max_output_characters: maxOutputCharacters = 200_000,
          stdin = "",
          run_as_admin: runAsAdmin = false,
        },
        { signal } = {},
      ) {
        const cwd = resolveWorkingDirectory(root, workingDirectory);
        const cwdStat = await stat(cwd);
        if (!cwdStat.isDirectory()) {
          throw new ToolInputError(`${cwd} is not a directory.`);
        }

        if (runAsAdmin) {
          if (stdin) {
            throw new ToolInputError(
              "Elevated commands do not support stdin. Write an input file first or run without elevation.",
            );
          }
          if (process.platform !== "win32") {
            throw new ToolInputError(
              "run_as_admin currently supports Windows UAC. Use the platform's elevation command explicitly on other systems.",
            );
          }
          return runElevatedWindows({
            shell,
            command,
            cwd,
            timeoutMs,
            maxOutputCharacters,
            workspace: root,
            signal,
          });
        }

        const shellDefinition = SHELLS[shell];
        return runCapturedProcess({
          executable: shellDefinition.executable,
          args: shellDefinition.args(command),
          cwd,
          timeoutMs,
          maxOutputCharacters,
          stdin,
          signal,
        });
      },
    },
  ];
}

export function classifyCommand(shell, command) {
  const normalized = command.trim();
  const lower = normalized.toLocaleLowerCase();
  const destructivePatterns = [
    /\b(remove-item|clear-content|format-volume|clear-disk|initialize-disk|stop-computer|restart-computer)\b/,
    /\b(del|erase|rmdir|rd|format|diskpart|shutdown|reboot)\b/,
    /\b(rm|unlink|shred|mkfs|dd)\b/,
    /\b(reg\s+(delete|add)|sc\s+delete|net\s+user|takeown|icacls|bcdedit)\b/,
    /\bgit\s+(clean|reset\s+--hard)\b/,
    /\b(winget|choco|npm|pip|cargo)\s+(uninstall|remove)\b/,
    /\b(drop\s+(database|table)|truncate\s+table)\b/,
    /(^|[^<])>{1,2}(?![>&])|\b(set-content|add-content|out-file|move-item|rename-item)\b/,
  ];
  if (destructivePatterns.some((pattern) => pattern.test(lower))) {
    return {
      kind: "destructive",
      destructive: true,
      reason: "The command contains operations that can delete, overwrite, reconfigure, or irreversibly alter state.",
    };
  }

  const hasComplexShellSyntax = /[|;&><\r\n`]/.test(normalized) || /\$\(|@\(|\b(invoke-expression|iex|forEach-object)\b/i.test(normalized);
  if (!hasComplexShellSyntax && isAllowlistedReadOnly(shell, lower)) {
    return {
      kind: "read_only",
      destructive: false,
      reason: "The command is a single clearly read-only inspection command.",
    };
  }
  return {
    kind: "ambiguous",
    destructive: false,
    reason: "Arbitrary command effects cannot be proven read-only, so confirmation is required.",
  };
}

function isAllowlistedReadOnly(shell, command) {
  const patterns = {
    powershell: [
      /^(get-(childitem|content|item|location|command|process|service|date|computerinfo|filehash)\b|test-path\b|resolve-path\b|select-string\b|where\.exe\b|rg\b)/,
      /^git\s+(status|diff|log|show|branch\s+--show-current)\b/,
      /^npm\s+(test|run\s+(check|doctor))\b/,
      /^node\s+--check\b/,
    ],
    cmd: [
      /^(dir|type|where|find|findstr|ver|whoami|hostname)\b/,
      /^git\s+(status|diff|log|show|branch\s+--show-current)\b/,
      /^npm\s+(test|run\s+(check|doctor))\b/,
      /^node\s+--check\b/,
    ],
    bash: [
      /^(ls|pwd|cat|head|tail|wc|grep|rg|find|stat|file|which|whoami|hostname)\b/,
      /^git\s+(status|diff|log|show|branch\s+--show-current)\b/,
      /^npm\s+(test|run\s+(check|doctor))\b/,
      /^node\s+--check\b/,
    ],
  };
  return patterns[shell]?.some((pattern) => pattern.test(command)) ?? false;
}

function resolveWorkingDirectory(workspace, requestedPath) {
  if (typeof requestedPath !== "string" || requestedPath.includes("\0")) {
    throw new ToolInputError("working_directory must be a valid string.");
  }
  return path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(workspace, requestedPath);
}

function commandReferencesExternalPath(command, workspace) {
  const windowsPaths = command.match(/[a-zA-Z]:[\\/][^\r\n"'`;|<>]*/g) ?? [];
  const uncPaths = command.match(/\\\\[^\r\n"'`;|<>]+/g) ?? [];
  return [...windowsPaths, ...uncPaths].some((candidate) => {
    const cleaned = candidate.trim().replace(/[),\]}]+$/, "");
    if (!path.isAbsolute(cleaned)) return false;
    const relative = path.relative(workspace, path.resolve(cleaned));
    return (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    );
  });
}

async function resolvesInside(workspace, candidate) {
  let canonicalRoot;
  let canonicalCandidate;
  try {
    [canonicalRoot, canonicalCandidate] = await Promise.all([
      realpath(workspace),
      realpath(candidate),
    ]);
  } catch {
    canonicalRoot = path.resolve(workspace);
    canonicalCandidate = path.resolve(candidate);
  }
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  return !(
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

function runCapturedProcess({
  executable,
  args,
  cwd,
  timeoutMs,
  maxOutputCharacters,
  stdin,
  signal,
}) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const appendOutput = (current, chunk, markTruncated) => {
      if (current.length >= maxOutputCharacters) {
        markTruncated();
        return current;
      }
      const combined = current + chunk.toString();
      if (combined.length > maxOutputCharacters) {
        markTruncated();
        return combined.slice(0, maxOutputCharacters);
      }
      return combined;
    };

    child.stdout.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk, () => {
        stdoutTruncated = true;
      });
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk, () => {
        stderrTruncated = true;
      });
    });

    const terminate = () => terminateProcessTree(child);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const abortHandler = () => {
      aborted = true;
      terminate();
    };
    if (signal) {
      if (signal.aborted) abortHandler();
      else signal.addEventListener("abort", abortHandler, { once: true });
    }

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortHandler);
      reject(
        new ToolInputError(
          `Could not start ${executable}: ${error.message}. Ensure the requested shell is installed and on PATH.`,
          { cause: error },
        ),
      );
    });
    child.once("close", (exitCode, terminationSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortHandler);
      resolve({
        executable,
        cwd,
        exitCode,
        terminationSignal,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        timedOut,
        aborted,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });

    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

function terminateProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.unref();
  } else {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
  }
}

async function runElevatedWindows({
  shell,
  command,
  cwd,
  timeoutMs,
  maxOutputCharacters,
  workspace,
  signal,
}) {
  const jobDirectory = path.join(workspace, ".agent", "elevated", randomUUID());
  await mkdir(jobDirectory, { recursive: true });
  const wrapperPath = path.join(jobDirectory, "elevated-wrapper.ps1");
  const stdoutPath = path.join(jobDirectory, "stdout.txt");
  const stderrPath = path.join(jobDirectory, "stderr.txt");
  const resultPath = path.join(jobDirectory, "result.json");
  const payloadPath = path.join(jobDirectory, shell === "cmd" ? "payload.cmd" : "payload.sh");

  let executable;
  let argumentString;
  if (shell === "powershell") {
    executable = "powershell.exe";
    const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
    argumentString = `-NoLogo -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`;
  } else if (shell === "cmd") {
    executable = "cmd.exe";
    await writeFile(payloadPath, command, "utf8");
    argumentString = `/d /s /c ${quoteWindowsArgument(payloadPath)}`;
  } else {
    executable = "bash";
    await writeFile(payloadPath, command, "utf8");
    argumentString = quoteWindowsArgument(payloadPath.replaceAll("\\", "/"));
  }

  const wrapper = buildElevatedWrapper({
    executable,
    argumentString,
    cwd,
    timeoutMs,
    stdoutPath,
    stderrPath,
    resultPath,
  });
  await writeFile(wrapperPath, wrapper, "utf8");

  const encodedWrapperPath = Buffer.from(wrapperPath, "utf8").toString("base64");
  const launcher = [
    "$ErrorActionPreference = 'Stop'",
    `$wrapper = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedWrapperPath}'))`,
    "$quoted = [char]34 + $wrapper + [char]34",
    "$arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + $quoted",
    "$process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru",
    "exit $process.ExitCode",
  ].join("\n");
  const encodedLauncher = Buffer.from(launcher, "utf16le").toString("base64");

  try {
    const launcherResult = await runCapturedProcess({
      executable: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedLauncher],
      cwd,
      timeoutMs: timeoutMs + 120_000,
      maxOutputCharacters: 20_000,
      stdin: "",
      signal,
    });
    if (launcherResult.exitCode !== 0) {
      throw new ToolInputError(
        `Administrator launch failed or UAC was declined. ${launcherResult.stderr}`.trim(),
      );
    }
    const [stdout, stderr, resultText] = await Promise.all([
      readFile(stdoutPath, "utf8").catch(() => ""),
      readFile(stderrPath, "utf8").catch(() => ""),
      readFile(resultPath, "utf8"),
    ]);
    const result = JSON.parse(resultText.replace(/^\uFEFF/, ""));
    return {
      executable,
      cwd,
      elevated: true,
      exitCode: result.exitCode,
      terminationSignal: null,
      stdout: stdout.slice(0, maxOutputCharacters),
      stderr: stderr.slice(0, maxOutputCharacters),
      stdoutTruncated: stdout.length > maxOutputCharacters,
      stderrTruncated: stderr.length > maxOutputCharacters,
      timedOut: result.timedOut,
      aborted: false,
      durationMs: result.durationMs,
    };
  } finally {
    await rm(jobDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

function buildElevatedWrapper({
  executable,
  argumentString,
  cwd,
  timeoutMs,
  stdoutPath,
  stderrPath,
  resultPath,
}) {
  const encode = (value) => Buffer.from(String(value), "utf8").toString("base64");
  return [
    "$ErrorActionPreference = 'Stop'",
    `function Decode([string]$value) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value)) }`,
    `$executable = Decode '${encode(executable)}'`,
    `$arguments = Decode '${encode(argumentString)}'`,
    `$workingDirectory = Decode '${encode(cwd)}'`,
    `$stdoutPath = Decode '${encode(stdoutPath)}'`,
    `$stderrPath = Decode '${encode(stderrPath)}'`,
    `$resultPath = Decode '${encode(resultPath)}'`,
    "$started = [Diagnostics.Stopwatch]::StartNew()",
    "$psi = [Diagnostics.ProcessStartInfo]::new()",
    "$psi.FileName = $executable",
    "$psi.Arguments = $arguments",
    "$psi.WorkingDirectory = $workingDirectory",
    "$psi.UseShellExecute = $false",
    "$psi.CreateNoWindow = $true",
    "$psi.RedirectStandardOutput = $true",
    "$psi.RedirectStandardError = $true",
    "$process = [Diagnostics.Process]::Start($psi)",
    "$stdoutTask = $process.StandardOutput.ReadToEndAsync()",
    "$stderrTask = $process.StandardError.ReadToEndAsync()",
    `$completed = $process.WaitForExit(${timeoutMs})`,
    "if (-not $completed) { try { $process.Kill() } catch {}; $process.WaitForExit() }",
    "$stdoutTask.Wait(); $stderrTask.Wait()",
    "[IO.File]::WriteAllText($stdoutPath, $stdoutTask.Result)",
    "[IO.File]::WriteAllText($stderrPath, $stderrTask.Result)",
    "$result = @{ exitCode = $(if ($completed) { $process.ExitCode } else { $null }); timedOut = (-not $completed); durationMs = $started.ElapsedMilliseconds }",
    "$result | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8",
    "exit 0",
  ].join("\n");
}

function quoteWindowsArgument(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}
