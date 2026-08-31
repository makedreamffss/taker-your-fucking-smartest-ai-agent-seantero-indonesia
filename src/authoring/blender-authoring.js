"use strict";

import { execFile } from "node:child_process";
import { mkdir, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { findBlenderBinary } from "./embodiment-assets.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 2_000_000;

export class BlenderAuthoring {
  constructor({ workspace }) {
    this.workspace = path.resolve(workspace);
  }

  async inspect() {
    const blender = await findBlenderBinary();
    return {
      ...blender,
      recipe: "scripts/blender/build_taker_embodiment.py",
      autoExecutionDisabled: true,
      arbitraryPythonExposed: false,
      arbitraryShellExposed: false,
    };
  }

  async rebuildStarter({ signal } = {}) {
    const blender = await findBlenderBinary();
    if (!blender.installed) throw new Error("Blender 5.2 LTS is not installed.");
    const scriptPath = this.#insideWorkspace("scripts/blender/build_taker_embodiment.py");
    const snapshot = await this.#snapshotExistingAssets();
    const { stdout, stderr } = await execFileAsync(
      blender.path,
      [
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--python-exit-code",
        "1",
        "--python",
        scriptPath,
        "--",
        this.workspace,
      ],
      {
        cwd: this.workspace,
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: MAX_OUTPUT_BYTES,
        signal,
      },
    );
    return {
      rebuilt: true,
      snapshot,
      artifact: this.#insideWorkspace("assets/embodiment/runtime/taker-agent.glb"),
      stdoutTail: stdout.slice(-4_000),
      stderrTail: stderr.slice(-2_000),
    };
  }

  async #snapshotExistingAssets() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshotRoot = this.#insideWorkspace(`.agent/snapshots/embodiment/${timestamp}`);
    const candidates = [
      "assets/embodiment/runtime/taker-agent.glb",
      "assets/embodiment/runtime/taker-agent.source.json",
      "assets/embodiment/runtime/taker-agent.license.txt",
      "assets/embodiment/source/taker-agent.blend",
    ];
    const copied = [];
    for (const relativePath of candidates) {
      const source = this.#insideWorkspace(relativePath);
      try {
        if (!(await stat(source)).isFile()) continue;
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      const target = path.join(snapshotRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      copied.push(relativePath);
    }
    return copied.length > 0 ? { path: snapshotRoot, files: copied } : null;
  }

  #insideWorkspace(relativePath) {
    const target = path.resolve(this.workspace, relativePath);
    const relative = path.relative(this.workspace, target);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      throw new Error("Authoring path escaped the project workspace.");
    }
    return target;
  }
}
