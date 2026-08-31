"use strict";

import {
  EMBODIMENT_ACTIONS,
  EMBODIMENT_MOODS,
  EMBODIMENT_PRESENCE_MODES,
} from "../../embodiment/contracts.js";

export function createEmbodimentTools({ controller }) {
  if (!controller || typeof controller.inspect !== "function") {
    throw new TypeError("Embodiment tools require an EmbodimentController.");
  }

  return [
    {
      name: "embodiment_inspect",
      description:
        "Inspect the connected 3D embodiment, render telemetry, semantic tracks, and available moods and real action clips.",
      risk: "read",
      parameters: emptySchema(),
      describe: () => "Inspect the 3D embodiment and animation catalog",
      execute: () => controller.inspect(),
    },
    {
      name: "embodiment_play_action",
      description:
        "Play one named, coherent 3D action on the character rig. This controls presentation only and does not execute machine actions.",
      risk: "control",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["action"],
        properties: {
          action: { type: "string", enum: [...EMBODIMENT_ACTIONS] },
          intensity: { type: "number", minimum: 0, maximum: 1 },
          interrupt: { type: "boolean" },
        },
      },
      describe: ({ action }) => `Play 3D action ${action}`,
      assess: () => presentationAssessment("Temporary 3D animation only."),
      execute: (args) => controller.dispatch("play_action", args),
    },
    {
      name: "embodiment_set_mood",
      description:
        "Set the persistent mood layer of the 3D embodiment without changing the agent's claims or decisions.",
      risk: "control",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["mood"],
        properties: {
          mood: { type: "string", enum: [...EMBODIMENT_MOODS] },
          intensity: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      describe: ({ mood }) => `Set 3D embodiment mood to ${mood}`,
      assess: () => presentationAssessment("Persistent visual mood only."),
      execute: (args) => controller.dispatch("set_mood", args),
    },
    {
      name: "embodiment_look_at",
      description:
        "Direct the 3D embodiment gaze using normalized screen-relative coordinates from -1 to 1.",
      risk: "control",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["x", "y"],
        properties: {
          x: { type: "number", minimum: -1, maximum: 1 },
          y: { type: "number", minimum: -1, maximum: 1 },
          holdMs: { type: "integer", minimum: 0, maximum: 30_000 },
        },
      },
      describe: ({ x, y }) => `Aim the 3D embodiment gaze at (${x}, ${y})`,
      assess: () => presentationAssessment("Temporary local gaze animation only."),
      execute: (args) => controller.dispatch("look_at", args),
    },
    {
      name: "embodiment_set_presence",
      description:
        "Change how much space and motion the 3D embodiment uses: compact, full, or sentinel.",
      risk: "control",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["mode"],
        properties: {
          mode: { type: "string", enum: [...EMBODIMENT_PRESENCE_MODES] },
        },
      },
      describe: ({ mode }) => `Set 3D embodiment presence to ${mode}`,
      assess: () => presentationAssessment("Local presentation setting only."),
      execute: (args) => controller.dispatch("set_presence", args),
    },
  ];
}

function emptySchema() {
  return { type: "object", additionalProperties: false, properties: {} };
}

function presentationAssessment(reason) {
  return {
    destructive: false,
    elevated: false,
    outsideWorkspace: false,
    ambiguous: false,
    safeInSemiAutonomous: true,
    reason,
  };
}
