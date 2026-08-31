import { Agent } from "./core/agent.js";
import { ActivityStateStore } from "./core/activity-state.js";
import { Conversation } from "./core/conversation.js";
import { SessionController } from "./core/session-controller.js";
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
  const tools = [
    ...createFilesystemTools({ workspace: config.workspace }),
    ...createCommandTools({
      workspace: config.workspace,
      defaultTimeoutMs: config.commandTimeoutMs,
    }),
  ];
  const toolRegistry = new ToolRegistry({ permissionPolicy }).registerAll(tools);
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
  const activityState = new ActivityStateStore();
  const session = new SessionController({ agent, activityState });

  return {
    agent,
    activityState,
    client,
    conversation,
    permissionPolicy,
    session,
    toolRegistry,
  };
}
