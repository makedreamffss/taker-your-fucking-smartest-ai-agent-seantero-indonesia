"use strict";

const clamp = (value, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

export const MOODS = Object.freeze({
  deadpan: mood(0.22, 0.18, [0.73, 0.92, 0.96], 0.2, 0.03, 0.96),
  focused: mood(0.78, 0.48, [0.42, 0.9, 1], 0.85, -0.02, 0.98),
  analytical: mood(0.9, 0.34, [0.56, 0.82, 1], 0.74, 0, 0.99),
  skeptical: mood(0.58, 0.2, [0.7, 0.78, 0.86], 0.42, -0.16, 0.98),
  vigilant: mood(0.86, 0.62, [0.5, 0.96, 1], 1, 0.02, 0.98),
  guarded: mood(0.74, 0.25, [1, 0.77, 0.35], 0.82, -0.05, 0.99),
  concerned: mood(0.68, 0.3, [1, 0.48, 0.42], 0.65, 0.08, 0.96),
  irritated: mood(0.82, 0.58, [1, 0.3, 0.26], 0.72, -0.13, 0.9),
  amused: mood(0.46, 0.42, [0.62, 1, 0.88], 0.58, 0.11, 0.94),
  satisfied: mood(0.42, 0.26, [0.56, 1, 0.76], 0.48, 0.07, 0.99),
  exhausted: mood(0.24, 0.08, [0.58, 0.66, 0.74], 0.14, 0.16, 0.92),
  recovery: mood(0.62, 0.36, [0.64, 0.82, 1], 0.56, 0.03, 0.93),
});

export const DEFAULT_MOOD = "deadpan";

const PHASES = Object.freeze([
  phase("engage", 0.78, 1.2, 0.18, 0.42, 0.16, 0.12),
  phase("sustain", 0.52, 0.86, 0.08, 0.24, 0.09, 0.2),
  phase("deep", 0.72, 0.62, 0.12, 0.34, 0.2, 0.34),
  phase("precise", 0.34, 1.42, 0.035, 0.18, 0.04, 0.08),
  phase("verify", 0.48, 1.68, 0.05, 0.58, 0.06, 0.16),
  phase("resolve", 0.66, 1.06, 0.09, 0.72, 0.1, 0.12),
]);

const FAMILIES = Object.freeze([
  family("idle.observe", 0.08, 0.28, 2.2, 0, 0.08, 0, 0.04, 0.02, 0, 0.08),
  family("listen.capture", 0.22, 0.9, 4.4, 0.01, 0.38, 0, 0.08, 0.05, 0, 0.18),
  family("speech.transcribe", 0.3, 1.22, 7.4, 0.02, 0.72, 0, 0.16, 0.08, 0, 0.24),
  family("thought.reason", 0.26, 0.58, 3.6, 0.02, 0.22, 0.08, 0.09, 0.04, -0.03, 0.22),
  family("plan.sequence", 0.28, 0.74, 5.2, 0.015, 0.52, 0.04, 0.1, 0.03, 0.03, 0.2),
  family("research.web", 0.42, 1.1, 8.4, 0.05, 0.82, 0.09, 0.24, 0.06, -0.02, 0.34),
  family("browser.navigate", 0.36, 1.28, 6.6, 0.035, 0.88, 0.04, 0.2, 0.04, 0.02, 0.3),
  family("filesystem.inspect", 0.18, 0.76, 4.8, 0.01, 0.62, 0, 0.08, 0.02, 0, 0.16),
  family("filesystem.list", 0.24, 0.96, 7.8, 0.015, 0.74, 0, 0.1, 0.03, 0, 0.2),
  family("filesystem.read", 0.2, 0.7, 9.2, 0.008, 0.9, 0, 0.07, 0.025, 0, 0.16),
  family("filesystem.search", 0.34, 1.34, 11.2, 0.02, 1, 0.05, 0.16, 0.03, -0.02, 0.26),
  family("filesystem.write", 0.4, 0.84, 6.2, 0.025, 0.58, 0, 0.22, 0.14, 0, 0.28),
  family("filesystem.edit", 0.32, 1.06, 8.8, 0.018, 0.66, 0, 0.18, 0.11, -0.01, 0.24),
  family("filesystem.create", 0.36, 0.66, 4.4, 0.04, 0.42, 0.04, 0.16, 0.08, 0, 0.24),
  family("filesystem.copy", 0.3, 1.06, 5.6, 0.035, 0.48, 0.12, 0.15, 0.05, 0.02, 0.2),
  family("filesystem.move", 0.38, 1.12, 4.8, 0.04, 0.36, 0.2, 0.18, 0.04, 0.04, 0.24),
  family("filesystem.delete", 0.52, 0.92, 7.2, 0.18, 0.44, 0.04, 0.34, 0.06, -0.04, 0.38),
  family("terminal.execute", 0.46, 1.46, 10.2, 0.06, 0.68, 0.03, 0.28, 0.18, 0, 0.34),
  family("powershell.execute", 0.5, 1.36, 9.4, 0.07, 0.74, 0.04, 0.3, 0.16, -0.02, 0.36),
  family("cmd.execute", 0.46, 1.52, 11.4, 0.055, 0.64, 0.02, 0.27, 0.2, 0.02, 0.32),
  family("bash.execute", 0.44, 1.28, 8.6, 0.06, 0.58, 0.06, 0.26, 0.17, -0.01, 0.32),
  family("package.install", 0.48, 0.7, 4.2, 0.1, 0.36, 0.13, 0.3, 0.08, 0, 0.34),
  family("build.compile", 0.42, 1.18, 12.2, 0.045, 0.7, 0.08, 0.22, 0.13, 0, 0.28),
  family("test.run", 0.38, 1.6, 14.2, 0.025, 0.96, 0.02, 0.2, 0.07, 0, 0.26),
  family("debug.trace", 0.48, 1.08, 13.6, 0.12, 0.9, 0.05, 0.36, 0.08, -0.05, 0.4),
  family("screen.capture", 0.2, 0.5, 3.2, 0.01, 1, 0, 0.06, 0.02, 0, 0.14),
  family("vision.ocr", 0.32, 1.24, 15.4, 0.018, 1, 0.02, 0.12, 0.03, 0, 0.2),
  family("mouse.control", 0.34, 1.42, 5.4, 0.03, 0.34, 0.16, 0.16, 0.05, 0.05, 0.22),
  family("keyboard.control", 0.36, 1.72, 16.2, 0.025, 0.48, 0, 0.18, 0.22, 0, 0.22),
  family("application.control", 0.4, 0.94, 5.8, 0.05, 0.5, 0.18, 0.2, 0.06, 0.04, 0.26),
  family("memory.retrieve", 0.26, 0.54, 7.2, 0.02, 0.66, 0.08, 0.1, 0.02, -0.02, 0.18),
  family("memory.store", 0.3, 0.62, 5.2, 0.025, 0.44, 0.04, 0.14, 0.09, 0.02, 0.2),
  family("schedule.background", 0.26, 0.42, 3.8, 0.015, 0.28, 0.14, 0.09, 0.02, 0, 0.16),
  family("approval.guard", 0.24, 0.72, 3.4, 0.015, 0.52, 0, 0.12, 0.02, -0.04, 0.22),
  family("approval.denied", 0.44, 0.48, 4.6, 0.14, 0.2, 0, 0.3, 0.03, -0.08, 0.34),
  family("failure.error", 0.58, 1.24, 6.8, 0.26, 0.32, 0.05, 0.58, 0.08, -0.08, 0.48),
  family("failure.retry", 0.5, 0.88, 7.6, 0.18, 0.58, 0.1, 0.42, 0.04, 0.06, 0.4),
  family("success.confirm", 0.32, 0.82, 5.2, 0.015, 0.9, 0.05, 0.08, 0.06, 0.02, 0.22),
  family("interrupt.break", 0.66, 1.82, 9.8, 0.34, 0.12, 0.12, 0.72, 0.02, 0.08, 0.58),
  family("speech.output", 0.3, 1.04, 6.4, 0.015, 0.36, 0, 0.12, 0.62, 0, 0.28),
]);

export const MOTION_CATALOG = Object.freeze(
  Object.fromEntries(
    FAMILIES.flatMap((base, familyIndex) =>
      PHASES.map((stage, phaseIndex) => {
        const name = `${base.id}.${stage.id}`;
        const seed = ((familyIndex + 1) * 0.61803398875 + phaseIndex * 0.1732) % 1;
        return [name, Object.freeze({
          name,
          family: base.id,
          phase: stage.id,
          actionIndex: familyIndex,
          amplitude: clamp(base.amplitude * stage.energy, 0, 0.95),
          speed: clamp(base.speed * stage.tempo, 0.08, 2.8),
          frequency: clamp(base.frequency + phaseIndex * 0.73, 1.5, 19),
          scatter: clamp(base.scatter + stage.scatter, 0, 0.75),
          scan: clamp(base.scan * stage.scan, 0, 1),
          orbit: clamp(base.orbit + stage.orbit, 0, 0.72),
          glitch: clamp(base.glitch + stage.glitch, 0, 0.9),
          jaw: clamp(base.jaw * (0.72 + stage.energy * 0.5), 0, 0.9),
          tilt: clamp(base.tilt + (phaseIndex - 2.5) * 0.008, -0.18, 0.18),
          pulse: clamp(base.pulse + stage.pulse, 0, 1),
          seed,
        })];
      }),
    ),
  ),
);

export const MOTION_NAMES = Object.freeze(Object.keys(MOTION_CATALOG));

const TOOL_FAMILY = Object.freeze({
  inspect_path: "filesystem.inspect",
  list_directory: "filesystem.list",
  read_text_file: "filesystem.read",
  search_files: "filesystem.search",
  write_text_file: "filesystem.write",
  edit_text_file: "filesystem.edit",
  create_directory: "filesystem.create",
  copy_path: "filesystem.copy",
  move_path: "filesystem.move",
  delete_path: "filesystem.delete",
  execute_command: "terminal.execute",
  get_current_time: "idle.observe",
  web_search: "research.web",
  browse: "browser.navigate",
  capture_screen: "screen.capture",
  ocr: "vision.ocr",
  mouse: "mouse.control",
  keyboard: "keyboard.control",
  remember: "memory.store",
  recall: "memory.retrieve",
  schedule: "schedule.background",
});

export function motionForEvent(event) {
  switch (event?.type) {
    case "tool_started":
      return `${familyForToolEvent(event)}.engage`;
    case "tool_completed":
      return `${familyForToolEvent(event)}.verify`;
    case "turn_started":
    case "thinking":
      return "thought.reason.sustain";
    case "approval_requested":
      return "approval.guard.sustain";
    case "approval_resolved":
      return event.approved ? "approval.guard.resolve" : "approval.denied.resolve";
    case "turn_completed":
    case "completed":
      return "success.confirm.resolve";
    case "interruption_requested":
    case "turn_cancelled":
      return "interrupt.break.engage";
    case "turn_failed":
      return "failure.error.engage";
    default:
      return null;
  }
}

function familyForToolEvent(event) {
  if (event?.operation && FAMILIES.some((family) => family.id === event.operation)) {
    return event.operation;
  }
  if (event?.name === "execute_command") {
    const shellFamily = {
      powershell: "powershell.execute",
      cmd: "cmd.execute",
      bash: "bash.execute",
    }[event.shell];
    if (shellFamily) return shellFamily;
  }
  return TOOL_FAMILY[event?.name] ?? "terminal.execute";
}

function family(id, amplitude, speed, frequency, scatter, scan, orbit, glitch, jaw, tilt, pulse) {
  return Object.freeze({ id, amplitude, speed, frequency, scatter, scan, orbit, glitch, jaw, tilt, pulse });
}

function phase(id, energy, tempo, scatter, scan, orbit, pulse) {
  return Object.freeze({ id, energy, tempo, scatter, scan, orbit, pulse, glitch: scatter * 0.7 });
}

function mood(focus, energy, tint, eye, jaw, stability) {
  return Object.freeze({ focus, energy, tint, eye, jaw, stability });
}
