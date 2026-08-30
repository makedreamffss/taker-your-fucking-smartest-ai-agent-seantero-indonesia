const targets = await fetch("http://127.0.0.1:9222/json/list").then(
  (response) => response.json(),
);
const popover = targets.find(
  (target) => target.url === "taker://app/popover.html",
);
if (!popover) throw new Error("The popover renderer is not running.");

const client = await createClient(popover.webSocketDebuggerUrl);
const inspectOnly = process.argv.includes("--inspect-only");
if (!inspectOnly) {
  await client.call("Runtime.evaluate", {
    expression:
      "document.getElementById('prompt').value='Reply with exactly READY';document.getElementById('prompt-view').requestSubmit()",
  });
}

const deadline = Date.now() + 180_000;
let state;
do {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const result = await client.call("Runtime.evaluate", {
    expression:
      "({title:document.getElementById('title').textContent,message:document.getElementById('message').textContent,messageHidden:document.getElementById('message-view').hidden})",
    returnByValue: true,
  });
  state = result.result.value;
  if (
    inspectOnly ||
    state.title === "Taker" &&
    state.messageHidden === false &&
    state.message.trim().length > 0
  ) {
    break;
  }
} while (Date.now() < deadline);
client.close();

if (
  !inspectOnly &&
  state.title !== "Taker" ||
  !inspectOnly &&
    (state.messageHidden !== false || state.message.trim().length === 0)
) {
  throw new Error(
    "The desktop conversation did not complete before timeout. Last state: " +
      JSON.stringify(state),
  );
}
console.log(
  JSON.stringify(
    inspectOnly
      ? { inspected: true, popover: state }
      : { passed: true, response: state.message },
    null,
    2,
  ),
);

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
