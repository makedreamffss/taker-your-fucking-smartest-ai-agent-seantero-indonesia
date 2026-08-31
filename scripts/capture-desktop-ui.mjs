import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const endpoint = "http://127.0.0.1:9222";
const outputDirectory = path.resolve(process.argv[2] ?? ".agent/diagnostics/ui");
await mkdir(outputDirectory, { recursive: true });

const pet = await findTarget("taker://app/index.html");
const petClient = await createClient(pet.webSocketDebuggerUrl);
await petClient.call("Page.enable");
await petClient.call("Runtime.evaluate", {
  expression: "window.taker.activate(); true",
  returnByValue: true,
});
await new Promise((resolve) => setTimeout(resolve, 260));
const petCapture = await petClient.call("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  captureBeyondViewport: false,
});
petClient.close();

const popover = await findTarget("taker://app/popover.html");
const popoverClient = await createClient(popover.webSocketDebuggerUrl);
await popoverClient.call("Page.enable");
const diagnostics = await popoverClient.call("Runtime.evaluate", {
  expression: `(() => {
    const card = document.getElementById("card").getBoundingClientRect();
    const sendElement = document.getElementById("send");
    const promptElement = document.getElementById("prompt");
    const send = sendElement.getBoundingClientRect();
    const prompt = promptElement.getBoundingClientRect();
    const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    let keyboardSubmissions = 0;
    HTMLFormElement.prototype.requestSubmit = () => { keyboardSubmissions += 1; };
    promptElement.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true,
    }));
    promptElement.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", shiftKey: true, bubbles: true, cancelable: true,
    }));
    HTMLFormElement.prototype.requestSubmit = originalRequestSubmit;
    promptElement.value = "Visible control check";
    promptElement.dispatchEvent(new Event("input", { bubbles: true }));
    const sendEnablesForText = !sendElement.disabled;
    promptElement.value = "";
    promptElement.dispatchEvent(new Event("input", { bubbles: true }));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      card: { x: card.x, y: card.y, width: card.width, height: card.height },
      send: { x: send.x, y: send.y, width: send.width, height: send.height },
      prompt: { x: prompt.x, y: prompt.y, width: prompt.width, height: prompt.height },
      sendVisible: send.width > 0 && send.height > 0 &&
        send.left >= card.left && send.right <= card.right &&
        send.top >= card.top && send.bottom <= card.bottom,
      activeElement: document.activeElement?.id ?? null,
      placeholder: promptElement.placeholder,
      keyboardSubmissions,
      sendEnablesForText,
      sendDisablesForEmpty: sendElement.disabled,
    };
  })()`,
  returnByValue: true,
});
const popoverCapture = await popoverClient.call("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  captureBeyondViewport: false,
});
popoverClient.close();

const petPath = path.join(outputDirectory, "pet.png");
const promptPath = path.join(outputDirectory, "prompt.png");
await Promise.all([
  writeFile(petPath, Buffer.from(petCapture.data, "base64")),
  writeFile(promptPath, Buffer.from(popoverCapture.data, "base64")),
]);

const state = diagnostics.result.value;
if (
  !state.sendVisible ||
  state.activeElement !== "prompt" ||
  state.keyboardSubmissions !== 1 ||
  !state.sendEnablesForText ||
  !state.sendDisablesForEmpty
) {
  throw new Error(`Prompt visual invariants failed: ${JSON.stringify(state)}`);
}
console.log(JSON.stringify({ passed: true, ...state, petPath, promptPath }, null, 2));

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
    close() { socket.close(); },
  };
}
