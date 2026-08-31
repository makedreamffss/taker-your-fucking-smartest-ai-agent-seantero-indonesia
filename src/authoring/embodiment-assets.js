"use strict";

import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ALLOWED_EXTENSIONS = new Set([".vrm", ".vrma", ".glb", ".gltf", ".blend"]);
const MAX_ASSET_BYTES = 512 * 1024 * 1024;

export function embodimentAssetRoot(workspace) {
  return path.resolve(workspace, "assets", "embodiment");
}

export async function listEmbodimentAssets(workspace) {
  const root = embodimentAssetRoot(workspace);
  const entries = [];
  await walk(root, root, entries);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { root, assets: entries };
}

export async function inspectEmbodimentAsset(workspace, requestedPath) {
  const root = embodimentAssetRoot(workspace);
  const target = resolveInside(root, requestedPath);
  const details = await stat(target);
  if (!details.isFile()) throw new TypeError("Embodiment asset must be a regular file.");
  if (details.size > MAX_ASSET_BYTES) {
    throw new RangeError(`Embodiment asset exceeds ${MAX_ASSET_BYTES} bytes.`);
  }
  const extension = path.extname(target).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new TypeError(`Unsupported embodiment asset extension: ${extension || "none"}.`);
  }
  const handle = await readFile(target);
  const header = handle.subarray(0, 20);
  const format = identifyFormat(extension, header);
  const sidecars = await inspectSidecars(target);
  return {
    path: target,
    relativePath: path.relative(root, target),
    bytes: details.size,
    extension,
    format,
    validContainer: format !== "unknown",
    provenance: sidecars,
    distributable: sidecars.licensePresent && sidecars.sourcePresent,
  };
}

export async function findBlenderBinary() {
  const candidates = [
    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe",
    "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe",
    "C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe",
    "C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe",
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return { installed: true, path: candidate };
    } catch {
      // Continue through explicit known installation paths.
    }
  }
  return { installed: false, path: null };
}

function resolveInside(root, requestedPath) {
  if (typeof requestedPath !== "string" || requestedPath.length < 1) {
    throw new TypeError("Asset path is required.");
  }
  const target = path.resolve(root, requestedPath);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new TypeError("Asset path must stay inside assets/embodiment.");
  }
  return target;
}

async function walk(root, directory, output) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, target, output);
    } else if (entry.isFile() && ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const details = await stat(target);
      output.push({ path: path.relative(root, target), bytes: details.size });
    }
  }
}

function identifyFormat(extension, header) {
  if (extension === ".blend") return header.subarray(0, 7).toString("ascii") === "BLENDER" ? "blend" : "unknown";
  if ([".vrm", ".vrma", ".glb"].includes(extension)) {
    return header.subarray(0, 4).toString("ascii") === "glTF" ? extension.slice(1) : "unknown";
  }
  if (extension === ".gltf") {
    const prefix = header.toString("utf8").trimStart();
    return prefix.startsWith("{") ? "gltf" : "unknown";
  }
  return "unknown";
}

async function inspectSidecars(target) {
  const directory = path.dirname(target);
  const stem = path.basename(target, path.extname(target));
  const names = new Set((await readdir(directory)).map((name) => name.toLowerCase()));
  return {
    licensePresent:
      names.has(`${stem.toLowerCase()}.license.txt`) ||
      names.has("license.txt") ||
      names.has("license.md"),
    sourcePresent:
      names.has(`${stem.toLowerCase()}.source.json`) ||
      names.has("source.json"),
  };
}
