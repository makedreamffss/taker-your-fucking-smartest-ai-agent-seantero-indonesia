import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const blenderPath = "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe";
const scriptPath = path.join(projectRoot, "scripts", "blender", "build_taker_embodiment.py");
const child = spawn(
  blenderPath,
  [
    "--background",
    "--factory-startup",
    "--disable-autoexec",
    "--python-exit-code",
    "1",
    "--python",
    scriptPath,
    "--",
    projectRoot,
  ],
  { cwd: projectRoot, stdio: "inherit", windowsHide: true },
);
child.once("error", (error) => {
  process.stderr.write(`Unable to start Blender: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`Blender terminated by ${signal}.\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
