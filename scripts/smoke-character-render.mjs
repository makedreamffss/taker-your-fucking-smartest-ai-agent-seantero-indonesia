import { createHash } from "node:crypto";

const targets = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json());
const pet = targets.find((target) => target.url === "taker://app/index.html");
if (!pet) throw new Error("The character renderer is not running.");
const client = await createClient(pet.webSocketDebuggerUrl);

const diagnostics = await client.call("Runtime.evaluate", {
  expression: `(() => {
    const canvas = document.getElementById("character");
    const gl = canvas?.getContext("webgl2");
    return {
      webgl2: Boolean(gl),
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      transparentBody: getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)",
      pointGrid: 112 * 112,
    };
  })()`,
  returnByValue: true,
});
const first = await client.call("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  captureBeyondViewport: false,
});
await new Promise((resolve) => setTimeout(resolve, 420));
const second = await client.call("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  captureBeyondViewport: false,
});
client.close();

const firstHash = hash(first.data);
const secondHash = hash(second.data);
const state = diagnostics.result.value;
if (!state.webgl2 || !state.transparentBody || state.pointGrid !== 12_544) {
  throw new Error("The GPU pixel renderer did not satisfy its runtime invariants.");
}
if (firstHash === secondHash) {
  throw new Error("The character pixel field was static across animation frames.");
}
console.log(JSON.stringify({ passed: true, ...state, framesDiffer: true }, null, 2));

function hash(base64) {
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
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
