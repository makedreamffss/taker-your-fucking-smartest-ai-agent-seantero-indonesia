export class Conversation {
  #systemMessage;
  #completedTurns = [];
  #activeTurn = null;

  constructor({ systemPrompt, maxTurns = 12 }) {
    if (typeof systemPrompt !== "string" || !systemPrompt.trim()) {
      throw new TypeError("Conversation requires a non-empty system prompt.");
    }
    if (!Number.isInteger(maxTurns) || maxTurns < 1) {
      throw new TypeError("maxTurns must be a positive integer.");
    }

    this.#systemMessage = Object.freeze({
      role: "system",
      content: systemPrompt.trim(),
    });
    this.maxTurns = maxTurns;
  }

  startUserTurn(content) {
    if (this.#activeTurn) {
      throw new Error("Cannot start a turn while another turn is active.");
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new TypeError("User content must be a non-empty string.");
    }
    this.#activeTurn = [{ role: "user", content: content.trim() }];
  }

  appendAssistant(message) {
    this.#requireActiveTurn();
    if (!message || message.role !== "assistant") {
      throw new TypeError("Expected an assistant message.");
    }
    this.#activeTurn.push(structuredClone(message));
  }

  appendTool({ name, content }) {
    this.#requireActiveTurn();
    if (typeof name !== "string" || !name) {
      throw new TypeError("Tool messages require a tool name.");
    }
    this.#activeTurn.push({
      role: "tool",
      tool_name: name,
      content: String(content),
    });
  }

  finishTurn() {
    this.#requireActiveTurn();
    this.#completedTurns.push(this.#activeTurn);
    this.#activeTurn = null;
    this.#trimCompletedTurns();
  }

  abortTurn() {
    this.#activeTurn = null;
  }

  clear() {
    this.#completedTurns = [];
    this.#activeTurn = null;
  }

  messages() {
    const messages = [this.#systemMessage];
    for (const turn of this.#completedTurns) {
      messages.push(...turn);
    }
    if (this.#activeTurn) {
      messages.push(...this.#activeTurn);
    }
    return structuredClone(messages);
  }

  get completedTurnCount() {
    return this.#completedTurns.length;
  }

  get hasActiveTurn() {
    return this.#activeTurn !== null;
  }

  #requireActiveTurn() {
    if (!this.#activeTurn) {
      throw new Error("No conversation turn is active.");
    }
  }

  #trimCompletedTurns() {
    if (this.#completedTurns.length > this.maxTurns) {
      this.#completedTurns = this.#completedTurns.slice(-this.maxTurns);
    }
  }
}
