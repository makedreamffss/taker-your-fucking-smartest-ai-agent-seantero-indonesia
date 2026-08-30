import { PermissionDeniedError } from "../core/errors.js";

export const RISK_LEVELS = Object.freeze({
  read: 0,
  write: 1,
  execute: 2,
  control: 3,
});

export const APPROVAL_MODES = Object.freeze({
  APPROVAL: "approval",
  SEMI: "semi",
});

export class PermissionPolicy {
  constructor({ mode = APPROVAL_MODES.APPROVAL } = {}) {
    this.setMode(mode);
  }

  setMode(mode) {
    if (!Object.values(APPROVAL_MODES).includes(mode)) {
      throw new TypeError(`Unknown approval mode: ${mode}`);
    }
    this.mode = mode;
  }

  async authorize(tool, args, { requestApproval } = {}) {
    const risk = tool.risk ?? "read";
    if (!(risk in RISK_LEVELS)) {
      throw new TypeError(`Tool ${tool.name} has an unknown risk level: ${risk}`);
    }

    const toolAssessment = tool.assess ? await tool.assess(args) : {};
    const assessment = {
      risk,
      destructive: false,
      elevated: false,
      outsideWorkspace: false,
      ambiguous: risk !== "read",
      safeInSemiAutonomous: risk === "read",
      reason:
        risk === "read"
          ? "Read-only operation."
          : `${risk} operation requiring authorization unless explicitly classified as routine and safe.`,
      summary: tool.describe ? await tool.describe(args) : tool.description,
      ...toolAssessment,
    };

    const mandatoryGuardrail =
      assessment.destructive ||
      assessment.elevated ||
      assessment.outsideWorkspace ||
      assessment.ambiguous;
    const requiresApproval =
      this.mode === APPROVAL_MODES.APPROVAL ||
      mandatoryGuardrail ||
      !assessment.safeInSemiAutonomous;

    if (!requiresApproval) {
      return { approved: true, automatic: true, assessment };
    }

    if (typeof requestApproval !== "function") {
      throw new PermissionDeniedError(
        `Tool ${tool.name} requires interactive approval, but no approval handler is available.`,
        { code: "APPROVAL_REQUIRED" },
      );
    }

    const approved = await requestApproval({
      mode: this.mode,
      tool: {
        name: tool.name,
        description: tool.description,
        risk,
      },
      arguments: structuredClone(args),
      assessment,
    });

    if (!approved) {
      throw new PermissionDeniedError(
        `The user denied approval for tool ${tool.name}. Do not retry or disguise the same action.`,
        { code: "APPROVAL_DENIED" },
      );
    }
    return { approved: true, automatic: false, assessment };
  }
}
