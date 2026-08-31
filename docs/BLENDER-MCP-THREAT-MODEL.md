# Blender and MCP threat model

## Trust boundary

Blender's Python API can read files, access the network, spawn processes, and modify
the whole scene. A tool that forwards model text to Python `exec()` is equivalent
to an unrestricted host shell, not a safe 3D command. User approval remains useful,
but it does not make an opaque generated program reviewable.

The project therefore uses a stdio-first MCP server with these invariants:

1. stdout is reserved for JSON-RPC; diagnostics go to stderr.
2. Every input has a typed Zod schema and bounded strings/numbers.
3. Files are resolved beneath `assets/embodiment`; traversal is rejected.
4. Asset inspection is read-only, size-bounded, and does not follow links.
5. Blender discovery checks explicit installation paths and does not launch it.
6. No arbitrary shell, arbitrary Python, remote HTTP listener, telemetry, asset
   marketplace, or implicit network access is exposed.
7. The one current mutation recipe is enumerated, snapshots the GLB/provenance and
   `.blend` first, disables embedded auto-execution, has a fixed project-owned script,
   and passes through Taker's approval policy. MCP additionally requires an exact
   mutation acknowledgement.

This design follows the typed tools, workspace roots, policy gates, and snapshot
ideas in the Apache-2.0 [Aqua Blender MCP](https://github.com/Aqua-218/Blender-MCP)
without treating its alpha API as a stable dependency. We explicitly reject the
common raw-code design because the upstream
[Blender MCP security report](https://github.com/ahujasid/blender-mcp/issues/95)
demonstrates host-code execution, and that project's optional telemetry/terms are
not appropriate for a private local agent.

## Recipe contract

Write-capable Blender recipes contain an immutable recipe id, validated asset inputs,
destination beneath the asset root, maximum runtime, snapshot path,
`--disable-autoexec`, `--factory-startup`, `--python-exit-code 1`, and generated
artifact hashes. Recipes call audited project-owned scripts; model-provided source
code is never interpolated into Blender Python. The starter rebuild implements this
contract; polygon/texture budget enforcement remains the next authoring hardening
gate.
