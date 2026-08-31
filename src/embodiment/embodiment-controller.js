"use strict";

import { randomUUID } from "node:crypto";

import {
  createEmbodimentCommand,
  embodimentCatalog,
  validateEmbodimentEvent,
} from "./contracts.js";

const ACCEPT_TIMEOUT_MS = 2_500;

export class EmbodimentController {
  #send = null;
  #pending = new Map();
  #status = {
    ready: false,
    backend: null,
    mood: "neutral",
    presence: "full",
    activeAction: null,
    telemetry: null,
    lastError: null,
  };

  attach(send) {
    if (typeof send !== "function") {
      throw new TypeError("EmbodimentController.attach requires a send function.");
    }
    this.detach("renderer_replaced");
    this.#send = send;
  }

  detach(reason = "renderer_unavailable") {
    this.#send = null;
    this.#status.ready = false;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Embodiment renderer unavailable: ${reason}.`));
    }
    this.#pending.clear();
  }

  inspect() {
    return {
      ...structuredClone(this.#status),
      connected: this.#send !== null,
      catalog: embodimentCatalog(),
    };
  }

  async dispatch(type, payload = {}) {
    if (!this.#send) throw new Error("Embodiment renderer is not connected.");
    const requestId = randomUUID();
    const command = createEmbodimentCommand(type, payload, requestId);

    const accepted = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`Embodiment renderer did not accept ${type} in time.`));
      }, ACCEPT_TIMEOUT_MS);
      this.#pending.set(requestId, { resolve, reject, timer });
    });

    this.#send(command);
    const event = await accepted;
    this.#updateOptimisticStatus(command);
    return { accepted: true, requestId, event, status: this.inspect() };
  }

  handleRendererEvent(rawEvent) {
    const event = validateEmbodimentEvent(rawEvent);
    if (!event) return false;

    if (event.type === "ready") {
      this.#status.ready = true;
      this.#status.backend = event.backend ?? "unknown";
    } else if (event.type === "action_started") {
      this.#status.activeAction = event.action ?? null;
    } else if (event.type === "action_completed") {
      this.#status.activeAction = null;
    } else if (event.type === "telemetry") {
      this.#status.telemetry = {
        fps: event.fps ?? null,
        drawCalls: event.drawCalls ?? null,
        triangles: event.triangles ?? null,
      };
    } else if (event.type === "error") {
      this.#status.lastError = event.message ?? "Unknown renderer error.";
    }

    if (event.requestId && this.#pending.has(event.requestId)) {
      const pending = this.#pending.get(event.requestId);
      this.#pending.delete(event.requestId);
      clearTimeout(pending.timer);
      if (event.type === "error") pending.reject(new Error(event.message));
      else pending.resolve(event);
    }
    return true;
  }

  #updateOptimisticStatus(command) {
    if (command.type === "set_mood") this.#status.mood = command.payload.mood;
    if (command.type === "set_presence") this.#status.presence = command.payload.mode;
    if (command.type === "play_action") this.#status.activeAction = command.payload.action;
  }
}
