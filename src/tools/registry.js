import { ToolInputError } from "../core/errors.js";
import { PermissionPolicy, RISK_LEVELS } from "./permission-policy.js";

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export class ToolRegistry {
  #tools = new Map();

  constructor({ permissionPolicy = new PermissionPolicy({ mode: "semi" }) } = {}) {
    this.permissionPolicy = permissionPolicy;
  }

  register(tool) {
    validateToolDefinition(tool);
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} is already registered.`);
    }
    this.#tools.set(tool.name, Object.freeze({ ...tool }));
    return this;
  }

  registerAll(tools) {
    for (const tool of tools) this.register(tool);
    return this;
  }

  toOllamaTools() {
    return [...this.#tools.values()].map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: structuredClone(tool.parameters),
      },
    }));
  }

  async execute(toolCall, context = {}) {
    const startedAt = performance.now();
    const functionCall = toolCall?.function ?? toolCall;
    const requestedName = functionCall?.name;
    const toolName =
      typeof requestedName === "string" && requestedName
        ? requestedName
        : "unknown_tool";

    try {
      const tool = this.#tools.get(toolName);
      if (!tool) {
        throw new ToolInputError(`The requested tool ${toolName} is not registered.`, {
          code: "UNKNOWN_TOOL",
        });
      }

      const args = parseArguments(functionCall?.arguments);
      validateAgainstSchema(args, tool.parameters, "arguments");
      const authorization = await this.permissionPolicy.authorize(tool, args, context);
      const value = await tool.execute(args, { ...context, authorization });

      return {
        ok: true,
        toolName,
        content: serializeToolValue({ ok: true, result: value }),
        durationMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      const code = error?.code ?? "TOOL_EXECUTION_ERROR";
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        toolName,
        errorCode: code,
        content: serializeToolValue({
          ok: false,
          error: { code, message },
        }),
        durationMs: Math.round(performance.now() - startedAt),
      };
    }
  }
}

function validateToolDefinition(tool) {
  if (!tool || typeof tool !== "object") {
    throw new TypeError("Tool definitions must be objects.");
  }
  if (typeof tool.name !== "string" || !TOOL_NAME_PATTERN.test(tool.name)) {
    throw new TypeError(
      "Tool names must start with a lowercase letter and contain only lowercase letters, digits, and underscores.",
    );
  }
  if (typeof tool.description !== "string" || !tool.description.trim()) {
    throw new TypeError(`Tool ${tool.name} requires a description.`);
  }
  if (!tool.parameters || tool.parameters.type !== "object") {
    throw new TypeError(`Tool ${tool.name} requires an object JSON schema.`);
  }
  if (typeof tool.execute !== "function") {
    throw new TypeError(`Tool ${tool.name} requires an execute function.`);
  }
  if (tool.assess !== undefined && typeof tool.assess !== "function") {
    throw new TypeError(`Tool ${tool.name} assess must be a function when provided.`);
  }
  if (tool.describe !== undefined && typeof tool.describe !== "function") {
    throw new TypeError(`Tool ${tool.name} describe must be a function when provided.`);
  }
  if (!((tool.risk ?? "read") in RISK_LEVELS)) {
    throw new TypeError(`Tool ${tool.name} has an invalid risk level.`);
  }
}

function parseArguments(rawArguments) {
  if (rawArguments === undefined || rawArguments === null) return {};
  if (typeof rawArguments === "string") {
    try {
      rawArguments = JSON.parse(rawArguments);
    } catch (error) {
      throw new ToolInputError("Tool arguments were not valid JSON.", {
        cause: error,
      });
    }
  }
  if (
    typeof rawArguments !== "object" ||
    Array.isArray(rawArguments) ||
    rawArguments === null
  ) {
    throw new ToolInputError("Tool arguments must be a JSON object.");
  }
  return rawArguments;
}

export function validateAgainstSchema(value, schema, location = "value") {
  if (!schema) return;

  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    throw new ToolInputError(`${location} must be one of: ${schema.enum.join(", ")}.`);
  }

  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ToolInputError(`${location} must be an object.`);
      }
      const properties = schema.properties ?? {};
      for (const requiredName of schema.required ?? []) {
        if (!(requiredName in value)) {
          throw new ToolInputError(`${location}.${requiredName} is required.`);
        }
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) {
            throw new ToolInputError(`${location}.${key} is not allowed.`);
          }
        }
      }
      for (const [key, propertyValue] of Object.entries(value)) {
        if (properties[key]) {
          validateAgainstSchema(propertyValue, properties[key], `${location}.${key}`);
        }
      }
      break;
    }
    case "array":
      if (!Array.isArray(value)) {
        throw new ToolInputError(`${location} must be an array.`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        throw new ToolInputError(`${location} must contain at most ${schema.maxItems} items.`);
      }
      value.forEach((item, index) =>
        validateAgainstSchema(item, schema.items, `${location}[${index}]`),
      );
      break;
    case "string":
      if (typeof value !== "string") {
        throw new ToolInputError(`${location} must be a string.`);
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        throw new ToolInputError(`${location} is too short.`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        throw new ToolInputError(`${location} is too long.`);
      }
      break;
    case "integer":
      if (!Number.isInteger(value)) {
        throw new ToolInputError(`${location} must be an integer.`);
      }
      validateNumberRange(value, schema, location);
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ToolInputError(`${location} must be a finite number.`);
      }
      validateNumberRange(value, schema, location);
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new ToolInputError(`${location} must be a boolean.`);
      }
      break;
    case undefined:
      break;
    default:
      throw new TypeError(`Unsupported schema type: ${schema.type}`);
  }
}

function validateNumberRange(value, schema, location) {
  if (schema.minimum !== undefined && value < schema.minimum) {
    throw new ToolInputError(`${location} must be at least ${schema.minimum}.`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    throw new ToolInputError(`${location} must be at most ${schema.maximum}.`);
  }
}

function serializeToolValue(value) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? JSON.stringify({ ok: true, result: null }) : serialized;
}
