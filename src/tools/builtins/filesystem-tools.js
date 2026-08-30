import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { ToolInputError } from "../../core/errors.js";

const MAX_TEXT_BYTES = 2_000_000;
const MAX_DIRECTORY_ENTRIES = 2_000;
const MAX_SEARCH_RESULTS = 2_000;

export function createFilesystemTools({ workspace }) {
  const root = path.resolve(workspace);
  const resolveTarget = (requestedPath = ".") => resolveUserPath(root, requestedPath);

  const assessPath = async (requestedPath) => {
    const target = resolveTarget(requestedPath);
    const insideWorkspace = await resolvesInside(root, target);
    return { target, insideWorkspace };
  };

  return [
    {
      name: "inspect_path",
      description:
        "Inspect any file, directory, or link on the machine. Relative paths use the default workspace; absolute paths are supported.",
      risk: "read",
      parameters: pathOnlySchema("Path to inspect."),
      describe: ({ path: requestedPath }) => `Inspect ${resolveTarget(requestedPath)}`,
      async assess({ path: requestedPath }) {
        const { target, insideWorkspace } = await assessPath(requestedPath);
        return readAssessment(target, insideWorkspace);
      },
      async execute({ path: requestedPath }) {
        const target = resolveTarget(requestedPath);
        const details = await lstat(target);
        let resolvedPath = target;
        try {
          resolvedPath = await realpath(target);
        } catch {
          // Broken links still have useful lstat metadata.
        }
        return {
          path: target,
          resolvedPath,
          type: statType(details),
          sizeBytes: details.size,
          createdAt: details.birthtime.toISOString(),
          modifiedAt: details.mtime.toISOString(),
          accessedAt: details.atime.toISOString(),
          mode: details.mode.toString(8),
        };
      },
    },
    {
      name: "list_directory",
      description:
        "List any directory on the machine. Relative paths use the default workspace; absolute paths are supported.",
      risk: "read",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", maxLength: 32_768 },
          limit: { type: "integer", minimum: 1, maximum: MAX_DIRECTORY_ENTRIES },
        },
      },
      describe: ({ path: requestedPath = "." }) =>
        `List directory ${resolveTarget(requestedPath)}`,
      async assess({ path: requestedPath = "." }) {
        const { target, insideWorkspace } = await assessPath(requestedPath);
        return readAssessment(target, insideWorkspace);
      },
      async execute({ path: requestedPath = ".", limit = 500 }) {
        const target = resolveTarget(requestedPath);
        const entries = await readdir(target, { withFileTypes: true });
        entries.sort((left, right) => {
          const directoryOrder = Number(right.isDirectory()) - Number(left.isDirectory());
          return directoryOrder || left.name.localeCompare(right.name);
        });
        return {
          path: target,
          entries: entries.slice(0, limit).map((entry) => ({
            name: entry.name,
            path: path.join(target, entry.name),
            type: direntType(entry),
          })),
          totalEntries: entries.length,
          truncated: entries.length > limit,
        };
      },
    },
    {
      name: "read_text_file",
      description:
        "Read a UTF-8 text file anywhere on the machine. Relative and absolute paths are supported.",
      risk: "read",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 32_768 },
          max_bytes: { type: "integer", minimum: 1, maximum: MAX_TEXT_BYTES },
        },
      },
      describe: ({ path: requestedPath }) => `Read text file ${resolveTarget(requestedPath)}`,
      async assess({ path: requestedPath }) {
        const { target, insideWorkspace } = await assessPath(requestedPath);
        return readAssessment(target, insideWorkspace);
      },
      async execute({ path: requestedPath, max_bytes: maxBytes = 200_000 }) {
        const target = resolveTarget(requestedPath);
        const details = await stat(target);
        if (!details.isFile()) {
          throw new ToolInputError(`${target} is not a regular file.`);
        }
        const bytesToRead = Math.min(details.size, maxBytes);
        const file = await open(target, "r");
        let buffer = Buffer.alloc(bytesToRead);
        try {
          if (bytesToRead > 0) {
            const { bytesRead } = await file.read(buffer, 0, bytesToRead, 0);
            buffer = buffer.subarray(0, bytesRead);
          }
        } finally {
          await file.close();
        }
        if (buffer.includes(0)) {
          throw new ToolInputError(`${target} appears to be binary.`);
        }
        return {
          path: target,
          content: new TextDecoder("utf-8", { fatal: false }).decode(buffer),
          sizeBytes: details.size,
          truncated: details.size > maxBytes,
        };
      },
    },
    {
      name: "search_files",
      description:
        "Recursively search file and directory names anywhere on the machine. Links are reported but not followed.",
      risk: "read",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 1_000 },
          path: { type: "string", maxLength: 32_768 },
          use_regex: { type: "boolean" },
          max_depth: { type: "integer", minimum: 0, maximum: 100 },
          max_results: { type: "integer", minimum: 1, maximum: MAX_SEARCH_RESULTS },
        },
      },
      describe: ({ query, path: requestedPath = "." }) =>
        `Search names under ${resolveTarget(requestedPath)} for ${JSON.stringify(query)}`,
      async assess({ path: requestedPath = "." }) {
        const { target, insideWorkspace } = await assessPath(requestedPath);
        return readAssessment(target, insideWorkspace);
      },
      async execute({
        query,
        path: requestedPath = ".",
        use_regex: useRegex = false,
        max_depth: maxDepth = 20,
        max_results: maxResults = 500,
      }) {
        const start = resolveTarget(requestedPath);
        const matcher = createNameMatcher(query, useRegex);
        const queue = [{ directory: start, depth: 0 }];
        const matches = [];
        const errors = [];

        while (queue.length > 0 && matches.length < maxResults) {
          const { directory, depth } = queue.shift();
          let entries;
          try {
            entries = await readdir(directory, { withFileTypes: true });
          } catch (error) {
            errors.push({ path: directory, message: error.message });
            continue;
          }
          for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (matcher(entry.name)) {
              matches.push({ path: entryPath, type: direntType(entry) });
              if (matches.length >= maxResults) break;
            }
            if (entry.isDirectory() && depth < maxDepth) {
              queue.push({ directory: entryPath, depth: depth + 1 });
            }
          }
        }
        return {
          root: start,
          matches,
          truncated: matches.length >= maxResults,
          inaccessible: errors.slice(0, 50),
        };
      },
    },
    {
      name: "write_text_file",
      description:
        "Create or overwrite a UTF-8 text file anywhere on the machine. Existing files can be backed up automatically.",
      risk: "write",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 32_768 },
          content: { type: "string", maxLength: MAX_TEXT_BYTES },
          overwrite: { type: "boolean" },
          create_parent: { type: "boolean" },
          backup: { type: "boolean" },
        },
      },
      describe: ({ path: requestedPath, content, overwrite = true }) =>
        `${overwrite ? "Write/overwrite" : "Create"} ${resolveTarget(requestedPath)} (${Buffer.byteLength(content, "utf8")} bytes)`,
      async assess({ path: requestedPath, overwrite = true }) {
        const target = resolveTarget(requestedPath);
        const [insideWorkspace, exists] = await Promise.all([
          resolvesInside(root, target),
          pathExists(target),
        ]);
        const overwrites = exists && overwrite;
        return {
          destructive: overwrites,
          outsideWorkspace: !insideWorkspace,
          ambiguous: false,
          safeInSemiAutonomous: insideWorkspace && !overwrites,
          reason: overwrites
            ? `This overwrites existing data at ${target}.`
            : insideWorkspace
              ? `This creates a file inside the default workspace.`
              : `This writes outside the default workspace at ${target}.`,
        };
      },
      async execute({
        path: requestedPath,
        content,
        overwrite = true,
        create_parent: createParent = true,
        backup = true,
      }) {
        const target = resolveTarget(requestedPath);
        const exists = await pathExists(target);
        if (exists && !overwrite) {
          throw new ToolInputError(`${target} already exists and overwrite is false.`);
        }
        if (exists && !(await lstat(target)).isFile()) {
          throw new ToolInputError(`${target} exists but is not a regular file.`);
        }
        if (createParent) await mkdir(path.dirname(target), { recursive: true });

        let backupPath;
        if (exists && backup) {
          backupPath = await createBackup(root, target);
        }

        const temporaryPath = path.join(
          path.dirname(target),
          `.${path.basename(target)}.${randomUUID()}.tmp`,
        );
        try {
          await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
          try {
            await rename(temporaryPath, target);
          } catch (error) {
            if (!exists || process.platform !== "win32") throw error;
            await rm(target, { force: false });
            await rename(temporaryPath, target);
          }
        } finally {
          await rm(temporaryPath, { force: true }).catch(() => {});
        }

        return {
          path: target,
          bytesWritten: Buffer.byteLength(content, "utf8"),
          sha256: createHash("sha256").update(content, "utf8").digest("hex"),
          overwritten: exists,
          backupPath,
        };
      },
    },
    {
      name: "create_directory",
      description: "Create a directory anywhere on the machine, including parent directories.",
      risk: "write",
      parameters: pathOnlySchema("Directory path to create."),
      describe: ({ path: requestedPath }) => `Create directory ${resolveTarget(requestedPath)}`,
      async assess({ path: requestedPath }) {
        const target = resolveTarget(requestedPath);
        const insideWorkspace = await resolvesInside(root, target);
        return {
          outsideWorkspace: !insideWorkspace,
          ambiguous: false,
          safeInSemiAutonomous: insideWorkspace,
          reason: insideWorkspace
            ? "Creates directories inside the default workspace."
            : `Creates directories outside the workspace at ${target}.`,
        };
      },
      async execute({ path: requestedPath }) {
        const target = resolveTarget(requestedPath);
        await mkdir(target, { recursive: true });
        return { path: target, created: true };
      },
    },
    {
      name: "copy_path",
      description: "Copy a file or directory anywhere on the machine.",
      risk: "write",
      parameters: transferSchema(),
      describe: ({ source, destination }) =>
        `Copy ${resolveTarget(source)} to ${resolveTarget(destination)}`,
      async assess({ source, destination, overwrite = false }) {
        const sourcePath = resolveTarget(source);
        const destinationPath = resolveTarget(destination);
        const [sourceInside, destinationInside, destinationExists] = await Promise.all([
          resolvesInside(root, sourcePath),
          resolvesInside(root, destinationPath),
          pathExists(destinationPath),
        ]);
        return {
          destructive: destinationExists && overwrite,
          outsideWorkspace: !sourceInside || !destinationInside,
          ambiguous: false,
          safeInSemiAutonomous:
            sourceInside && destinationInside && !(destinationExists && overwrite),
          reason:
            destinationExists && overwrite
              ? `This can replace the destination ${destinationPath}.`
              : "Copies data without removing the source.",
        };
      },
      async execute({ source, destination, overwrite = false, recursive = true }) {
        const sourcePath = resolveTarget(source);
        const destinationPath = resolveTarget(destination);
        const sourceStat = await lstat(sourcePath);
        await mkdir(path.dirname(destinationPath), { recursive: true });
        if (sourceStat.isDirectory()) {
          if (!recursive) throw new ToolInputError("recursive must be true for directories.");
          await cp(sourcePath, destinationPath, {
            recursive: true,
            force: overwrite,
            errorOnExist: !overwrite,
          });
        } else {
          await copyFile(
            sourcePath,
            destinationPath,
            overwrite ? 0 : fsConstants.COPYFILE_EXCL,
          );
        }
        return { source: sourcePath, destination: destinationPath };
      },
    },
    {
      name: "move_path",
      description: "Move or rename a file or directory anywhere on the machine.",
      risk: "write",
      parameters: transferSchema(),
      describe: ({ source, destination }) =>
        `Move ${resolveTarget(source)} to ${resolveTarget(destination)}`,
      async assess({ source, destination }) {
        const sourcePath = resolveTarget(source);
        const destinationPath = resolveTarget(destination);
        const [sourceInside, destinationInside] = await Promise.all([
          resolvesInside(root, sourcePath),
          resolvesInside(root, destinationPath),
        ]);
        return {
          destructive: true,
          outsideWorkspace: !sourceInside || !destinationInside,
          ambiguous: false,
          safeInSemiAutonomous: false,
          reason: `Moving removes the source path ${sourcePath}.`,
        };
      },
      async execute({ source, destination, overwrite = false }) {
        const sourcePath = resolveTarget(source);
        const destinationPath = resolveTarget(destination);
        const destinationExists = await pathExists(destinationPath);
        if (destinationExists && !overwrite) {
          throw new ToolInputError(`${destinationPath} exists and overwrite is false.`);
        }
        if (destinationExists) await rm(destinationPath, { recursive: true, force: false });
        await mkdir(path.dirname(destinationPath), { recursive: true });
        try {
          await rename(sourcePath, destinationPath);
        } catch (error) {
          if (error.code !== "EXDEV") throw error;
          await cp(sourcePath, destinationPath, { recursive: true, force: overwrite });
          await rm(sourcePath, { recursive: true, force: false });
        }
        return { source: sourcePath, destination: destinationPath };
      },
    },
    {
      name: "delete_path",
      description:
        "Delete a file or directory anywhere on the machine. On Windows, permanent=false sends it to the Recycle Bin.",
      risk: "control",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 32_768 },
          recursive: { type: "boolean" },
          permanent: { type: "boolean" },
        },
      },
      describe: ({ path: requestedPath, permanent = false }) =>
        `${permanent ? "Permanently delete" : "Send to Recycle Bin"} ${resolveTarget(requestedPath)}`,
      async assess({ path: requestedPath, permanent = false }) {
        const target = resolveTarget(requestedPath);
        const insideWorkspace = await resolvesInside(root, target);
        return {
          destructive: true,
          outsideWorkspace: !insideWorkspace,
          ambiguous: false,
          safeInSemiAutonomous: false,
          reason: permanent
            ? `This permanently deletes ${target}.`
            : `This removes ${target} and attempts recoverable deletion.`,
        };
      },
      async execute({ path: requestedPath, recursive = false, permanent = false }) {
        const target = resolveTarget(requestedPath);
        const details = await lstat(target);
        if (!permanent) {
          if (process.platform !== "win32") {
            throw new ToolInputError(
              "Recoverable deletion is currently implemented for Windows only. Set permanent=true to delete on this platform.",
            );
          }
          await sendToWindowsRecycleBin(target);
          return { path: target, deleted: true, recoverable: true };
        }
        if (details.isDirectory() && !recursive) {
          throw new ToolInputError("recursive=true is required to permanently delete a directory.");
        }
        await rm(target, { recursive, force: false });
        return { path: target, deleted: true, recoverable: false };
      },
    },
    {
      name: "get_current_time",
      description: "Return the current date and time, optionally in an IANA time zone.",
      risk: "read",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          time_zone: { type: "string", maxLength: 100 },
        },
      },
      describe: ({ time_zone: timeZone }) =>
        `Read current time${timeZone ? ` in ${timeZone}` : ""}`,
      async execute({ time_zone: timeZone }) {
        try {
          const now = new Date();
          return {
            isoUtc: now.toISOString(),
            local: new Intl.DateTimeFormat("en-CA", {
              dateStyle: "full",
              timeStyle: "long",
              ...(timeZone ? { timeZone } : {}),
            }).format(now),
            timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          };
        } catch (error) {
          throw new ToolInputError(`Invalid time zone: ${timeZone}.`, { cause: error });
        }
      },
    },
  ];
}

function pathOnlySchema(description) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string", description, minLength: 1, maxLength: 32_768 },
    },
  };
}

function transferSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["source", "destination"],
    properties: {
      source: { type: "string", minLength: 1, maxLength: 32_768 },
      destination: { type: "string", minLength: 1, maxLength: 32_768 },
      overwrite: { type: "boolean" },
      recursive: { type: "boolean" },
    },
  };
}

function resolveUserPath(workspace, requestedPath) {
  if (typeof requestedPath !== "string" || !requestedPath || requestedPath.includes("\0")) {
    throw new ToolInputError("path must be a non-empty valid string.");
  }
  return path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(workspace, requestedPath);
}

function readAssessment(target, insideWorkspace) {
  return {
    outsideWorkspace: !insideWorkspace,
    ambiguous: false,
    safeInSemiAutonomous: insideWorkspace,
    reason: insideWorkspace
      ? "Read-only access inside the default workspace."
      : `Reads data outside the default workspace at ${target}.`,
  };
}

async function resolvesInside(workspace, candidate) {
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(workspace);
  } catch {
    canonicalRoot = path.resolve(workspace);
  }

  let cursor = path.resolve(candidate);
  const suffix = [];
  while (true) {
    try {
      const canonicalBase = await realpath(cursor);
      const canonicalCandidate = path.resolve(canonicalBase, ...suffix.reverse());
      return isInside(canonicalRoot, canonicalCandidate);
    } catch (error) {
      if (error.code !== "ENOENT") return isInside(canonicalRoot, candidate);
      const parent = path.dirname(cursor);
      if (parent === cursor) return false;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return !(
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

async function pathExists(candidate) {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function createBackup(workspace, target) {
  const date = new Date().toISOString().slice(0, 10);
  const pathHash = createHash("sha256").update(target).digest("hex").slice(0, 12);
  const backupDirectory = path.join(workspace, ".agent", "backups", date);
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(
    backupDirectory,
    `${Date.now()}-${pathHash}-${path.basename(target)}`,
  );
  await copyFile(target, backupPath, fsConstants.COPYFILE_EXCL);
  return backupPath;
}

function createNameMatcher(query, useRegex) {
  if (useRegex) {
    let expression;
    try {
      expression = new RegExp(query, "i");
    } catch (error) {
      throw new ToolInputError(`Invalid regular expression: ${error.message}`);
    }
    return (name) => expression.test(name);
  }
  const needle = query.toLocaleLowerCase();
  return (name) => name.toLocaleLowerCase().includes(needle);
}

function statType(details) {
  if (details.isDirectory()) return "directory";
  if (details.isFile()) return "file";
  if (details.isSymbolicLink()) return "symbolic_link";
  if (details.isSocket()) return "socket";
  return "other";
}

function direntType(entry) {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (entry.isSymbolicLink()) return "symbolic_link";
  return "other";
}

async function sendToWindowsRecycleBin(target) {
  const encodedTarget = Buffer.from(target, "utf8").toString("base64");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `\$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedTarget}'))`,
    "Add-Type -AssemblyName Microsoft.VisualBasic",
    "if ([IO.Directory]::Exists($target)) {",
    "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($target, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)",
    "} elseif ([IO.File]::Exists($target)) {",
    "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($target, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)",
    "} else { throw 'Target no longer exists.' }",
  ].join("\n");
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");
  await runProcess("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encodedScript,
  ]);
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} exited with ${code}: ${stderr.trim()}`));
    });
  });
}
