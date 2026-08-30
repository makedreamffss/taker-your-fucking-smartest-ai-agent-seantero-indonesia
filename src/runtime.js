import { Agent } from "./core/agent.js";
import { Conversation } from "./core/conversation.js";
import { buildSystemPrompt } from "./core/system-prompt.js";
import { JsonlLogger } from "./infra/jsonl-logger.js";
import { OllamaClient } from "./llm/ollama-client.js";
import { createCommandTools } from "./tools/builtins/command-tools.js";
import { createFilesystemTools } from "./tools/builtins/filesystem-tools.js";
import { PermissionPolicy } from "./tools/permission-policy.js";
import { ToolRegistry } from "./tools/registry.js";

export function createRuntime(config, { fetchImpl, logger } = {}) {
  const client = new OllamaClient({
    baseUrl: config.ollamaBaseUrl,
    model: config.model,
    timeoutMs: config.requestTimeoutMs,
    ...(fetchImpl ? { fetchImpl } : {}),
  });

  const permissionPolicy = new PermissionPolicy({ mode: config.approvalMode });
  const toolRegistry = new ToolRegistry({ permissionPolicy }).registerAll(
    [
      ...createFilesystemTools({ workspace: config.workspace }),
      ...createCommandTools({
        workspace: config.workspace,
        defaultTimeoutMs: config.commandTimeoutMs,
      }),
    ],
  );
  const conversation = new Conversation({
    systemPrompt: buildSystemPrompt({ workspace: config.workspace }),
    maxTurns: config.historyTurns,
  });
  const runtimeLogger =
    logger ?? new JsonlLogger({ filePath: config.logPath });
  const agent = new Agent({
    client,
    conversation,
    toolRegistry,
    logger: runtimeLogger,
  });

  return {
    agent,
    client,
    conversation,
    permissionPolicy,
    toolRegistry,
  };
}
