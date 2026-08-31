"use strict";

import { EMBODIMENT_ACTIONS, EMBODIMENT_MOODS } from "../../embodiment/contracts.js";

const TAU = Math.PI * 2;

export const MOTION_CLIPS = Object.freeze({
  acknowledge: clip(1100, acknowledge),
  arrive: clip(1700, arrive),
  brace: clip(1600, brace),
  celebrate: clip(2200, celebrate),
  decline: clip(1300, decline),
  dance: clip(3000, dance),
  jump: clip(1500, jump),
  point_left: clip(1700, (c, p, w) => point(c, p, w, 1)),
  point_right: clip(1700, (c, p, w) => point(c, p, w, -1)),
  roll: clip(2100, roll),
  salute: clip(1800, salute),
  scan: clip(2200, scan),
  stretch: clip(2400, stretch),
  think: clip(2500, think),
  wave: clip(2300, wave),
  work: clip(2600, work),
});

export class RigMotionSystem {
  constructor(rig, { onActionEvent = () => {} } = {}) {
    this.rig = rig;
    this.onActionEvent = onActionEvent;
    this.mood = "neutral";
    this.moodIntensity = 1;
    this.presence = "full";
    this.action = null;
    this.look = { x: 0, y: 0, until: 0 };
    this.speechEnergy = 0;
  }

  setMood(mood, intensity = 1) {
    if (!EMBODIMENT_MOODS.includes(mood)) throw new TypeError(`Unknown mood: ${mood}`);
    this.mood = mood;
    this.moodIntensity = clamp01(intensity);
  }

  setPresence(mode) {
    this.presence = mode;
  }

  lookAt(x, y, holdMs = 900, nowMs = performance.now()) {
    this.look = { x, y, until: nowMs + holdMs };
  }

  playAction(name, { intensity = 1, interrupt = true, nowMs = performance.now() } = {}) {
    const definition = MOTION_CLIPS[name];
    if (!definition) throw new TypeError(`Unknown action clip: ${name}`);
    if (this.action && !interrupt) return false;
    this.action = { name, definition, startedAt: nowMs, intensity: clamp01(intensity) };
    this.onActionEvent({ type: "action_started", action: name });
    return true;
  }

  setSpeechEnergy(value) {
    this.speechEnergy += (clamp01(value) - this.speechEnergy) * 0.42;
  }

  update(nowMs, deltaSeconds) {
    const time = nowMs / 1000;
    this.speechEnergy *= Math.pow(0.17, deltaSeconds);
    this.rig.resetPose();
    applyIdle(this, time);
    applyMood(this, time);
    this.#applyAction(nowMs);
    applyGaze(this, nowMs);
    applySpeech(this, time);
    applyPresence(this);
    this.rig.updateVisuals(time, this.speechEnergy, this.mood);
  }

  #applyAction(nowMs) {
    if (!this.action) return;
    const elapsed = nowMs - this.action.startedAt;
    const progress = Math.min(1, elapsed / this.action.definition.durationMs);
    const envelope = smoothEnvelope(progress);
    this.action.definition.apply(this, progress, this.action.intensity * envelope);
    if (progress >= 1) {
      const completed = this.action.name;
      this.action = null;
      this.onActionEvent({ type: "action_completed", action: completed });
    }
  }
}

function clip(durationMs, apply) {
  return Object.freeze({ durationMs, apply });
}

function applyIdle(controller, time) {
  const breath = Math.sin(time * 1.65);
  const counter = Math.sin(time * 0.73);
  transform(controller, "chest", { position: [0, breath * 0.018, 0], rotation: [0, counter * 0.018, 0] });
  transform(controller, "head", { rotation: [breath * 0.012, counter * 0.025, 0] });
  transform(controller, "leftShoulder", { rotation: [breath * 0.018, 0, 0] });
  transform(controller, "rightShoulder", { rotation: [-breath * 0.018, 0, 0] });
}

function applyMood(controller, time) {
  const w = controller.moodIntensity;
  switch (controller.mood) {
    case "focused":
      transform(controller, "head", { rotation: [0.09, 0, 0] }, w);
      transform(controller, "spine", { rotation: [-0.05, 0, 0] }, w);
      break;
    case "calm":
      transform(controller, "leftShoulder", { rotation: [0, 0, 0.08] }, w);
      transform(controller, "rightShoulder", { rotation: [0, 0, -0.08] }, w);
      break;
    case "concerned":
      transform(controller, "head", { rotation: [0.03, 0, 0.13] }, w);
      transform(controller, "leftShoulder", { rotation: [0.12, 0, -0.07] }, w);
      break;
    case "severe":
      transform(controller, "spine", { rotation: [-0.11, 0, 0] }, w);
      transform(controller, "leftShoulder", { rotation: [0.14, 0, -0.12] }, w);
      transform(controller, "rightShoulder", { rotation: [0.14, 0, 0.12] }, w);
      break;
    case "confident":
      transform(controller, "spine", { rotation: [0.055, 0, 0] }, w);
      transform(controller, "head", { rotation: [-0.035, Math.sin(time * 0.5) * 0.015, 0] }, w);
      break;
    default:
      break;
  }
}

function applyGaze(controller, nowMs) {
  const active = nowMs <= controller.look.until;
  const decay = active ? 1 : Math.max(0, 1 - (nowMs - controller.look.until) / 500);
  if (decay === 0) return;
  transform(controller, "head", {
    rotation: [-controller.look.y * 0.2, -controller.look.x * 0.38, controller.look.x * 0.04],
  }, decay);
}

function applySpeech(controller, time) {
  const energy = controller.speechEnergy;
  if (energy < 0.005) return;
  transform(controller, "head", { rotation: [Math.sin(time * 10.7) * energy * 0.035, 0, 0] });
  transform(controller, "rightHand", { rotation: [0, 0, Math.sin(time * 4.3) * energy * 0.12] });
}

function applyPresence(controller) {
  const root = controller.rig.nodes.get("root");
  if (controller.presence === "compact") root.scale.multiplyScalar(0.8);
  if (controller.presence === "sentinel") root.scale.multiplyScalar(1.08);
}

function acknowledge(c, p, w) {
  transform(c, "head", { rotation: [Math.sin(p * TAU * 1.5) * 0.26, 0, 0] }, w);
  transform(c, "rightShoulder", { rotation: [-0.18, 0, 0.22] }, w);
}

function arrive(c, p, w) {
  const landing = Math.sin(Math.min(1, p * 1.2) * Math.PI);
  transform(c, "root", { position: [0, (1 - easeOutCubic(p)) * 1.4 + landing * 0.08, 0] }, w);
  transform(c, "leftShoulder", { rotation: [-0.45 * (1 - p), 0, 0.32] }, w);
  transform(c, "rightShoulder", { rotation: [0.45 * (1 - p), 0, -0.32] }, w);
}

function brace(c, p, w) {
  const hit = Math.sin(p * Math.PI);
  transform(c, "spine", { rotation: [-0.14 * hit, 0, 0] }, w);
  transform(c, "leftShoulder", { rotation: [-0.72 * hit, 0.25, -0.42 * hit] }, w);
  transform(c, "rightShoulder", { rotation: [-0.72 * hit, -0.25, 0.42 * hit] }, w);
  transform(c, "leftElbow", { rotation: [-0.8 * hit, 0, 0] }, w);
  transform(c, "rightElbow", { rotation: [-0.8 * hit, 0, 0] }, w);
}

function celebrate(c, p, w) {
  const bounce = Math.abs(Math.sin(p * Math.PI * 3)) * 0.18;
  transform(c, "root", { position: [0, bounce, 0], rotation: [0, Math.sin(p * TAU) * 0.18, 0] }, w);
  transform(c, "leftShoulder", { rotation: [0, 0, -2.55] }, w);
  transform(c, "rightShoulder", { rotation: [0, 0, 2.55] }, w);
  transform(c, "leftElbow", { rotation: [0, 0, -0.35] }, w);
  transform(c, "rightElbow", { rotation: [0, 0, 0.35] }, w);
}

function decline(c, p, w) {
  transform(c, "head", { rotation: [0, Math.sin(p * TAU * 2) * 0.34, 0] }, w);
  transform(c, "rightShoulder", { rotation: [-0.35, -0.25, 0.65] }, w);
  transform(c, "rightElbow", { rotation: [0, 0, -0.75] }, w);
}

function dance(c, p, w) {
  const beat = Math.sin(p * TAU * 4);
  const off = Math.cos(p * TAU * 4);
  transform(c, "root", { position: [beat * 0.16, Math.abs(off) * 0.1, 0], rotation: [0, beat * 0.28, beat * 0.08] }, w);
  transform(c, "leftShoulder", { rotation: [off * 0.6, 0, -1.05 - beat * 0.45] }, w);
  transform(c, "rightShoulder", { rotation: [-off * 0.6, 0, 1.05 - beat * 0.45] }, w);
  transform(c, "leftHip", { rotation: [beat * 0.36, 0, 0.12] }, w);
  transform(c, "rightHip", { rotation: [-beat * 0.36, 0, -0.12] }, w);
}

function jump(c, p, w) {
  const height = Math.sin(p * Math.PI) * 1.15;
  const crouch = p < 0.16 ? Math.sin((p / 0.16) * Math.PI) * 0.24 : 0;
  transform(c, "root", { position: [0, height - crouch, 0] }, w);
  transform(c, "leftHip", { rotation: [-crouch * 1.8, 0, 0] }, w);
  transform(c, "rightHip", { rotation: [-crouch * 1.8, 0, 0] }, w);
  transform(c, "leftElbow", { rotation: [-height * 0.55, 0, 0] }, w);
  transform(c, "rightElbow", { rotation: [-height * 0.55, 0, 0] }, w);
}

function point(c, p, w, sign) {
  const arm = sign > 0 ? "left" : "right";
  transform(c, `${arm}Shoulder`, { rotation: [-0.18, sign * 0.15, -sign * 1.47] }, w);
  transform(c, `${arm}Elbow`, { rotation: [0, 0, sign * 0.08] }, w);
  transform(c, "head", { rotation: [0, sign * 0.3, -sign * 0.04] }, w);
  transform(c, "spine", { rotation: [0, sign * 0.12, 0] }, w);
}

function roll(c, p, w) {
  const arc = Math.sin(p * Math.PI) * 0.72;
  transform(c, "root", { position: [Math.sin(p * TAU) * 0.42, arc, 0], rotation: [0, 0, p * TAU] }, w);
  transform(c, "leftHip", { rotation: [-0.75, 0, 0.18] }, w);
  transform(c, "rightHip", { rotation: [-0.75, 0, -0.18] }, w);
  transform(c, "leftElbow", { rotation: [-1.05, 0, 0] }, w);
  transform(c, "rightElbow", { rotation: [-1.05, 0, 0] }, w);
}

function salute(c, p, w) {
  const snap = Math.min(1, p * 5);
  transform(c, "rightShoulder", { rotation: [-0.25, -0.2, 1.15 * snap] }, w);
  transform(c, "rightElbow", { rotation: [-1.82 * snap, 0.15, -0.2] }, w);
  transform(c, "rightHand", { rotation: [0.1, 0, -0.18] }, w);
  transform(c, "head", { rotation: [-0.03, 0, 0] }, w);
}

function scan(c, p, w) {
  const sweep = Math.sin((p - 0.25) * TAU) * 0.58;
  transform(c, "head", { rotation: [0.04, sweep, 0] }, w);
  transform(c, "chest", { rotation: [0, sweep * 0.24, 0] }, w);
  transform(c, "leftShoulder", { rotation: [-0.2, 0, 0.12] }, w);
}

function stretch(c, p, w) {
  const reach = Math.sin(p * Math.PI);
  transform(c, "root", { position: [0, reach * 0.12, 0] }, w);
  transform(c, "spine", { rotation: [reach * 0.09, 0, 0] }, w);
  transform(c, "leftShoulder", { rotation: [0, 0, -2.7 * reach] }, w);
  transform(c, "rightShoulder", { rotation: [0, 0, 2.7 * reach] }, w);
  transform(c, "leftElbow", { rotation: [0, 0, -0.18 * reach] }, w);
  transform(c, "rightElbow", { rotation: [0, 0, 0.18 * reach] }, w);
}

function think(c, p, w) {
  const settle = Math.min(1, p * 4);
  transform(c, "head", { rotation: [0.12, -0.22, 0.08] }, w);
  transform(c, "spine", { rotation: [-0.06, 0.12, 0] }, w);
  transform(c, "rightShoulder", { rotation: [-0.18, -0.15, 0.88 * settle] }, w);
  transform(c, "rightElbow", { rotation: [-1.72 * settle, 0, -0.18] }, w);
  transform(c, "rightHand", { rotation: [0, Math.sin(p * TAU * 2) * 0.08, 0] }, w);
}

function wave(c, p, w) {
  transform(c, "rightShoulder", { rotation: [0, 0, 2.15] }, w);
  transform(c, "rightElbow", { rotation: [0, 0, -0.58] }, w);
  transform(c, "rightHand", { rotation: [0, 0, Math.sin(p * TAU * 3) * 0.55] }, w);
  transform(c, "head", { rotation: [0, -0.14, -0.04] }, w);
}

function work(c, p, w) {
  const cycle = p * TAU * 4;
  transform(c, "spine", { rotation: [-0.14, 0, 0] }, w);
  transform(c, "head", { rotation: [0.16, Math.sin(cycle * 0.3) * 0.1, 0] }, w);
  transform(c, "leftShoulder", { rotation: [-0.62 + Math.sin(cycle) * 0.12, 0, -0.34] }, w);
  transform(c, "rightShoulder", { rotation: [-0.62 + Math.sin(cycle + Math.PI) * 0.12, 0, 0.34] }, w);
  transform(c, "leftElbow", { rotation: [-0.72 + Math.sin(cycle + 0.7) * 0.18, 0, 0] }, w);
  transform(c, "rightElbow", { rotation: [-0.72 + Math.sin(cycle + 2.7) * 0.18, 0, 0] }, w);
}

function transform(controller, nodeName, values, weight = 1) {
  const node = controller.rig.nodes.get(nodeName);
  if (!node || weight === 0) return;
  if (values.position) {
    node.position.x += values.position[0] * weight;
    node.position.y += values.position[1] * weight;
    node.position.z += values.position[2] * weight;
  }
  if (values.rotation) {
    node.rotation.x += values.rotation[0] * weight;
    node.rotation.y += values.rotation[1] * weight;
    node.rotation.z += values.rotation[2] * weight;
  }
}

function smoothEnvelope(progress) {
  const fade = 0.12;
  if (progress < fade) return smoothstep(progress / fade);
  if (progress > 1 - fade) return smoothstep((1 - progress) / fade);
  return 1;
}

function smoothstep(value) {
  const v = clamp01(value);
  return v * v * (3 - 2 * v);
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

if (Object.keys(MOTION_CLIPS).length !== EMBODIMENT_ACTIONS.length) {
  throw new Error("Every public embodiment action must have one real motion clip.");
}
