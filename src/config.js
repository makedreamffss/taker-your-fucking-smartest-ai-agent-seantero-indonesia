import path from "node:path";

import { ConfigurationError } from "./core/errors.js";

const DEFAULTS = Object.freeze({
  ollamaBaseUrl: "http://127.0.0.1:11434",
  model: "gpt-oss:120b-cloud",
  historyTurns: 12,
  requestTimeoutMs: 300_000,
  commandTimeoutMs: 120_000,
  approvalMode: "approval",
  voiceProfile: "peter_yearsley",
  logPath: ".agent/logs/events.jsonl",
});

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const workspace = path.resolve(env.AGENT_WORKSPACE?.trim() || cwd);
  const logPath = resolveWorkspacePath(
    workspace,
    env.AGENT_LOG_PATH?.trim() || DEFAULTS.logPath,
    "AGENT_LOG_PATH",
  );

  return Object.freeze({
    ollamaBaseUrl: parseBaseUrl(
      env.OLLAMA_BASE_URL?.trim() || DEFAULTS.ollamaBaseUrl,
    ),
    model: requireNonEmpty(
      env.OLLAMA_MODEL?.trim() || DEFAULTS.model,
      "OLLAMA_MODEL",
    ),
    workspace,
    historyTurns: parseInteger(
      env.AGENT_HISTORY_TURNS,
      DEFAULTS.historyTurns,
      "AGENT_HISTORY_TURNS",
      1,
      100,
    ),
    requestTimeoutMs: parseInteger(
      env.AGENT_REQUEST_TIMEOUT_MS,
      DEFAULTS.requestTimeoutMs,
      "AGENT_REQUEST_TIMEOUT_MS",
      1_000,
      1_800_000,
    ),
    commandTimeoutMs: parseInteger(
      env.AGENT_COMMAND_TIMEOUT_MS,
      DEFAULTS.commandTimeoutMs,
      "AGENT_COMMAND_TIMEOUT_MS",
      1_000,
      3_600_000,
    ),
    approvalMode: parseChoice(
      env.AGENT_APPROVAL_MODE?.trim() || DEFAULTS.approvalMode,
      "AGENT_APPROVAL_MODE",
      ["approval", "semi"],
    ),
    voiceProfile: parseVoiceProfile(
      env.AGENT_VOICE_PROFILE?.trim().toLowerCase() || DEFAULTS.voiceProfile,
    ),
    logPath,
  });
}

function parseBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new ConfigurationError(
      `OLLAMA_BASE_URL must be a valid http(s) URL; received ${JSON.stringify(value)}.`,
      { cause: error },
    );
  }

  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new ConfigurationError("OLLAMA_BASE_URL must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigurationError(
      "OLLAMA_BASE_URL cannot contain credentials, a query string, or a fragment.",
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function parseInteger(rawValue, fallback, name, minimum, maximum) {
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(
      `${name} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

function requireNonEmpty(value, name) {
  if (!value) {
    throw new ConfigurationError(`${name} cannot be empty.`);
  }
  return value;
}

function parseChoice(value, name, allowedValues) {
  if (!allowedValues.includes(value)) {
    throw new ConfigurationError(
      `${name} must be one of: ${allowedValues.join(", ")}.`,
    );
  }
  return value;
}

function parseVoiceProfile(value) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
    throw new ConfigurationError(
      "AGENT_VOICE_PROFILE must contain only lowercase letters, digits, and underscores.",
    );
  }
  return value;
}

function resolveWorkspacePath(workspace, configuredPath, name) {
  const candidate = path.resolve(workspace, configuredPath);
  const relative = path.relative(workspace, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ConfigurationError(`${name} must stay inside AGENT_WORKSPACE.`);
  }
  return candidate;
}

export { DEFAULTS };
