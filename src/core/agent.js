import { OllamaResponseError } from "./errors.js";
import { NullLogger } from "../infra/jsonl-logger.js";

export class Agent {
  constructor({
    client,
    conversation,
    toolRegistry,
    logger = new NullLogger(),
  }) {
    this.client = client;
    this.conversation = conversation;
    this.toolRegistry = toolRegistry;
    this.logger = logger;
  }

  async send(
    userText,
    { signal, onEvent = () => {}, requestApproval } = {},
  ) {
    if (typeof userText !== "string" || !userText.trim()) {
      throw new TypeError("A non-empty user message is required.");
    }

    this.conversation.startUserTurn(userText);
    await this.#log("info", "turn_started", { inputCharacters: userText.length });
    let executedToolCalls = 0;

    try {
      for (let round = 1; ; round += 1) {
        await this.#emit(onEvent, { type: "thinking", round });
        const response = await this.client.chat({
          messages: this.conversation.messages(),
          tools: this.toolRegistry.toOllamaTools(),
          signal,
        });
        const assistantMessage = normalizeAssistantMessage(response.message);
        this.conversation.appendAssistant(assistantMessage);

        const toolCalls = assistantMessage.tool_calls ?? [];
        if (toolCalls.length === 0) {
          const content = assistantMessage.content.trim();
          if (!content) {
            throw new OllamaResponseError(
              "The model returned neither a response nor a tool call.",
            );
          }

          this.conversation.finishTurn();
          await this.#log("info", "turn_completed", {
            rounds: round,
            toolCalls: executedToolCalls,
            outputCharacters: content.length,
          });
          await this.#emit(onEvent, { type: "completed", round });
          return { content, rounds: round, toolCalls: executedToolCalls };
        }

        for (const toolCall of toolCalls) {
          const toolName = extractToolName(toolCall);
          await this.#emit(onEvent, { type: "tool_started", name: toolName });
          await this.#log("info", "tool_started", { tool: toolName });

          const result = await this.toolRegistry.execute(toolCall, {
            signal,
            requestApproval,
          });
          executedToolCalls += 1;
          this.conversation.appendTool({
            name: result.toolName,
            content: result.content,
          });

          await this.#log(result.ok ? "info" : "warning", "tool_completed", {
            tool: result.toolName,
            ok: result.ok,
            errorCode: result.errorCode,
            durationMs: result.durationMs,
          });
          await this.#emit(onEvent, {
            type: "tool_completed",
            name: result.toolName,
            ok: result.ok,
            errorCode: result.errorCode,
          });
        }
      }
    } catch (error) {
      this.conversation.abortTurn();
      await this.#log("error", "turn_failed", {
        code: error?.code ?? "UNEXPECTED_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async #emit(onEvent, event) {
    await onEvent(event);
  }

  async #log(level, event, fields) {
    await this.logger.log(level, event, fields);
  }
}

function normalizeAssistantMessage(message) {
  const normalized = {
    role: "assistant",
    content: typeof message?.content === "string" ? message.content : "",
  };
  if (typeof message?.thinking === "string" && message.thinking) {
    normalized.thinking = message.thinking;
  }
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
    normalized.tool_calls = structuredClone(message.tool_calls);
  }
  return normalized;
}

function extractToolName(toolCall) {
  const name = toolCall?.function?.name ?? toolCall?.name;
  return typeof name === "string" && name ? name : "unknown_tool";
}
