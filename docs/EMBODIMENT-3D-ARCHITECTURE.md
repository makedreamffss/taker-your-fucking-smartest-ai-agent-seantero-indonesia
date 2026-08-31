# Taker 3D embodiment architecture

## Decision

The skull/pixel renderer is retired. Taker's visible presence is one coherent 3D
rig driven by semantic layers. The visible default is an original Blender-authored
gunmetal construct with a procedural crash-safe fallback, not a third-party
character. Authored bodies use VRM 1.0;
portable animation uses VRMA/glTF 2.0.

Pinned runtime components:

| Component | Pin | License | Role |
|---|---:|---|---|
| Three.js | 0.185.1 | MIT | transparent WebGL renderer and scene graph |
| `@pixiv/three-vrm` | 3.5.5 | MIT | VRM 1.0 loading, humanoid, expressions, look-at, spring bones |
| `@pixiv/three-vrm-animation` | 3.5.5 | MIT | VRMA loading and retargeted Three.js clips |
| MCP TypeScript SDK | 1.30.0 | MIT | stdio authoring server with typed schemas |
| Zod | 4.5.4 | MIT | MCP input validation |

The source references are [Three.js](https://github.com/mrdoob/three.js),
[three-vrm](https://github.com/pixiv/three-vrm), the
[VRM specification](https://github.com/vrm-c/vrm-specification), and the
[glTF 2.0 specification](https://github.com/KhronosGroup/glTF/tree/main/specification/2.0).

## Runtime topology

```text
Ollama agent / deterministic activity mapping
  -> EmbodimentController (trusted main process)
       - validates command contract
       - awaits renderer acceptance
       - records bounded status/telemetry
       - exposes the same domain through native agent tools
  -> narrow Electron preload channel
  -> sandboxed Three.js renderer
       - base pose (persistent)
       - mood (persistent)
       - action (finite coherent clip)
       - gaze (bounded overlay)
       - speech energy (bounded overlay)
       - Blender-authored original GLB now
       - procedural articulated fallback
       - VRM/VRMA adapter for authored assets
```

The LLM selects semantic names. It does not generate frame-by-frame joint rotations
inside a conversation. This follows the latency and separation-of-concerns lesson
documented by the MIT-licensed
[MotionEngine](https://github.com/lhupyn/motion-engine): stable client code owns
motion mechanics; the model communicates intent.

## Animation truthfulness

The public catalog contains sixteen action clips. Each clip moves named joints on
the same articulated hierarchy over a finite duration. Persistent mood variants,
idle breathing, gaze direction, speech-energy response, and activity states are
separate layers and are not counted as extra clips.

The first clip catalog deliberately values recognizability over inflated counts:
acknowledge, arrive, brace, celebrate, decline, dance, jump, point left/right,
roll, salute, scan, stretch, think, wave, and work. Future additions must have a
distinct motion definition, automated contract test, visual capture, and name that
describes what a reviewer can actually see.

## Asset and authoring pipeline

```text
Blender + VRM Add-on
  -> .blend source in assets/embodiment
  -> export VRM 1.0 body and VRMA/glTF clips
  -> container validation + license/source sidecars
  -> deterministic renderer build
  -> visual action-contact-sheet review
```

Blender is an external GPL authoring application; exported original assets are not
made GPL merely because Blender produced them. The maintained
[VRM Add-on for Blender](https://github.com/saturday06/VRM-Addon-for-Blender)
supports VRM import/export, editing, VRM Animation, and Python automation. Add-on
code and each asset's license remain separate provenance records.

The installed authoring runtime is Blender 5.2.1 LTS. VRM format extension 4.5.0
was obtained from Blender's official extension index, which declares Blender
4.2–5.2 compatibility, file-only permission, and archive SHA-256
`e5e0f923a0bb11eb1320870b2db8091948dd5b63014510d839016a112e40a35a`.

## Performance budget

- Transparent window: 320 by 440 CSS pixels, device pixel ratio capped at 2.
- Renderer target: 60 FPS; delta time capped to avoid resume explosions.
- Original rig: under 100 draw calls and 100,000 triangles, including edge lines.
- External avatar admission: under 150,000 triangles, bounded texture dimensions,
  no external network resources, and no embedded executable behavior.
- Renderer failure is non-fatal to the agent engine and reported through a bounded
  error channel.

## Deliberately excluded

- No Claude, Iron Man, JARVIS, Ready Player Me demo, or other branded likeness.
- No Google or paid TTS coupling.
- No CDN runtime dependencies.
- No arbitrary Blender Python or shell MCP tool.
- No claim that pose parameter combinations are separate authored animations.
