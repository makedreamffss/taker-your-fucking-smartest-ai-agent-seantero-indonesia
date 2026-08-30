import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const outputPath = path.resolve(
  process.argv[2] || ".agent/pet-render.png",
);
const targetUrl = process.argv[3] || "taker://app/index.html";
const targets = await fetch("http://127.0.0.1:9222/json/list").then((response) => {
  if (!response.ok) throw new Error("DevTools target discovery failed.");
  return response.json();
});
const target = targets.find(
  (candidate) =>
    candidate.type === "page" && candidate.url === targetUrl,
);
if (!target) throw new Error("The requested Taker renderer target was not found.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
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

function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const diagnostics = await call("Runtime.evaluate", {
  expression:
    "({title:document.title,readyState:document.readyState,pet:document.getElementById('pet')?.getBoundingClientRect().toJSON(),card:document.getElementById('card')?.getBoundingClientRect().toJSON(),bodyBackground:getComputedStyle(document.body).backgroundColor,state:document.getElementById('pet')?.dataset.state})",
  returnByValue: true,
});
const screenshot = await call("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  captureBeyondViewport: false,
});

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
socket.close();

console.log(
  JSON.stringify(
    {
      outputPath,
      renderer: diagnostics.result.value,
    },
    null,
    2,
  ),
);
