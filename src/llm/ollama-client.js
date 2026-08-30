import {
  OllamaConnectionError,
  OllamaResponseError,
  RequestAbortedError,
} from "../core/errors.js";

export class OllamaClient {
  constructor({
    baseUrl = "http://127.0.0.1:11434",
    model,
    timeoutMs = 300_000,
    fetchImpl = globalThis.fetch,
  }) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("OllamaClient requires a fetch implementation.");
    }
    if (typeof model !== "string" || !model.trim()) {
      throw new TypeError("OllamaClient requires a model name.");
    }

    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async healthcheck({ signal } = {}) {
    const response = await this.#request("/api/tags", {
      method: "GET",
      signal,
    });
    const models = Array.isArray(response.models)
      ? response.models
          .map((entry) => entry?.name ?? entry?.model)
          .filter((name) => typeof name === "string")
      : [];
    return { ok: true, models };
  }

  async chat({ messages, tools = [], signal } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new TypeError("chat requires at least one message.");
    }

    const payload = {
      model: this.model,
      messages,
      stream: false,
      think: true,
    };
    if (tools.length > 0) {
      payload.tools = tools;
    }

    const response = await this.#request("/api/chat", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      signal,
    });

    if (!response.message || response.message.role !== "assistant") {
      throw new OllamaResponseError(
        "Ollama returned a successful response without an assistant message.",
      );
    }
    return response;
  }

  async #request(pathname, options) {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${pathname}`, {
        ...options,
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new RequestAbortedError(undefined, { cause: error });
      }
      const timedOut = timeoutSignal.aborted;
      const detail = timedOut
        ? `The request timed out after ${this.timeoutMs} ms.`
        : `Could not reach Ollama at ${this.baseUrl}.`;
      throw new OllamaConnectionError(
        `${detail} Ensure Ollama is installed, running, and signed in for cloud models.`,
        { cause: error },
      );
    }

    const bodyText = await response.text();
    if (!response.ok) {
      const detail = extractErrorMessage(bodyText);
      throw new OllamaResponseError(
        `Ollama request failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
      );
    }

    try {
      return bodyText ? JSON.parse(bodyText) : {};
    } catch (error) {
      throw new OllamaResponseError(
        "Ollama returned invalid JSON for a non-streaming request.",
        { cause: error },
      );
    }
  }
}

function extractErrorMessage(bodyText) {
  if (!bodyText) return "";
  try {
    const body = JSON.parse(bodyText);
    if (typeof body.error === "string") return body.error.slice(0, 500);
  } catch {
    // Fall back to a short plain-text response below.
  }
  return bodyText.replace(/\s+/g, " ").trim().slice(0, 500);
}
