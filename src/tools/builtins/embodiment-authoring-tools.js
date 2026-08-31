"use strict";

import {
  inspectEmbodimentAsset,
  listEmbodimentAssets,
} from "../../authoring/embodiment-assets.js";
import { BlenderAuthoring } from "../../authoring/blender-authoring.js";

export function createEmbodimentAuthoringTools({ workspace }) {
  const blender = new BlenderAuthoring({ workspace });
  return [
    {
      name: "embodiment_list_assets",
      description:
        "List project-local VRM, VRMA, glTF/GLB, and Blender embodiment assets without scanning elsewhere on the machine.",
      risk: "read",
      parameters: emptySchema(),
      describe: () => "List project-local 3D embodiment assets",
      execute: () => listEmbodimentAssets(workspace),
    },
    {
      name: "embodiment_inspect_asset",
      description:
        "Inspect one 3D asset container and its license/source provenance sidecars under assets/embodiment.",
      risk: "read",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: { path: { type: "string", minLength: 1, maxLength: 1_024 } },
      },
      describe: ({ path }) => `Inspect embodiment asset ${path}`,
      execute: ({ path }) => inspectEmbodimentAsset(workspace, path),
    },
    {
      name: "blender_authoring_inspect",
      description:
        "Inspect the pinned Blender authoring runtime and safe deterministic recipe without launching Blender.",
      risk: "read",
      parameters: emptySchema(),
      describe: () => "Inspect Blender embodiment authoring availability",
      execute: () => blender.inspect(),
    },
    {
      name: "blender_rebuild_embodiment",
      description:
        "Run the committed deterministic Blender recipe to rebuild Taker's original GLB. Existing generated assets are snapshotted first. No model-provided code is executed.",
      risk: "execute",
      parameters: emptySchema(),
      describe: () => "Snapshot and rebuild the original Taker GLB with Blender",
      assess: () => ({
        destructive: false,
        elevated: false,
        outsideWorkspace: false,
        ambiguous: true,
        safeInSemiAutonomous: false,
        reason: "Executes Blender and replaces reproducible project assets after a recovery snapshot.",
      }),
      execute: (_args, context) => blender.rebuildStarter({ signal: context.signal }),
    },
  ];
}

function emptySchema() {
  return { type: "object", additionalProperties: false, properties: {} };
}
