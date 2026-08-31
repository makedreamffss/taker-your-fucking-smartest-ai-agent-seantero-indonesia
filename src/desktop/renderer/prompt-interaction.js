"use strict";

export function normalizePrompt(value) {
  return typeof value === "string" ? value.trim().slice(0, 20_000) : "";
}

export function shouldSubmitPrompt(event, { composing = false } = {}) {
  return Boolean(
    event?.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      !composing &&
      !event.isComposing &&
      event.keyCode !== 229,
  );
}
