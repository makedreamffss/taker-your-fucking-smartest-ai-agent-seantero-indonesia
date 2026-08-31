"use strict";

import DOMPurify from "dompurify";
import { marked } from "marked";
import { normalizePrompt, shouldSubmitPrompt } from "./prompt-interaction.js";

const card = document.getElementById("card");
const title = document.getElementById("title");
const messageView = document.getElementById("message-view");
const message = document.getElementById("message");
const promptView = document.getElementById("prompt-view");
const prompt = document.getElementById("prompt");
const send = document.getElementById("send");
const approvalView = document.getElementById("approval-view");
const approvalSummary = document.getElementById("approval-summary");
const approvalFlags = document.getElementById("approval-flags");
const approvalDetails = document.getElementById("approval-details");
const approve = document.getElementById("approve");
const deny = document.getElementById("deny");
const dismiss = document.getElementById("dismiss");
let approvalId = null;
let composing = false;

window.takerPopover.onView((view) => {
  const mode = new Set(["message", "prompt", "approval"]).has(view?.mode)
    ? view.mode
    : "message";
  title.textContent = safeText(view?.title, "Taker");
  card.dataset.tone = safeText(view?.tone, "neutral");
  messageView.hidden = mode !== "message";
  promptView.hidden = mode !== "prompt";
  approvalView.hidden = mode !== "approval";
  approvalId = mode === "approval" ? safeText(view.id, "") : null;

  if (mode === "message") {
    renderMarkdown(message, safeText(view.text, ""));
  } else if (mode === "prompt") {
    prompt.value = "";
    prompt.disabled = false;
    send.disabled = true;
    prompt.placeholder = safeText(view.placeholder, "What should I do?");
    requestAnimationFrame(() => prompt.focus());
  } else {
    approvalSummary.textContent = safeText(view.summary, "");
    approvalDetails.textContent = safeText(view.details, "");
    approvalFlags.replaceChildren(
      ...(Array.isArray(view.flags) ? view.flags : []).map((flag) => {
        const element = document.createElement("span");
        element.className = "flag";
        element.textContent = safeText(flag, "");
        return element;
      }),
    );
  }
});

promptView.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = normalizePrompt(prompt.value);
  if (!text) {
    prompt.focus();
    return;
  }
  send.disabled = true;
  prompt.disabled = true;
  window.takerPopover.submit({ type: "prompt", text });
});
prompt.addEventListener("keydown", (event) => {
  if (shouldSubmitPrompt(event, { composing })) {
    event.preventDefault();
    promptView.requestSubmit();
  }
});
prompt.addEventListener("input", () => {
  send.disabled = normalizePrompt(prompt.value).length === 0;
});
prompt.addEventListener("compositionstart", () => {
  composing = true;
});
prompt.addEventListener("compositionend", () => {
  composing = false;
});
approve.addEventListener("click", () => {
  window.takerPopover.submit({ type: "approve", id: approvalId });
});
deny.addEventListener("click", () => {
  window.takerPopover.submit({ type: "deny", id: approvalId });
});
dismiss.addEventListener("click", () => {
  window.takerPopover.submit({ type: "dismiss" });
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.takerPopover.submit({ type: "dismiss" });
  }
});

function safeText(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function renderMarkdown(target, source) {
  const html = marked.parse(source.replace(/[\u200B-\u200D\uFEFF]/g, ""), {
    async: false,
    breaks: true,
    gfm: true,
  });
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "code", "pre", "ul", "ol", "li",
      "h1", "h2", "h3", "blockquote", "hr", "table", "thead", "tbody",
      "tr", "th", "td",
    ],
    ALLOWED_ATTR: [],
    FORBID_TAGS: ["style", "script", "iframe", "object", "form", "svg", "math"],
    FORBID_ATTR: ["style", "src", "href", "onerror", "onclick"],
  });
  target.replaceChildren(fragment);
}
