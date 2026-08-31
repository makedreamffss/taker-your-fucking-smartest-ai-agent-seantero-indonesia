# Embodiment assets

This directory is the only asset root exposed by the embodiment authoring MCP
server. Runtime code can fall back to the original procedural rig, so no third-party
avatar is silently bundled.

Every distributable model or animation must include provenance sidecars:

- `<asset>.license.txt` records the asset license and required attribution.
- `<asset>.source.json` records source URL, author, exact revision/hash, download
  date, and local SHA-256.

Accepted containers are VRM 1.0 (`.vrm`), VRM Animation (`.vrma`), glTF/GLB 2.0,
and Blender authoring files. A source-code repository license does not automatically
license separately hosted demo avatars or motion files.
