"use strict";

export const EMBODIMENT_PROTOCOL_VERSION = 1;

export const EMBODIMENT_MOODS = Object.freeze([
  "neutral",
  "focused",
  "calm",
  "concerned",
  "severe",
  "confident",
]);

export const EMBODIMENT_ACTIONS = Object.freeze([
  "acknowledge",
  "arrive",
  "brace",
  "celebrate",
  "decline",
  "dance",
  "jump",
  "point_left",
  "point_right",
  "roll",
  "salute",
  "scan",
  "stretch",
  "think",
  "wave",
  "work",
]);

export const EMBODIMENT_PRESENCE_MODES = Object.freeze([
  "compact",
  "full",
  "sentinel",
]);

export const EMBODIMENT_COMMAND_TYPES = Object.freeze([
  "inspect",
  "play_action",
  "set_mood",
  "set_presence",
  "look_at",
  "set_speech_energy",
]);

export const ACTIVITY_PRESENTATION = Object.freeze({
  idle: { mood: "neutral", action: null },
  starting: { mood: "focused", action: "arrive" },
  stopping: { mood: "calm", action: "decline" },
  thinking: { mood: "focused", action: "think" },
  executing: { mood: "focused", action: "work" },
  waiting_approval: { mood: "concerned", action: "brace" },
  listening: { mood: "calm", action: "scan" },
  speaking: { mood: "confident", action: "acknowledge" },
  error: { mood: "severe", action: "brace" },
});

const moodSet = new Set(EMBODIMENT_MOODS);
const actionSet = new Set(EMBODIMENT_ACTIONS);
const presenceSet = new Set(EMBODIMENT_PRESENCE_MODES);
const commandSet = new Set(EMBODIMENT_COMMAND_TYPES);

export function createEmbodimentCommand(type, payload = {}, requestId = null) {
  if (!commandSet.has(type)) {
    throw new TypeError(`Unknown embodiment command: ${String(type)}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Embodiment command payload must be an object.");
  }
  const command = {
    protocolVersion: EMBODIMENT_PROTOCOL_VERSION,
    type,
    payload: normalizePayload(type, payload),
  };
  if (requestId != null) {
    if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 80) {
      throw new TypeError("Embodiment request id must be a bounded string.");
    }
    command.requestId = requestId;
  }
  return Object.freeze(command);
}

export function validateEmbodimentEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const type = event.type;
  if (!new Set(["ready", "accepted", "action_started", "action_completed", "error", "telemetry"]).has(type)) {
    return null;
  }
  const normalized = { type };
  if (typeof event.requestId === "string" && event.requestId.length <= 80) {
    normalized.requestId = event.requestId;
  }
  if (typeof event.action === "string" && actionSet.has(event.action)) {
    normalized.action = event.action;
  }
  if (typeof event.message === "string") normalized.message = event.message.slice(0, 500);
  if (Number.isFinite(event.fps)) normalized.fps = clamp(event.fps, 0, 300);
  if (Number.isSafeInteger(event.drawCalls)) normalized.drawCalls = clamp(event.drawCalls, 0, 10_000);
  if (Number.isSafeInteger(event.triangles)) normalized.triangles = clamp(event.triangles, 0, 5_000_000);
  if (typeof event.backend === "string") normalized.backend = event.backend.slice(0, 40);
  return normalized;
}

export function embodimentCatalog() {
  return {
    protocolVersion: EMBODIMENT_PROTOCOL_VERSION,
    moods: [...EMBODIMENT_MOODS],
    actions: [...EMBODIMENT_ACTIONS],
    presenceModes: [...EMBODIMENT_PRESENCE_MODES],
    tracks: ["base_pose", "mood", "action", "gaze", "speech"],
    assetFormats: ["vrm-1.0", "vrma-1.0", "glb-2.0"],
  };
}

function normalizePayload(type, payload) {
  switch (type) {
    case "inspect":
      return {};
    case "play_action":
      if (!actionSet.has(payload.action)) {
        throw new TypeError(`Unknown embodiment action: ${String(payload.action)}`);
      }
      return {
        action: payload.action,
        intensity: normalizeUnit(payload.intensity, 1),
        interrupt: payload.interrupt !== false,
      };
    case "set_mood":
      if (!moodSet.has(payload.mood)) {
        throw new TypeError(`Unknown embodiment mood: ${String(payload.mood)}`);
      }
      return {
        mood: payload.mood,
        intensity: normalizeUnit(payload.intensity, 1),
      };
    case "set_presence":
      if (!presenceSet.has(payload.mode)) {
        throw new TypeError(`Unknown presence mode: ${String(payload.mode)}`);
      }
      return { mode: payload.mode };
    case "look_at":
      return {
        x: normalizeSigned(payload.x),
        y: normalizeSigned(payload.y),
        holdMs: clampInteger(payload.holdMs ?? 900, 0, 30_000),
      };
    case "set_speech_energy":
      return { energy: normalizeUnit(payload.energy, 0) };
    default:
      throw new TypeError(`Unsupported embodiment command: ${type}`);
  }
}

function normalizeUnit(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new TypeError("Expected a finite number.");
  return clamp(value, 0, 1);
}

function normalizeSigned(value) {
  if (!Number.isFinite(value)) throw new TypeError("Look-at coordinates must be finite.");
  return clamp(value, -1, 1);
}

function clampInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value)) throw new TypeError("Expected an integer.");
  return clamp(value, minimum, maximum);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
