export const PET_WINDOW_SIZE = Object.freeze({
  width: 124,
  height: 124,
  edgeInset: 18,
});

export const POPOVER_WINDOW_SIZE = Object.freeze({
  width: 380,
  height: 220,
  gap: 10,
});

export function createPetWindowOptions(preloadPath) {
  if (typeof preloadPath !== "string" || preloadPath.length === 0) {
    throw new TypeError("A preload path is required.");
  }

  return {
    width: PET_WINDOW_SIZE.width,
    height: PET_WINDOW_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    roundedCorners: false,
    webPreferences: createSecureWebPreferences(preloadPath),
  };
}

export function createPopoverWindowOptions(preloadPath) {
  if (typeof preloadPath !== "string" || preloadPath.length === 0) {
    throw new TypeError("A preload path is required.");
  }
  return {
    width: POPOVER_WINDOW_SIZE.width,
    height: POPOVER_WINDOW_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: true,
    webPreferences: createSecureWebPreferences(preloadPath),
  };
}

export function isTrustedAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "taker:" && url.hostname === "app";
  } catch {
    return false;
  }
}

function createSecureWebPreferences(preloadPath) {
  return {
    preload: preloadPath,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    spellcheck: false,
  };
}
