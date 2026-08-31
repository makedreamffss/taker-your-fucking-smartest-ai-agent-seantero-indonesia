import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve(process.argv[2] ?? ".agent/diagnostics/embodiment-actions");
await mkdir(outputDirectory, { recursive: true });
const target = await findTarget("taker://app/index.html");
const client = await createClient(target.webSocketDebuggerUrl);
const captures = [];
const seen = new Set();
const deadline = Date.now() + 70_000;

while (Date.now() < deadline && seen.size < 16) {
  const action = await readAction(client);
  if (action && !seen.has(action)) {
    await wait(650);
    if ((await readAction(client)) === action) {
      const image = await client.call("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const filePath = path.join(outputDirectory, `${String(seen.size + 1).padStart(2, "0")}-${action}.png`);
      await writeFile(filePath, Buffer.from(image.data, "base64"));
      seen.add(action);
      captures.push({ action, filePath });
    }
  }
  await wait(75);
}
client.close();

if (captures.length !== 16) {
  throw new Error(`Captured ${captures.length}/16 rigged actions: ${[...seen].join(", ")}`);
}
const manifestPath = path.join(outputDirectory, "manifest.json");
await writeFile(manifestPath, JSON.stringify({ passed: true, captures }, null, 2) + "\n");
process.stdout.write(JSON.stringify({ passed: true, total: captures.length, manifestPath }, null, 2) + "\n");

async function readAction(client) {
  const result = await client.call("Runtime.evaluate", {
    expression: "document.getElementById('embodiment')?.dataset.action || ''",
    returnByValue: true,
  });
  return result.result.value;
}

async function findTarget(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const targets = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json());
    const target = targets.find((candidate) => candidate.url === url);
    if (target) return target;
    await wait(100);
  }
  throw new Error(`Renderer target is unavailable: ${url}`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function createClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    call(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}
