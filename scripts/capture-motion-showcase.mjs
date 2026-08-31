import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const endpoint = "http://127.0.0.1:9222";
const outputDirectory = path.resolve(
  process.argv[2] ?? ".agent/diagnostics/motion-showcase",
);
await mkdir(outputDirectory, { recursive: true });

const target = await findTarget("taker://app/index.html");
const client = await createClient(target.webSocketDebuggerUrl);
await client.call("Page.enable");

const first = await capture("first.png");
await new Promise((resolve) => setTimeout(resolve, 1_050));
const second = await capture("second.png");
client.close();

if (first.hidden || second.hidden) {
  throw new Error("The motion showcase progress label is not visible.");
}
if (!/^\d+\/240  \S+/.test(first.label) || !/^\d+\/240  \S+/.test(second.label)) {
  throw new Error(`Unexpected showcase labels: ${first.label}; ${second.label}`);
}
if (first.label === second.label) {
  throw new Error(`The showcase did not advance from ${first.label}.`);
}
if (first.image.equals(second.image)) {
  throw new Error("The rendered character frame stayed pixel-identical.");
}

console.log(JSON.stringify({
  passed: true,
  first: { label: first.label, path: first.path },
  second: { label: second.label, path: second.path },
}, null, 2));

async function capture(filename) {
  const diagnostics = await client.call("Runtime.evaluate", {
    expression: `(() => {
      const output = document.getElementById("motion-progress");
      return { label: output.textContent, hidden: output.hidden };
    })()`,
    returnByValue: true,
  });
  const screenshot = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const image = Buffer.from(screenshot.data, "base64");
  const filePath = path.join(outputDirectory, filename);
  await writeFile(filePath, image);
  return { ...diagnostics.result.value, image, path: filePath };
}

async function findTarget(url) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
    const target = targets.find((candidate) => candidate.url === url);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Renderer target is unavailable: ${url}`);
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
    close() {
      socket.close();
    },
  };
}
