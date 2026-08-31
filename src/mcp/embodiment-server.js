#!/usr/bin/env node
"use strict";

import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import {
  findBlenderBinary,
  inspectEmbodimentAsset,
  listEmbodimentAssets,
} from "../authoring/embodiment-assets.js";
import { BlenderAuthoring } from "../authoring/blender-authoring.js";
import { embodimentCatalog } from "../embodiment/contracts.js";

const workspace = path.resolve(process.env.TAKER_WORKSPACE || process.cwd());
const blenderAuthoring = new BlenderAuthoring({ workspace });
const server = new McpServer({
  name: "taker-embodiment-authoring",
  version: "0.1.0",
});

server.registerTool(
  "embodiment_catalog",
  {
    description:
      "Return the public pose/mood/action tracks and supported open 3D asset formats for Taker's embodiment.",
    inputSchema: {},
  },
  async () => textResult({ workspace, catalog: embodimentCatalog() }),
);

server.registerTool(
  "embodiment_list_assets",
  {
    description:
      "List VRM, VRMA, glTF/GLB, and Blender assets under the allowlisted project asset root. Does not follow links or scan the machine.",
    inputSchema: {},
  },
  async () => textResult(await listEmbodimentAssets(workspace)),
);

server.registerTool(
  "embodiment_inspect_asset",
  {
    description:
      "Validate one project-local 3D asset container and check for license and source-provenance sidecars before integration.",
    inputSchema: {
      path: z.string().min(1).max(1024).describe("Path relative to assets/embodiment."),
    },
  },
  async ({ path: requestedPath }) =>
    textResult(await inspectEmbodimentAsset(workspace, requestedPath)),
);

server.registerTool(
  "blender_probe",
  {
    description:
      "Check explicit supported Blender installation paths. This never starts Blender and exposes no arbitrary Python or shell execution.",
    inputSchema: {},
  },
  async () => textResult(await findBlenderBinary()),
);

server.registerTool(
  "blender_rebuild_embodiment",
  {
    description:
      "Snapshot existing generated assets, then run the fixed project-owned Blender recipe. This mutates only assets/embodiment and never executes model-provided code.",
    inputSchema: {
      confirmation: z
        .literal("REBUILD_TAKER_EMBODIMENT")
        .describe("Exact mutation acknowledgement required in addition to the MCP client's approval UI."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => textResult(await blenderAuthoring.rebuildStarter()),
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[taker-embodiment-mcp] stdio ready\n");

function textResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}
