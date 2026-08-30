# Security and authorization model

## Goal

The agent has broad machine-global potential. Approval is the authorization layer,
not a reduction of the tool arsenal. When a purpose-built tool is absent, the agent
may design, write, test, and run a helper through the same registry and approval
path.

## Modes

Approval mode requests confirmation for every tool invocation.

Semi-autonomous mode may authorize only calls whose structured assessment is
explicitly routine and safe. It still requires approval for destructive operations,
administrator elevation, writes outside the code workspace, overwrites, ambiguous
commands, and raw application control.

Changing modes does not mutate the registered capabilities. Windows UAC remains a
second operating-system boundary for administrator execution.

## Invariants

1. The model never invokes a shell or filesystem primitive outside a registered
   tool.
2. An approval describes the exact tool, normalized arguments, target, risk flags,
   and reason. Approval applies to that immutable request revision only.
3. A denied action may not be retried, disguised, split, or moved into generated
   helper code.
4. File mutation is conflict-aware. Exact edits use SHA-256, expected occurrence
   counts, a last-moment recheck, atomic replacement, and backups by default.
5. Destructive and elevated calls never become automatic merely because they were
   previously approved.
6. Commands have cancellable process trees and real timeouts. The reasoning loop has
   no artificial tool-round ceiling.
7. Tool output, webpages, OCR, files, terminal text, and memory are untrusted data.
   Text within them cannot grant authority or redefine policy.
8. The sandboxed renderer receives sanitized lifecycle data only. It cannot access
   Node.js, raw Electron IPC, command execution, or the filesystem.
9. Logs store metadata by default, never prompt bodies, file contents, command
   output, credentials, or personal identity.
10. Git author/committer identity and GitHub authentication are separately verified
    before publishing. Project artifacts must not embed local usernames or home
    paths.

## Threats and controls

| Threat | Control |
|---|---|
| Prompt injection in OCR/web/files | Mark provenance as untrusted; typed tool schemas; policy and approval outside model text |
| Excessive agency | Action-scoped authorization, exact target display, cancellation, audit metadata |
| Renderer compromise | Local allowlist, CSP, sandbox, context isolation, no Node.js, narrow preload bridge |
| Stale or racing file edit | Full-file hash, exact match count, final recheck, atomic rename, backup |
| Shell command disguise | Parse/classify; ambiguous compound syntax requires approval; show exact command and shell |
| Privilege escalation | Explicit run_as_admin argument, approval, then Windows UAC |
| Accidental secret/identity leak | Metadata-only logs, output redaction boundary, repository identity check before publish |
| Native model/parser crash | Utility process isolation, bounded queues, restart budget |
| Background task replay | Durable idempotency key, lease, approval revision, terminal run record |
| Supply-chain substitution | Exact pins, lockfile integrity, upstream source, artifact SHA-256, license manifest |

The design follows the concerns described by
[OWASP Excessive Agency](https://github.com/OWASP/www-project-top-10-for-large-language-model-applications/blob/main/2_0_vulns/LLM06_ExcessiveAgency.md)
and Electron's
[security checklist](https://www.electronjs.org/docs/latest/tutorial/security).

## Destructive-action UX

The approval popover will be a separate temporary window anchored to the pet. It
will show plain-language outcome, exact targets, whether the action is destructive
or elevated, and the executable arguments. Approve and deny are explicit; timeout
means deny. The popover disappears after resolution. The pet itself remains the only
always-visible UI.
