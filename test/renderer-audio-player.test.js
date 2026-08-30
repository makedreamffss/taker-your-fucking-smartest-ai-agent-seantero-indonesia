import assert from "node:assert/strict";
import test from "node:test";

import { RendererAudioPlayer } from "../src/desktop/renderer-audio-player.js";

test("renderer audio player resolves only after start and end events", async () => {
  const commands = [];
  let started = 0;
  const player = new RendererAudioPlayer({ sendCommand: (value) => commands.push(value) });
  const pending = player.play(new Uint8Array(44), { onPlaybackStart: () => started += 1 });
  const id = commands[0].id;
  assert.equal(commands[0].type, "play");
  assert.equal(player.handleEvent({ type: "started", id }), true);
  assert.equal(started, 1);
  assert.equal(player.handleEvent({ type: "ended", id }), true);
  await pending;
});

test("renderer audio player stops and rejects pending audio", async () => {
  const commands = [];
  const player = new RendererAudioPlayer({ sendCommand: (value) => commands.push(value) });
  const pending = player.play(new Uint8Array(44));
  await player.stop("user_interruption");
  await assert.rejects(pending, { name: "AbortError", code: "ABORT_ERR" });
  assert.equal(commands.at(-1).type, "stop");
});

test("renderer audio player cleans up when command delivery fails", async () => {
  const player = new RendererAudioPlayer({
    sendCommand() {
      throw new Error("renderer gone");
    },
  });
  await assert.rejects(player.play(new Uint8Array(44)), /renderer gone/);
  await player.stop("cleanup");
});
