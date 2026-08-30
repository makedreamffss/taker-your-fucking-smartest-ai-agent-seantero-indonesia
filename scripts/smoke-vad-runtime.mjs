import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  net,
  protocol,
} from "electron";

const projectRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const rendererRoot = path.join(
  projectRoot,
  "dist",
  "desktop",
  "renderer",
);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "taker",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

console.error("[vad smoke] waiting for Electron readiness");
app.whenReady().then(run).catch(fail);

async function run() {
  console.error("[vad smoke] Electron ready");
  protocol.handle("taker", (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
    const filePath = path.resolve(rendererRoot, relative);
    const check = path.relative(rendererRoot, filePath);
    if (
      url.hostname !== "app" ||
      !relative ||
      check === ".." ||
      check.startsWith(".." + path.sep) ||
      path.isAbsolute(check)
    ) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).href);
  });
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  console.error("[vad smoke] loading renderer");
  window.webContents.on("console-message", (_event, ...details) => {
    const first = details[0];
    const message =
      first && typeof first === "object" ? first.message : details[1];
    if (message) console.error("[vad renderer] " + message);
  });
  window.webContents.on(
    "did-fail-load",
    (_event, code, description) => {
      console.error(
        "[vad renderer] load failed " + code + ": " + description,
      );
    },
  );
  await window.loadURL("taker://app/vad-smoke.html");
  console.error("[vad smoke] renderer loaded");
  const result = await Promise.race([
    window.webContents.executeJavaScript("window.vadSmokeResult"),
    new Promise((_, reject) =>
      setTimeout(() => {
        const error = new Error("VAD initialization exceeded 45 seconds.");
        error.code = "VAD_SMOKE_TIMEOUT";
        reject(error);
      }, 45_000),
    ),
  ]);
  if (!result?.modelLoaded || !result?.workletLoaded) {
    throw new Error("The VAD smoke page returned an incomplete result.");
  }
  console.log(JSON.stringify({ passed: true, ...result }, null, 2));
  window.destroy();
  app.quit();
}

function fail(error) {
  process.exitCode = 1;
  console.error(error);
  app.quit();
}
