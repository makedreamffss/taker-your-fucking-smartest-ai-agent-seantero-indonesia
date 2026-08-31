import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const projectRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const sourceRoot = path.join(projectRoot, "src", "desktop", "renderer");
const outputRoot = path.join(projectRoot, "dist", "desktop", "renderer");
const vadOutput = path.join(outputRoot, "vad");
const embodimentSource = path.join(projectRoot, "assets", "embodiment", "runtime");
const embodimentOutput = path.join(outputRoot, "embodiment");

await build({
  root: sourceRoot,
  base: "./",
  logLevel: "warn",
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
    target: "chrome148",
    sourcemap: false,
    rollupOptions: {
      input: {
        pet: path.join(sourceRoot, "index.html"),
        popover: path.join(sourceRoot, "popover.html"),
        vadSmoke: path.join(sourceRoot, "vad-smoke.html"),
      },
    },
  },
});

await mkdir(vadOutput, { recursive: true });
await cp(embodimentSource, embodimentOutput, { recursive: true });
const artifacts = [
  {
    source: path.join(
      projectRoot,
      "node_modules",
      "@ricky0123",
      "vad-web",
      "dist",
      "silero_vad_v5.onnx",
    ),
    name: "silero_vad_v5.onnx",
  },
  {
    source: path.join(
      projectRoot,
      "node_modules",
      "@ricky0123",
      "vad-web",
      "dist",
      "vad.worklet.bundle.min.js",
    ),
    name: "vad.worklet.bundle.min.js",
  },
  {
    source: path.join(
      projectRoot,
      "node_modules",
      "onnxruntime-web",
      "dist",
      "ort-wasm-simd-threaded.mjs",
    ),
    name: "ort-wasm-simd-threaded.mjs",
  },
  {
    source: path.join(
      projectRoot,
      "node_modules",
      "onnxruntime-web",
      "dist",
      "ort-wasm-simd-threaded.wasm",
    ),
    name: "ort-wasm-simd-threaded.wasm",
  },
];

const manifest = {};
for (const artifact of artifacts) {
  const target = path.join(vadOutput, artifact.name);
  await copyFile(artifact.source, target);
  const bytes = await readFile(target);
  manifest["vad/" + artifact.name] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
await writeFile(
  path.join(outputRoot, "asset-manifest.json"),
  JSON.stringify({ schemaVersion: 1, assets: manifest }, null, 2) + "\n",
);
