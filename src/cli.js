#!/usr/bin/env node

import readline from "node:readline/promises";
import { createHash } from "node:crypto";
import { stdin as input, stdout as output } from "node:process";

import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";

async function main() {
  const config = loadConfig();
  const runtime = createRuntime(config);

  if (process.argv.includes("--doctor")) {
    const healthy = await printStatus(runtime.client, config, { verbose: true });
    process.exitCode = healthy ? 0 : 1;
    return;
  }

  const healthy = await printStatus(runtime.client, config, { verbose: false });
  if (!healthy) {
    process.exitCode = 1;
    return;
  }

  output.write(
    [
      "Taker Takeover v0.2",
      "Full-capability agent: global files + PowerShell/CMD/Bash + optional UAC elevation",
      `Approval mode: ${runtime.permissionPolicy.mode}`,
      "Commands: /help, /status, /mode approval, /mode semi, /clear, /exit",
      "",
    ].join("\n"),
  );

  const terminal = readline.createInterface({ input, output });
  terminal.on("SIGINT", () => {
    if (runtime.session.isBusy) {
      runtime.session.interrupt("terminal_sigint");
      output.write("\nCancellation requested for the active turn.\n");
    } else {
      terminal.close();
    }
  });

  try {
    while (true) {
      let userText;
      try {
        userText = await terminal.question("you> ");
      } catch {
        break;
      }

      const trimmed = userText.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("/")) {
        const shouldContinue = await handleCommand(trimmed, runtime, config);
        if (!shouldContinue) break;
        continue;
      }

      try {
        const response = await runtime.session.send(trimmed, {
          requestApproval: (request) => promptForApproval(terminal, request),
          onEvent(event) {
            if (event.type === "tool_started") {
              output.write(`  tool> ${event.name}\n`);
            } else if (event.type === "tool_completed" && !event.ok) {
              output.write(`  tool! ${event.name} failed (${event.errorCode})\n`);
            }
          },
        });
        output.write(`agent> ${response.content}\n\n`);
      } catch (error) {
        output.write(
          `error> ${error instanceof Error ? error.message : String(error)}\n\n`,
        );
      }
    }
  } finally {
    terminal.close();
  }
}

async function handleCommand(command, runtime, config) {
  const [commandName, argument] = command.toLowerCase().split(/\s+/, 2);
  if (commandName === "/mode") {
    if (!argument) {
      output.write(`Current approval mode: ${runtime.permissionPolicy.mode}\n\n`);
      return true;
    }
    if (!new Set(["approval", "semi"]).has(argument)) {
      output.write("Mode must be approval or semi.\n\n");
      return true;
    }
    runtime.permissionPolicy.setMode(argument);
    output.write(
      argument === "approval"
        ? "Approval mode enabled: every tool call will ask first.\n\n"
        : "Semi mode enabled: routine safe actions may run automatically; destructive, elevated, external-path, overwrite, and ambiguous actions still ask.\n\n",
    );
    return true;
  }

  switch (command.toLowerCase()) {
    case "/help":
      output.write(
        [
          "/help   Show these commands",
          "/status Check Ollama, model, capabilities, and approval mode",
          "/mode approval  Require confirmation for every tool call",
          "/mode semi      Auto-run only clearly routine safe actions",
          "/clear  Clear in-memory conversation history",
          "/exit   Close the terminal agent",
          "",
        ].join("\n"),
      );
      return true;
    case "/status":
      await printStatus(runtime.client, config, {
        verbose: true,
        approvalMode: runtime.permissionPolicy.mode,
      });
      return true;
    case "/clear":
      runtime.conversation.clear();
      output.write("Conversation history cleared.\n\n");
      return true;
    case "/exit":
    case "/quit":
      return false;
    default:
      output.write(`Unknown command: ${command}. Use /help.\n\n`);
      return true;
  }
}

async function printStatus(
  client,
  config,
  { verbose, approvalMode = config.approvalMode },
) {
  try {
    const health = await client.healthcheck();
    const exactModelAvailable = health.models.includes(config.model);

    if (verbose) {
      output.write(
        [
          "Agent status",
          `  Ollama:   reachable at ${config.ollamaBaseUrl}`,
          `  Brain:    ${config.model}${exactModelAvailable ? " (available)" : " (not listed yet)"}`,
          `  Workspace: ${config.workspace}`,
          "  Arsenal:  global filesystem + PowerShell + CMD + Bash + Windows UAC",
          `  Approval: ${approvalMode}`,
          `  Context:  ${config.historyTurns} complete turns`,
          "  Tool loop: unlimited; ends on completion, denial, interruption, or error",
          "",
        ].join("\n"),
      );
    } else {
      output.write(
        `Ollama ready — brain: ${config.model}${exactModelAvailable ? "" : " (not listed by /api/tags)"}\n`,
      );
    }
    return true;
  } catch (error) {
    output.write(
      `Ollama check failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return false;
  }
}

async function promptForApproval(terminal, request) {
  const { tool, assessment } = request;
  output.write(
    [
      "",
      "APPROVAL REQUIRED",
      `  Tool:    ${tool.name}`,
      `  Risk:    ${tool.risk}`,
      `  Action:  ${assessment.summary}`,
      `  Reason:  ${assessment.reason}`,
      `  Flags:   ${formatAssessmentFlags(assessment)}`,
      "  Arguments:",
      indent(formatApprovalArguments(request.arguments), "    "),
    ].join("\n") + "\n",
  );
  let answer;
  try {
    answer = await terminal.question("Approve this action? [y/N] ");
  } catch {
    return false;
  }
  const approved = new Set(["y", "yes"]).has(answer.trim().toLowerCase());
  output.write(approved ? "Approved.\n" : "Denied.\n");
  return approved;
}

function formatAssessmentFlags(assessment) {
  const flags = [];
  if (assessment.destructive) flags.push("destructive");
  if (assessment.elevated) flags.push("administrator/UAC");
  if (assessment.outsideWorkspace) flags.push("outside workspace");
  if (assessment.ambiguous) flags.push("effects not provably read-only");
  return flags.length > 0 ? flags.join(", ") : "none";
}

function formatApprovalArguments(args) {
  const preview = Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (typeof value !== "string") return [key, value];
      if (!new Set(["content", "stdin"]).has(key) || value.length <= 4_000) {
        return [key, value];
      }
      const hash = createHash("sha256").update(value, "utf8").digest("hex");
      return [
        key,
        `${value.slice(0, 4_000)}\n...[truncated; ${value.length} characters; sha256 ${hash}]`,
      ];
    }),
  );
  return JSON.stringify(preview, null, 2);
}

function indent(value, prefix) {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
