import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  protocol,
  screen,
  session,
} from "electron";

import { loadConfig } from "../config.js";
import { createRuntime } from "../runtime.js";
import { PocketTts } from "../voice/pocket-tts.js";
import { VoiceOrchestrator } from "../voice/voice-orchestrator.js";
import { WhisperCppStt } from "../voice/whisper-cpp-stt.js";
import { RendererAudioPlayer } from "./renderer-audio-player.js";
import { RendererVadAdapter } from "./renderer-vad-adapter.js";
import {
  createPetWindowOptions,
  createPopoverWindowOptions,
  isTrustedAppUrl,
  PET_WINDOW_SIZE,
  POPOVER_WINDOW_SIZE,
} from "./window-policy.js";

const DESKTOP_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(DESKTOP_DIRECTORY, "..", "..");
const RENDERER_DIRECTORY = path.join(
  PROJECT_ROOT,
  "dist",
  "desktop",
  "renderer",
);
const PET_PRELOAD_PATH = path.join(DESKTOP_DIRECTORY, "preload.cjs");
const POPOVER_PRELOAD_PATH = path.join(
  DESKTOP_DIRECTORY,
  "popover-preload.cjs",
);
const MAX_SPEECH_BYTES = 7_680_000;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "taker",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      codeCache: true,
    },
  },
]);

let petWindow = null;
let popoverWindow = null;
let runtime = null;
let voice = null;
let rendererVad = null;
let sttProvider = null;
let ttsProvider = null;
let rendererAudioPlayer = null;
let textSpeechController = null;
let unsubscribeState = null;
let unsubscribeSession = null;
let microphoneAuthorized = false;
let popoverView = null;
let popoverHideTimer = null;
let pendingApproval = null;
let petDrag = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  if (!petWindow) return;
  petWindow.show();
  petWindow.moveTop();
});

app.whenReady().then(async () => {
  registerLocalProtocol();

  const config = loadConfig(process.env, process.cwd());
  runtime = createRuntime(config);
  petWindow = createPetWindow();
  popoverWindow = createPopoverWindow();
  installSessionGuards();
  installIpcHandlers();
  attachRuntimeState();
  createVoiceRuntime(config);
  void ttsProvider.verify().catch((error) => {
    console.error(`[voice] Pocket TTS warm-up failed: ${error.message}`);
  });

  await Promise.all([
    petWindow.loadURL("taker://app/index.html"),
    popoverWindow.loadURL("taker://app/popover.html"),
  ]);
  positionPet(petWindow);
  petWindow.showInactive();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  microphoneAuthorized = false;
  textSpeechController?.abort("application_quit");
  void voice?.stop("application_quit");
  void ttsProvider?.stop("application_quit");
  ttsProvider?.dispose?.();
  unsubscribeState?.();
  unsubscribeState = null;
  unsubscribeSession?.();
  unsubscribeSession = null;
  resolveApproval(false);
});

function registerLocalProtocol() {
  protocol.handle("taker", (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "app") {
      return new Response("Not found", { status: 404 });
    }
    let relativePath;
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!relativePath || relativePath.includes("\0")) {
      return new Response("Not found", { status: 404 });
    }
    const filePath = path.resolve(RENDERER_DIRECTORY, relativePath);
    const relative = path.relative(RENDERER_DIRECTORY, filePath);
    if (
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative)
    ) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).href);
  });
}

function installSessionGuards() {
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission) =>
      permission === "media" &&
      microphoneAuthorized &&
      webContents === petWindow?.webContents &&
      isTrustedAppUrl(webContents.getURL()),
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes = details?.mediaTypes ?? [];
      const audioOnly =
        mediaTypes.length > 0 &&
        mediaTypes.every((mediaType) => mediaType === "audio");
      callback(
        permission === "media" &&
          audioOnly &&
          microphoneAuthorized &&
          webContents === petWindow?.webContents &&
          isTrustedAppUrl(webContents.getURL()),
      );
    },
  );
}

function createPetWindow() {
  const window = new BrowserWindow(
    createPetWindowOptions(PET_PRELOAD_PATH),
  );
  installWindowNavigationGuards(window);
  window.webContents.on("context-menu", () => showPetMenu(window));
  window.on("closed", () => {
    petWindow = null;
  });
  return window;
}

function createPopoverWindow() {
  const window = new BrowserWindow(
    createPopoverWindowOptions(POPOVER_PRELOAD_PATH),
  );
  installWindowNavigationGuards(window);
  window.on("closed", () => {
    popoverWindow = null;
    resolveApproval(false);
  });
  return window;
}

function installWindowNavigationGuards(window) {
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function attachRuntimeState() {
  unsubscribeState = runtime.activityState.subscribe(
    (event) => {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send("activity-state", sanitizeStateEvent(event));
      }
    },
    { emitCurrent: true },
  );
  unsubscribeSession = runtime.session.subscribe((event) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const safeEvent = sanitizeCharacterEvent(event);
    if (safeEvent) petWindow.webContents.send("character:event", safeEvent);
  });
}

function createVoiceRuntime(config) {
  const voiceRoot = path.join(PROJECT_ROOT, ".agent", "runtime", "voice");
  sttProvider = new WhisperCppStt({
    binaryPath: path.join(
      voiceRoot,
      "whisper.cpp-v1.8.6",
      "Release",
      "whisper-cli.exe",
    ),
    modelPath: path.join(voiceRoot, "models", "ggml-base.bin"),
    tempDirectory: path.join(config.workspace, ".agent", "tmp", "stt"),
    language: "auto",
    threads: 4,
  });
  rendererVad = new RendererVadAdapter({
    sendCommand(command) {
      petWindow?.webContents.send("voice:command", command);
    },
  });
  rendererAudioPlayer = new RendererAudioPlayer({
    sendCommand(command) {
      if (!petWindow || petWindow.isDestroyed()) {
        throw new Error("The character audio renderer is unavailable.");
      }
      petWindow.webContents.send("voice:playback-command", command);
    },
  });
  ttsProvider = new PocketTts({
    pythonPath: path.join(
      voiceRoot,
      "pocket-tts-3.0.2",
      "Scripts",
      "python.exe",
    ),
    workerPath: path.join(PROJECT_ROOT, "src", "voice", "pocket-tts-worker.py"),
    cacheDirectory: path.join(voiceRoot, "huggingface"),
    audioPlayer: rendererAudioPlayer,
    voice: config.voiceProfile,
    language: "english",
    numThreads: 2,
  });
  voice = new VoiceOrchestrator({
    session: runtime.session,
    vad: rendererVad,
    stt: sttProvider,
    tts: ttsProvider,
    requestApproval,
    onTranscript(text) {
      showPopover({
        mode: "message",
        title: "Heard",
        text,
        tone: "neutral",
      });
    },
    onResponse(text) {
      showPopover(
        {
          mode: "message",
          title: "Taker",
          text,
          tone: "response",
        },
        { autoHideMs: 45_000 },
      );
    },
    onError(error) {
      showError(error);
    },
  });
}

function installIpcHandlers() {
  ipcMain.on("pet:activate", (event) => {
    if (!isPetSender(event)) return;
    showPromptPopover();
  });

  ipcMain.on("pet:renderer-error", (event, message) => {
    if (!isPetSender(event) || typeof message !== "string") return;
    showError(new Error("Character renderer failed: " + message.slice(0, 500)));
  });

  ipcMain.on("pet:drag-start", (event, point) => {
    if (!isPetSender(event) || !isSafePoint(point) || !petWindow) return;
    const [windowX, windowY] = petWindow.getPosition();
    petDrag = {
      pointerX: point.x,
      pointerY: point.y,
      windowX,
      windowY,
    };
  });

  ipcMain.on("pet:drag-move", (event, point) => {
    if (!isPetSender(event) || !isSafePoint(point) || !petDrag || !petWindow) {
      return;
    }
    const display = screen.getDisplayNearestPoint(point);
    const x = clamp(
      petDrag.windowX + point.x - petDrag.pointerX,
      display.workArea.x,
      display.workArea.x + display.workArea.width - PET_WINDOW_SIZE.width,
    );
    const y = clamp(
      petDrag.windowY + point.y - petDrag.pointerY,
      display.workArea.y,
      display.workArea.y + display.workArea.height - PET_WINDOW_SIZE.height,
    );
    petWindow.setPosition(Math.round(x), Math.round(y), false);
  });

  ipcMain.on("pet:drag-end", (event) => {
    if (!isPetSender(event)) return;
    petDrag = null;
  });

  ipcMain.on("activity-state:ready", (event) => {
    if (petWindow && event.sender === petWindow.webContents) {
      event.sender.send("activity-state", {
        type: "activity_state_snapshot",
        sequence: 0,
        current: runtime.activityState.snapshot,
        uiState: runtime.activityState.uiState,
      });
    }
  });

  ipcMain.on("voice:event", (event, payload) => {
    if (!isPetSender(event) || !isVoiceEvent(payload)) return;
    try {
      rendererVad?.handleEvent(payload);
    } catch (error) {
      showError(error);
    }
  });

  ipcMain.on("voice:speech-segment", (event, payload) => {
    if (!isPetSender(event) || !(payload instanceof ArrayBuffer)) return;
    if (
      payload.byteLength === 0 ||
      payload.byteLength > MAX_SPEECH_BYTES ||
      payload.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0
    ) {
      return;
    }
    try {
      rendererVad?.handleSpeech(new Float32Array(payload.slice(0)));
    } catch (error) {
      showError(error);
    }
  });

  ipcMain.on("voice:playback-event", (event, payload) => {
    if (!isPetSender(event) || !isPlaybackEvent(payload)) return;
    rendererAudioPlayer?.handleEvent(payload);
  });

  ipcMain.on("popover:ready", (event) => {
    if (isPopoverSender(event) && popoverView) {
      event.sender.send("popover:view", popoverView);
    }
  });

  ipcMain.on("popover:action", (event, action) => {
    if (!isPopoverSender(event) || !action || typeof action !== "object") {
      return;
    }
    handlePopoverAction(action);
  });
}

function handlePopoverAction(action) {
  switch (action.type) {
    case "prompt": {
      const text =
        typeof action.text === "string" ? action.text.trim().slice(0, 20_000) : "";
      if (!text) return;
      hidePopover();
      void sendTextTurn(text);
      break;
    }
    case "approve":
      if (action.id === pendingApproval?.id) resolveApproval(true);
      break;
    case "deny":
      if (action.id === pendingApproval?.id) resolveApproval(false);
      break;
    case "dismiss":
      if (pendingApproval) resolveApproval(false);
      else hidePopover();
      break;
    default:
      break;
  }
}

async function sendTextTurn(text) {
  if (runtime.session.isBusy) {
    showPopover({
      mode: "message",
      title: "Busy",
      text: "Interrupt the active turn before starting another one.",
      tone: "warning",
    });
    return;
  }
  try {
    await interruptActiveWork("new_text_turn");
    const response = await runtime.session.send(text, { requestApproval });
    showPopover(
      {
        mode: "message",
        title: "Taker",
        text: response.content,
        tone: "response",
      },
      { autoHideMs: 45_000 },
    );
    await speakTextResponse(response.content);
  } catch (error) {
    if (error?.name !== "AbortError" && error?.code !== "REQUEST_ABORTED") {
      showError(error);
    }
  }
}

async function setListening(enabled) {
  try {
    if (enabled) {
      await Promise.all([sttProvider.verify(), ttsProvider.verify()]);
      microphoneAuthorized = true;
      await voice.start();
      showPopover({
        mode: "message",
        title: "Listening",
        text: "Speak naturally. Right-click the pet to stop listening.",
        tone: "neutral",
      });
    } else {
      await voice.stop("user_stopped_listening");
      microphoneAuthorized = false;
      showPopover({
        mode: "message",
        title: "Microphone off",
        text: "Listening has stopped.",
        tone: "neutral",
      });
    }
  } catch (error) {
    microphoneAuthorized = false;
    showError(
      error?.code === "ENOENT"
        ? new Error("Local voice runtime is missing. Run npm run voice:install.")
        : error,
    );
  }
}

function requestApproval(request) {
  if (pendingApproval) resolveApproval(false);
  return new Promise((resolve) => {
    const id = randomUUID();
    const timer = setTimeout(() => resolveApproval(false), 60_000);
    pendingApproval = { id, resolve, timer };
    const flags = [
      request.assessment.destructive ? "destructive" : null,
      request.assessment.elevated ? "administrator" : null,
      request.assessment.outsideWorkspace ? "outside workspace" : null,
      request.assessment.ambiguous ? "ambiguous" : null,
    ].filter(Boolean);
    showPopover({
      mode: "approval",
      id,
      title: "Approval required",
      summary: request.assessment.summary,
      risk: request.tool.risk,
      flags,
      details: JSON.stringify(request.arguments, null, 2).slice(0, 16_000),
    });
  });
}

function resolveApproval(approved) {
  if (!pendingApproval) return false;
  const approval = pendingApproval;
  pendingApproval = null;
  clearTimeout(approval.timer);
  hidePopover();
  approval.resolve(approved === true);
  return true;
}

function showPetMenu(window) {
  const mode = runtime.permissionPolicy.mode;
  const listening = voice?.isRunning === true;
  const menu = Menu.buildFromTemplate([
    { label: "Taker Takeover", enabled: false },
    { label: "State: " + runtime.activityState.uiState, enabled: false },
    { type: "separator" },
    {
      label: "Ask Taker...",
      click: showPromptPopover,
    },
    {
      label: listening ? "Stop listening" : "Start listening",
      click: () => void setListening(!listening),
    },
    {
      label: "Interrupt active work or speech",
      enabled:
        runtime.session.isBusy ||
        runtime.activityState.snapshot.audioOutput !== "silent",
      click: () => void interruptActiveWork("user_interruption"),
    },
    { type: "separator" },
    {
      label: "Approve every tool",
      type: "radio",
      checked: mode === "approval",
      click: () => runtime.permissionPolicy.setMode("approval"),
    },
    {
      label: "Semi-autonomous",
      type: "radio",
      checked: mode === "semi",
      click: () => runtime.permissionPolicy.setMode("semi"),
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  menu.popup({ window });
}

function showPromptPopover() {
  showPopover({
    mode: "prompt",
    title: "Taker",
    placeholder: "Give Taker a task…",
  });
}

function showPopover(view, { autoHideMs = 8_000 } = {}) {
  if (!popoverWindow || popoverWindow.isDestroyed()) return;
  clearTimeout(popoverHideTimer);
  popoverHideTimer = null;
  popoverView = structuredClone(view);
  const size = popoverSizeFor(view);
  popoverWindow.setContentSize(size.width, size.height, false);
  positionPopover();
  popoverWindow.webContents.send("popover:view", popoverView);
  popoverWindow.show();
  if (view.mode === "prompt" || view.mode === "approval") {
    popoverWindow.focus();
  } else if (autoHideMs > 0) {
    popoverHideTimer = setTimeout(hidePopover, autoHideMs);
  }
}

function hidePopover() {
  clearTimeout(popoverHideTimer);
  popoverHideTimer = null;
  popoverView = null;
  if (popoverWindow && !popoverWindow.isDestroyed()) popoverWindow.hide();
}

function showError(error) {
  showPopover(
    {
      mode: "message",
      title: "Voice/runtime error",
      text: error?.message || String(error),
      tone: "error",
    },
    { autoHideMs: 14_000 },
  );
}

function positionPet(window) {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const x =
    display.workArea.x +
    display.workArea.width -
    PET_WINDOW_SIZE.width -
    PET_WINDOW_SIZE.edgeInset;
  const y =
    display.workArea.y +
    display.workArea.height -
    PET_WINDOW_SIZE.height -
    PET_WINDOW_SIZE.edgeInset;
  window.setPosition(Math.round(x), Math.round(y), false);
}

function positionPopover() {
  if (!petWindow || !popoverWindow) return;
  const petBounds = petWindow.getBounds();
  const popoverBounds = popoverWindow.getBounds();
  const display = screen.getDisplayMatching(petBounds);
  const preferredX =
    petBounds.x + petBounds.width - popoverBounds.width;
  const preferredY =
    petBounds.y - popoverBounds.height - POPOVER_WINDOW_SIZE.gap;
  const x = clamp(
    preferredX,
    display.workArea.x,
      display.workArea.x +
      display.workArea.width -
      popoverBounds.width,
  );
  const y = clamp(
    preferredY,
    display.workArea.y,
      display.workArea.y +
      display.workArea.height -
      popoverBounds.height,
  );
  popoverWindow.setPosition(Math.round(x), Math.round(y), false);
}

async function speakTextResponse(text) {
  textSpeechController?.abort("superseded");
  const controller = new AbortController();
  textSpeechController = controller;
  try {
    runtime.activityState.transition("audioOutput", "synthesizing", {
      source: "typed_turn",
      reason: "response_ready",
    });
    await ttsProvider.speak(text, {
      signal: controller.signal,
      onPlaybackStart() {
        if (
          !controller.signal.aborted &&
          runtime.activityState.snapshot.audioOutput === "synthesizing"
        ) {
          runtime.activityState.transition("audioOutput", "speaking", {
            source: "pocket_tts",
            reason: "playback_started",
          });
        }
      },
    });
  } finally {
    if (textSpeechController === controller) textSpeechController = null;
    if (runtime.activityState.snapshot.audioOutput !== "silent") {
      runtime.activityState.transition("audioOutput", "silent", {
        source: "pocket_tts",
        reason: controller.signal.aborted
          ? "playback_interrupted"
          : "playback_completed",
      });
    }
  }
}

async function interruptActiveWork(reason) {
  textSpeechController?.abort(reason);
  textSpeechController = null;
  await voice?.interrupt(reason);
}

function popoverSizeFor(view) {
  if (view?.mode === "prompt") return { width: 520, height: 228 };
  if (view?.mode === "approval") return { width: 560, height: 440 };
  const characters = typeof view?.text === "string" ? view.text.length : 0;
  if (characters <= 220) return { width: 520, height: 224 };
  if (characters <= 700) return { width: 540, height: 310 };
  return { width: 560, height: 420 };
}

function sanitizeStateEvent(event) {
  return {
    type: event.type,
    sequence: event.sequence,
    timestamp: event.timestamp,
    changedAxes: event.changedAxes,
    current: event.current,
    uiState: event.uiState,
  };
}

function sanitizeCharacterEvent(event) {
  if (!event || typeof event.type !== "string") return null;
  const allowed = new Set([
    "turn_started",
    "thinking",
    "tool_started",
    "tool_completed",
    "approval_requested",
    "approval_resolved",
    "completed",
    "turn_completed",
    "interruption_requested",
    "turn_cancelled",
    "turn_failed",
  ]);
  if (!allowed.has(event.type)) return null;
  return {
    type: event.type,
    ...(typeof event.name === "string" ? { name: event.name.slice(0, 80) } : {}),
    ...(new Set(["powershell", "cmd", "bash"]).has(event.shell)
      ? { shell: event.shell }
      : {}),
    ...(typeof event.operation === "string" &&
    /^(?:package\.install|test\.run|build\.compile|filesystem\.search)$/.test(event.operation)
      ? { operation: event.operation }
      : {}),
    ...(typeof event.approved === "boolean" ? { approved: event.approved } : {}),
    ...(typeof event.errorCode === "string"
      ? { errorCode: event.errorCode.slice(0, 80) }
      : {}),
  };
}

function isPetSender(event) {
  return petWindow && event.sender === petWindow.webContents;
}

function isPopoverSender(event) {
  return popoverWindow && event.sender === popoverWindow.webContents;
}

function isVoiceEvent(payload) {
  return (
    payload &&
    typeof payload === "object" &&
    new Set([
      "started",
      "stopped",
      "speech_started",
      "vad_misfire",
      "error",
    ]).has(payload.type)
  );
}

function isPlaybackEvent(payload) {
  return (
    payload &&
    typeof payload === "object" &&
    typeof payload.id === "string" &&
    payload.id.length <= 80 &&
    new Set(["started", "ended", "stopped", "error"]).has(payload.type)
  );
}

function isSafePoint(value) {
  return (
    value &&
    typeof value === "object" &&
    Number.isInteger(value.x) &&
    Number.isInteger(value.y) &&
    Math.abs(value.x) <= 100_000 &&
    Math.abs(value.y) <= 100_000
  );
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
