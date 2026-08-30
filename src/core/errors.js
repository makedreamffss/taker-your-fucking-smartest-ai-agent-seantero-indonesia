export class AgentError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = new.target.name;
    this.code = options.code ?? "AGENT_ERROR";
  }
}

export class ConfigurationError extends AgentError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "CONFIGURATION_ERROR" });
  }
}

export class OllamaConnectionError extends AgentError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "OLLAMA_CONNECTION_ERROR" });
  }
}

export class OllamaResponseError extends AgentError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "OLLAMA_RESPONSE_ERROR" });
  }
}

export class RequestAbortedError extends AgentError {
  constructor(message = "The active request was cancelled by the user.", options = {}) {
    super(message, { ...options, code: "REQUEST_ABORTED" });
  }
}

export class PermissionDeniedError extends AgentError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code ?? "PERMISSION_DENIED" });
  }
}

export class ToolInputError extends AgentError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code ?? "INVALID_TOOL_INPUT" });
  }
}
