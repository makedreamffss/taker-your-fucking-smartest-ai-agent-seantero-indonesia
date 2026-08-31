import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createPetWindowOptions,
  createPopoverWindowOptions,
  isTrustedAppUrl,
  PET_WINDOW_SIZE,
} from "../src/desktop/window-policy.js";

test("pet shell is transparent, tiny, and renderer-isolated", () => {
  const options = createPetWindowOptions("C:\\project\\preload.cjs");

  assert.equal(options.transparent, true);
  assert.equal(options.backgroundColor, "#00000000");
  assert.equal(options.frame, false);
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.skipTaskbar, true);
  assert.ok(options.width <= 200);
  assert.ok(options.height <= 200);
  assert.equal(options.width, PET_WINDOW_SIZE.width);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.webviewTag, false);
});

test("transient popover uses the same isolated renderer policy", () => {
  const options = createPopoverWindowOptions("C:\\project\\popover-preload.cjs");
  assert.equal(options.show, false);
  assert.equal(options.transparent, true);
  assert.equal(options.frame, false);
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
});

test("desktop navigation trusts only the packaged application origin", () => {
  assert.equal(isTrustedAppUrl("taker://app/index.html"), true);
  assert.equal(isTrustedAppUrl("taker://other/index.html"), false);
  assert.equal(isTrustedAppUrl("https://example.com/"), false);
  assert.equal(isTrustedAppUrl("not a url"), false);
});

test("renderer has a restrictive content security policy and transparent page", async () => {
  const html = await readFile(
    new URL("../src/desktop/renderer/index.html", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/desktop/renderer/pet.css", import.meta.url),
    "utf8",
  );

  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /\b(?:src|href)=["']https?:\/\//);
  assert.match(css, /background: transparent/);
  assert.match(css, /\.pet\s*\{[^}]*-webkit-app-region: no-drag/s);
  assert.doesNotMatch(css, /\.pet\s*\{[^}]*-webkit-app-region: drag/s);
});

test("response surface parses and sanitizes Markdown without a raw HTML sink", async () => {
  const html = await readFile(
    new URL("../src/desktop/renderer/popover.html", import.meta.url),
    "utf8",
  );
  const script = await readFile(
    new URL("../src/desktop/renderer/popover.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/desktop/renderer/popover.css", import.meta.url),
    "utf8",
  );

  assert.match(html, /<article id="message" class="markdown-body">/);
  assert.match(script, /DOMPurify\.sanitize/);
  assert.match(script, /RETURN_DOM_FRAGMENT:\s*true/);
  assert.match(script, /target\.replaceChildren\(fragment\)/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.match(html, /<button id="send"[^>]*type="submit"/);
  assert.match(html, /Enter to send · Shift\+Enter for newline/);
  assert.match(css, /\.composer\s*\{/);
  assert.doesNotMatch(css, /clip-path|linear-gradient|text-transform:\s*uppercase/);
});

test("voice playback applies the restrained operator mastering chain", async () => {
  const script = await readFile(
    new URL("../src/desktop/renderer/voice-playback.js", import.meta.url),
    "utf8",
  );
  assert.match(script, /lowShelf\.type = "lowshelf"/);
  assert.match(script, /lowShelf\.gain\.value = 4\.5/);
  assert.match(script, /createDynamicsCompressor/);
  assert.match(script, /presence\.gain\.value = -1\.4/);
});
