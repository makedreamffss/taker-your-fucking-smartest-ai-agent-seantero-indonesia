import assert from "node:assert/strict";
import test from "node:test";

import { RequestAbortedError } from "../src/core/errors.js";
import { SessionController } from "../src/core/session-controller.js";

test("session controller exposes truthful thinking, approval, and execution states", async () => {
  const stateChanges = [];
  const sessionEvents = [];
  const agent = {
    async send(_text, { onEvent, requestApproval }) {
      await onEvent({ type: "thinking", round: 1 });
      await onEvent({ type: "tool_started", name: "write_text_file" });
      assert.equal(await requestApproval({ tool: { name: "write_text_file" } }), true);
      await onEvent({
        type: "tool_completed",
        name: "write_text_file",
        ok: true,
      });
      await onEvent({ type: "completed", round: 2 });
      return { content: "done", rounds: 2, toolCalls: 1 };
    },
  };
  const session = new SessionController({
    agent,
    idFactory: () => "turn-1",
  });
  session.activityState.subscribe((event) => {
    stateChanges.push(event.current.turn);
  });
  session.subscribe((event) => sessionEvents.push(event.type));

  const result = await session.send("change a file", {
    requestApproval: async () => true,
  });

  assert.equal(result.content, "done");
  assert.equal(session.isBusy, false);
  assert.equal(session.activityState.snapshot.turn, "idle");
  assert.ok(stateChanges.includes("waiting_approval"));
  assert.deepEqual(sessionEvents, [
    "turn_started",
    "thinking",
    "tool_started",
    "approval_requested",
    "approval_resolved",
    "tool_completed",
    "completed",
    "turn_completed",
  ]);
});

test("session controller interrupts one active turn and returns to idle", async () => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const agent = {
    async send(_text, { signal }) {
      started();
      return new Promise((_resolve, reject) => {
        const abort = () =>
          reject(new RequestAbortedError("interrupted for test"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    },
  };
  const session = new SessionController({
    agent,
    idFactory: () => "turn-2",
  });

  const pending = session.send("keep working");
  await ready;
  assert.equal(session.isBusy, true);
  assert.equal(session.interrupt("barge_in"), true);
  await assert.rejects(pending, /interrupted for test/);
  assert.equal(session.isBusy, false);
  assert.equal(session.activityState.snapshot.turn, "idle");
  assert.equal(session.interrupt(), false);
});

test("session controller fails closed when a second turn starts concurrently", async () => {
  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });
  const session = new SessionController({
    agent: {
      async send() {
        await blocker;
        return { content: "done" };
      },
    },
    idFactory: () => "turn-3",
  });

  const first = session.send("first");
  await assert.rejects(() => session.send("second"), {
    code: "AGENT_BUSY",
  });
  release();
  await first;
});
