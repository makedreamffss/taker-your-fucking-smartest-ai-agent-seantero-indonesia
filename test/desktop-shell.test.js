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
  assert.ok(options.width <= 140);
  assert.ok(options.height <= 140);
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
});
