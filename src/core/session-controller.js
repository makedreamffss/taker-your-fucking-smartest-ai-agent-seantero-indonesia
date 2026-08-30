import { randomUUID } from "node:crypto";

import { ActivityStateStore } from "./activity-state.js";
import { AgentBusyError } from "./errors.js";

export class SessionController {
  #activeTurn = null;
  #idFactory;
  #listeners = new Set();
  #onListenerError;

  constructor({
    agent,
    activityState = new ActivityStateStore(),
    idFactory = randomUUID,
    onListenerError = () => {},
  }) {
    if (!agent || typeof agent.send !== "function") {
      throw new TypeError("SessionController requires an agent with send().");
    }
    if (!(activityState instanceof ActivityStateStore)) {
      throw new TypeError(
        "SessionController activityState must be an ActivityStateStore.",
      );
    }
    if (typeof idFactory !== "function") {
      throw new TypeError("SessionController idFactory must be a function.");
    }
    if (typeof onListenerError !== "function") {
      throw new TypeError(
        "SessionController onListenerError must be a function.",
      );
    }
    this.agent = agent;
    this.activityState = activityState;
    this.#idFactory = idFactory;
    this.#onListenerError = onListenerError;
  }

  get isBusy() {
    return this.#activeTurn !== null;
  }

  get activeTurnId() {
    return this.#activeTurn?.id ?? null;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Session listeners must be functions.");
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async send(
    userText,
    { signal, onEvent = () => {}, requestApproval } = {},
  ) {
    if (this.#activeTurn) {
      throw new AgentBusyError(
        "Turn " +
          this.#activeTurn.id +
          " is still active. Interrupt it before starting another turn.",
      );
    }
    if (typeof onEvent !== "function") {
      throw new TypeError("SessionController onEvent must be a function.");
    }

    const turnId = String(this.#idFactory());
    const controller = new AbortController();
    const abortFromExternalSignal = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromExternalSignal();
    else {
      signal?.addEventListener("abort", abortFromExternalSignal, {
        once: true,
      });
    }

    this.#activeTurn = { id: turnId, controller };
    this.activityState.transition("turn", "thinking", {
      source: "session",
      reason: "turn_started",
    });
    await this.#emit({ type: "turn_started", turnId }, onEvent);

    const approvalHandler =
      typeof requestApproval === "function"
        ? async (request) => {
            this.activityState.transition("turn", "waiting_approval", {
              source: "permission_policy",
              reason: "approval_requested",
            });
            await this.#emit(
              { type: "approval_requested", turnId, request },
              onEvent,
            );
            const approved = (await requestApproval(request)) === true;
            this.activityState.transition(
              "turn",
              approved ? "executing" : "thinking",
              {
                source: "permission_policy",
                reason: approved ? "approval_granted" : "approval_denied",
              },
            );
            await this.#emit(
              { type: "approval_resolved", turnId, approved },
              onEvent,
            );
            return approved;
          }
        : undefined;

    try {
      const response = await this.agent.send(userText, {
        signal: controller.signal,
        ...(approvalHandler ? { requestApproval: approvalHandler } : {}),
        onEvent: async (event) => {
          this.#applyAgentEvent(event);
          await this.#emit({ ...event, turnId }, onEvent);
        },
      });
      if (this.activityState.snapshot.turn !== "idle") {
        this.activityState.transition("turn", "idle", {
          source: "session",
          reason: "turn_completed",
        });
      }
      await this.#emit({ type: "turn_completed", turnId }, onEvent);
      return response;
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        this.activityState.update(
          { turn: "idle", audioOutput: "silent" },
          { source: "session", reason: "turn_cancelled" },
        );
        await this.#emit(
          {
            type: "turn_cancelled",
            turnId,
            reason: formatAbortReason(controller.signal.reason),
          },
          onEvent,
        );
      } else {
        this.activityState.transition("turn", "error", {
          source: "session",
          reason: "turn_failed",
        });
        await this.#emit(
          {
            type: "turn_failed",
            turnId,
            errorCode: error?.code ?? "UNEXPECTED_ERROR",
          },
          onEvent,
        );
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abortFromExternalSignal);
      if (this.#activeTurn?.id === turnId) this.#activeTurn = null;
    }
  }

  interrupt(reason = "user_interruption") {
    if (!this.#activeTurn) return false;
    const { id: turnId, controller } = this.#activeTurn;
    controller.abort(reason);
    if (this.activityState.snapshot.audioOutput !== "silent") {
      this.activityState.transition("audioOutput", "silent", {
        source: "session",
        reason: "playback_interrupted",
      });
    }
    this.#broadcast({
      type: "interruption_requested",
      turnId,
      reason: String(reason),
    });
    return true;
  }

  clearError() {
    if (this.activityState.snapshot.turn !== "error") return false;
    this.activityState.transition("turn", "idle", {
      source: "session",
      reason: "error_acknowledged",
    });
    return true;
  }

  #applyAgentEvent(event) {
    switch (event?.type) {
      case "thinking":
      case "tool_completed":
        this.activityState.transition("turn", "thinking", {
          source: "agent",
          reason: event.type,
        });
        break;
      case "tool_started":
        this.activityState.transition("turn", "executing", {
          source: "agent",
          reason: event.type,
        });
        break;
      case "completed":
        this.activityState.transition("turn", "idle", {
          source: "agent",
          reason: event.type,
        });
        break;
      default:
        break;
    }
  }

  async #emit(event, onEvent) {
    this.#broadcast(event);
    await onEvent(event);
  }

  #broadcast(event) {
    const frozenEvent = Object.freeze({ ...event });
    for (const listener of this.#listeners) {
      try {
        listener(frozenEvent);
      } catch (error) {
        this.#onListenerError(error);
      }
    }
  }
}

function isAbortError(error) {
  return (
    error?.code === "REQUEST_ABORTED" ||
    error?.name === "AbortError" ||
    error?.code === "ABORT_ERR"
  );
}

function formatAbortReason(reason) {
  if (reason instanceof Error) return reason.message;
  return reason === undefined ? "cancelled" : String(reason);
}
