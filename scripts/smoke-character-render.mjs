import { createHash } from "node:crypto";

const target = await findTarget("taker://app/index.html");
const client = await createClient(target.webSocketDebuggerUrl);

const diagnostics = await client.call("Runtime.evaluate", {
  expression: `(() => {
    const canvas = document.getElementById("embodiment");
    const gl = canvas?.getContext("webgl2");
    return {
      webgl2: Boolean(gl),
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      transparentBody: getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)",
      title: document.title,
    };
  })()`,
  returnByValue: true,
});
const first = await capture(client);
await wait(420);
const second = await capture(client);
client.close();

const state = diagnostics.result.value;
if (!state.webgl2 || !state.transparentBody || state.canvasWidth < 300) {
  throw new Error("The transparent Three.js embodiment did not satisfy runtime invariants.");
}
if (hash(first) === hash(second)) {
  throw new Error("The articulated embodiment was static across animation frames.");
}
process.stdout.write(JSON.stringify({ passed: true, ...state, framesDiffer: true }, null, 2) + "\n");

function capture(client) {
  return client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  }).then((result) => Buffer.from(result.data, "base64"));
}

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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
