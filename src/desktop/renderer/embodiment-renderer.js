"use strict";

import * as THREE from "three";

import {
  ACTIVITY_PRESENTATION,
  createEmbodimentCommand,
} from "../../embodiment/contracts.js";
import { RigMotionSystem } from "./motion-system.js";
import { loadAuthoredRig } from "./gltf-rig-adapter.js";
import { createOriginalTakerRig } from "./original-rig.js";

export class EmbodimentRenderer {
  constructor({ canvas, reportEvent }) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("A canvas is required.");
    this.canvas = canvas;
    this.reportEvent = reportEvent;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.rig = null;
    this.motion = null;
    this.frameHandle = null;
    this.lastFrameMs = 0;
    this.framesSinceTelemetry = 0;
    this.telemetryStartedAt = 0;
    this.destroyed = false;
  }

  start() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(29, 1, 0.1, 40);
    this.camera.position.set(0, -0.08, 9.1);
    this.camera.lookAt(0, -0.18, 0);

    const key = new THREE.DirectionalLight(0x9befff, 2.4);
    key.position.set(-3, 4, 5);
    const rim = new THREE.DirectionalLight(0x5c55ff, 1.9);
    rim.position.set(4, 2, -3);
    const fill = new THREE.HemisphereLight(0x64eaff, 0x020609, 0.85);
    this.scene.add(key, rim, fill);

    this.rig = createOriginalTakerRig();
    this.scene.add(this.rig.root);
    this.motion = new RigMotionSystem(this.rig, {
      onActionEvent: (event) => {
        this.canvas.dataset.action = event.type === "action_started" ? event.action : "";
        this.reportEvent(event);
      },
    });

    this.canvas.addEventListener("webglcontextlost", this.#onContextLost);
    this.resize();
    this.lastFrameMs = performance.now();
    this.telemetryStartedAt = this.lastFrameMs;
    this.frameHandle = requestAnimationFrame(this.#render);
    this.reportEvent({ type: "ready", backend: "three-webgl-original-rig" });
    void this.#upgradeToAuthoredRig();
  }

  handleActivity(event) {
    const presentation = ACTIVITY_PRESENTATION[event?.uiState] ?? ACTIVITY_PRESENTATION.error;
    this.motion.setMood(presentation.mood, 1);
    if (presentation.action && this.motion.action?.name !== presentation.action) {
      this.motion.playAction(presentation.action, { intensity: 0.78, interrupt: true });
    }
  }

  handleCommand(rawCommand) {
    let command;
    try {
      command = createEmbodimentCommand(rawCommand?.type, rawCommand?.payload, rawCommand?.requestId);
      switch (command.type) {
        case "inspect":
          break;
        case "play_action":
          this.motion.playAction(command.payload.action, command.payload);
          break;
        case "set_mood":
          this.motion.setMood(command.payload.mood, command.payload.intensity);
          break;
        case "set_presence":
          this.motion.setPresence(command.payload.mode);
          break;
        case "look_at":
          this.motion.lookAt(command.payload.x, command.payload.y, command.payload.holdMs);
          break;
        case "set_speech_energy":
          this.motion.setSpeechEnergy(command.payload.energy);
          break;
        default:
          throw new TypeError(`Unsupported command ${command.type}.`);
      }
      this.reportEvent({ type: "accepted", requestId: command.requestId });
    } catch (error) {
      this.reportEvent({
        type: "error",
        ...(typeof rawCommand?.requestId === "string" ? { requestId: rawCommand.requestId } : {}),
        message: error?.message || String(error),
      });
    }
  }

  setSpeechEnergy(value) {
    this.motion?.setSpeechEnergy(value);
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  destroy() {
    this.destroyed = true;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.canvas.removeEventListener("webglcontextlost", this.#onContextLost);
    this.scene?.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material?.dispose?.();
    });
    this.renderer?.dispose();
  }

  #render = (nowMs) => {
    if (this.destroyed) return;
    const deltaSeconds = Math.min(0.05, Math.max(0, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;
    this.motion.update(nowMs, deltaSeconds);
    this.renderer.render(this.scene, this.camera);
    this.framesSinceTelemetry += 1;
    if (nowMs - this.telemetryStartedAt >= 5_000) {
      const seconds = (nowMs - this.telemetryStartedAt) / 1000;
      this.reportEvent({
        type: "telemetry",
        fps: this.framesSinceTelemetry / seconds,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      });
      this.framesSinceTelemetry = 0;
      this.telemetryStartedAt = nowMs;
    }
    this.frameHandle = requestAnimationFrame(this.#render);
  };

  #onContextLost = (event) => {
    event.preventDefault();
    this.reportEvent({ type: "error", message: "WebGL context was lost." });
  };

  async #upgradeToAuthoredRig() {
    try {
      const url = new URL("embodiment/taker-agent.glb", window.location.href).href;
      const authoredRig = await loadAuthoredRig(url);
      const previousRoot = this.rig.root;
      const previousMood = this.motion.mood;
      const previousMoodIntensity = this.motion.moodIntensity;
      const previousPresence = this.motion.presence;
      this.scene.remove(previousRoot);
      disposeHierarchy(previousRoot);
      this.scene.add(authoredRig.sceneRoot);
      this.rig = authoredRig;
      this.motion = new RigMotionSystem(this.rig, {
        onActionEvent: (event) => {
          this.canvas.dataset.action = event.type === "action_started" ? event.action : "";
          this.reportEvent(event);
        },
      });
      this.motion.setMood(previousMood, previousMoodIntensity);
      this.motion.setPresence(previousPresence);
      this.reportEvent({ type: "ready", backend: "three-webgl-authored-glb" });
    } catch (error) {
      this.reportEvent({
        type: "error",
        message: `Authored GLB unavailable; using fallback rig: ${error?.message || String(error)}`,
      });
    }
  }
}

function disposeHierarchy(root) {
  const materials = new Set();
  root.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
    else if (object.material) materials.add(object.material);
  });
  for (const material of materials) material.dispose?.();
}
