import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const workspace = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("embodiment MCP speaks stdio JSON-RPC and exposes only typed tools", async () => {
  const client = new Client({ name: "taker-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(workspace, "src", "mcp", "embodiment-server.js")],
    cwd: workspace,
    env: { TAKER_WORKSPACE: workspace },
    stderr: "inherit",
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map(({ name }) => name),
      [
        "embodiment_catalog",
        "embodiment_list_assets",
        "embodiment_inspect_asset",
        "blender_probe",
        "blender_rebuild_embodiment",
      ],
    );
    assert.equal(listed.tools.some(({ name }) => /shell|python|exec/.test(name)), false);
    const result = await client.callTool({ name: "embodiment_catalog", arguments: {} });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.catalog.actions.length, 16);
    assert.equal(payload.catalog.assetFormats.includes("vrm-1.0"), true);
  } finally {
    await client.close();
  }
});
