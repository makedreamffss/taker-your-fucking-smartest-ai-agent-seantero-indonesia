# Open-source dependency policy

## Admission checklist

A new package, binary, native library, or model artifact is admitted only when:

1. Its upstream repository and maintainer are identified.
2. The exact version, release, commit, or model revision is pinned.
3. The code license and every downloaded model/data license are recorded separately.
4. The artifact has a SHA-256 or lockfile integrity value.
5. Known advisories are checked and the transitive tree is reviewed.
6. It introduces no mandatory paid API, subscription, telemetry, or hosted storage.
7. It passes functional, failure, cancellation, memory, and latency tests on the
   target machine.
8. Its privileges and network behavior are documented.
9. Removal or provider replacement is possible through an interface boundary.

Permissive licenses are preferred. Copyleft components are allowed only as explicit
isolated adapters with distribution obligations understood and documented. A
repository license never automatically covers separately hosted voice or model
weights.

## Current direct dependencies

None. The current JavaScript engine uses Node.js built-ins only. The lockfile remains
committed so dependency drift is visible if packages are introduced later.

## Installed non-npm artifacts

| Artifact | Pin | License | Integrity |
|---|---|---|---|
| whisper.cpp Windows x64 | v1.8.6 / commit 23ee035 | MIT | SHA-256 in assets/voice/manifest.json |
| Whisper base multilingual | revision 98aa99a | MIT | SHA-256 in assets/voice/manifest.json |
| Pocket TTS runtime | 3.0.2 plus transitive lock | MIT | Exact Python package lock |
| Pocket TTS English standard | revision d29db79 | CC-BY-4.0 | Revision-pinned by runtime config |
| Peter Yearsley voice source | voice-zero catalog | CC0-1.0 | SHA-256 in assets/voice/manifest.json |

The voice installer downloads into the ignored `.agent` directory, verifies the
full SHA-256 before extraction/use, and re-verifies cached artifacts. It contains no
hosted-service fallback.

## Candidate ledger

| Candidate | Upstream license | Status |
|---|---|---|
| Silero VAD | MIT | candidate; previous browser adapter was removed with the UI |
| whisper.cpp | MIT | integrated and English fixture benchmarked |
| Pocket TTS 3.0.2 | MIT code + CC-BY-4.0 weights | integrated and benchmarked |
| Kokoro 82M | Apache-2.0 | rejected on measured pitch and latency |
| Chatterbox Nano | MIT | rejected at 12.677 RTF on this CPU |
| Qwen3-TTS 0.6B | Apache-2.0 | rejected for this machine's memory envelope |
| OHF Piper | GPL-3.0 | optional Indonesian TTS adapter |
| Tesseract | Apache-2.0 | OCR baseline candidate |
| PaddleOCR | Apache-2.0 | optional heavy OCR provider |
| FlaUI | MIT | semantic Windows automation candidate; needs .NET |
| Playwright | Apache-2.0 | browser automation candidate |
| sqlite-vec | MIT | optional pre-v1 retrieval candidate |
| WinSW | MIT | future noninteractive broker candidate only |

Candidate means researched, not approved for bundling. No candidate model or binary
is downloaded until its artifact manifest is added.

Pocket TTS runs in a project-local Python 3.12 virtual environment. Its complete
transitive package set is exact-pinned, model downloads are revision-pinned by the
admitted package, and the provider can be replaced without changing conversation or
agent-loop code.

Blender 5.2.1 LTS and its VRM extension may still exist as machine-wide software,
but the project no longer invokes, depends on, or packages either one.
