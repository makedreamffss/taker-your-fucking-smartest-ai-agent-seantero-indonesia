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
import { VoiceOrchestrator } from "../voice/voice-orchestrator.js";
import { WhisperCppStt } from "../voice/whisper-cpp-stt.js";
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
let unsubscribeState = null;
let microphoneAuthorized = false;
let popoverView = null;
let popoverHideTimer = null;
let pendingApproval = null;

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
  void voice?.stop("application_quit");
  unsubscribeState?.();
  unsubscribeState = null;
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
}

function createVoiceRuntime(config) {
  const voiceRoot = path.join(config.workspace, ".agent", "runtime", "voice");
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
  const textOnlyOutput = {
    async speak() {},
    async stop() {},
  };
  voice = new VoiceOrchestrator({
    session: runtime.session,
    vad: rendererVad,
    stt: sttProvider,
    tts: textOnlyOutput,
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
        { autoHideMs: 14_000 },
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
    const response = await runtime.session.send(text, { requestApproval });
    showPopover(
      {
        mode: "message",
        title: "Taker",
        text: response.content,
        tone: "response",
      },
      { autoHideMs: 14_000 },
    );
  } catch (error) {
    if (error?.name !== "AbortError" && error?.code !== "REQUEST_ABORTED") {
      showError(error);
    }
  }
}

async function setListening(enabled) {
  try {
    if (enabled) {
      await sttProvider.verify();
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
      label: "Interrupt active turn",
      enabled: runtime.session.isBusy,
      click: () => runtime.session.interrupt("user_interruption"),
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
    title: "Ask Taker",
    placeholder: "What should I do?",
  });
}

function showPopover(view, { autoHideMs = 8_000 } = {}) {
  if (!popoverWindow || popoverWindow.isDestroyed()) return;
  clearTimeout(popoverHideTimer);
  popoverHideTimer = null;
  popoverView = structuredClone(view);
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
  const display = screen.getDisplayMatching(petBounds);
  const preferredX =
    petBounds.x + petBounds.width - POPOVER_WINDOW_SIZE.width;
  const preferredY =
    petBounds.y - POPOVER_WINDOW_SIZE.height - POPOVER_WINDOW_SIZE.gap;
  const x = clamp(
    preferredX,
    display.workArea.x,
    display.workArea.x +
      display.workArea.width -
      POPOVER_WINDOW_SIZE.width,
  );
  const y = clamp(
    preferredY,
    display.workArea.y,
    display.workArea.y +
      display.workArea.height -
      POPOVER_WINDOW_SIZE.height,
  );
  popoverWindow.setPosition(Math.round(x), Math.round(y), false);
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

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
