const targets = await fetch("http://127.0.0.1:9222/json/list").then(
  (response) => response.json(),
);
const pet = targets.find((target) => target.url === "taker://app/index.html");
const popover = targets.find(
  (target) => target.url === "taker://app/popover.html",
);
if (!pet || !popover) {
  throw new Error("Both desktop renderer targets must be running.");
}

const petClient = await createClient(pet.webSocketDebuggerUrl);
await petClient.call("Runtime.evaluate", {
  expression:
    "document.getElementById('pet').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))",
});
petClient.close();

await new Promise((resolve) => setTimeout(resolve, 300));
const popoverClient = await createClient(popover.webSocketDebuggerUrl);
const result = await popoverClient.call("Runtime.evaluate", {
  expression:
    "({title:document.getElementById('title').textContent,promptHidden:document.getElementById('prompt-view').hidden,messageHidden:document.getElementById('message-view').hidden,activeTag:document.activeElement?.tagName})",
  returnByValue: true,
});
popoverClient.close();

const state = result.result.value;
if (
  state.title !== "Ask Taker" ||
  state.promptHidden !== false ||
  state.messageHidden !== true ||
  state.activeTag !== "TEXTAREA"
) {
  throw new Error("Prompt popover did not reach its expected interactive state.");
}
console.log(JSON.stringify({ passed: true, popover: state }, null, 2));

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
