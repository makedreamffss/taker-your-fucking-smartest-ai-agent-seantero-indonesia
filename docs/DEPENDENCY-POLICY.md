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

| Dependency | Pin | License | Purpose |
|---|---:|---|---|
| @ricky0123/vad-web | 0.0.30 | ISC | Browser microphone VAD adapter |
| onnxruntime-web | 1.29.0 | MIT | Local Silero ONNX/WASM inference |
| Electron | 42.10.1 | MIT | Transparent sandboxed pet and popovers |
| Vite | 8.2.2 | MIT | Reproducible local renderer build |
| marked | 18.0.11 | MIT | GFM parsing; output is never trusted directly |
| DOMPurify | 3.4.14 | MPL-2.0 OR Apache-2.0 | Strict response HTML sanitization |
| sherpa-onnx-node / win-x64 | 1.13.6 | Apache-2.0 | Local neural TTS runtime |

The lockfile is committed. npm reported zero known vulnerabilities after
installation. Vite and Electron are development/runtime-host dependencies; the
terminal agent core still uses Node built-ins.

## Installed non-npm artifacts

| Artifact | Pin | License | Integrity |
|---|---|---|---|
| whisper.cpp Windows x64 | v1.8.6 / commit 23ee035 | MIT | SHA-256 in assets/voice/manifest.json |
| Whisper base multilingual | revision 98aa99a | MIT | SHA-256 in assets/voice/manifest.json |
| Silero VAD v5 model | vad-web 0.0.30 package | MIT upstream | npm integrity plus generated build SHA-256 |
| Supertonic 3 INT8 | 2026-05-11 | OpenRAIL-M | SHA-256 in assets/voice/manifest.json |

The voice installer downloads into the ignored .agent directory, verifies the full
SHA-256 before extraction/use, and re-verifies cached artifacts. The renderer build
self-hosts the VAD model, worklet, and exact matching ONNX Runtime artifacts. It
contains no CDN fallback.

## Candidate ledger

| Candidate | Upstream license | Status |
|---|---|---|
| Silero VAD | MIT | integrated; live microphone benchmark pending |
| whisper.cpp | MIT | integrated and English fixture benchmarked |
| sherpa-onnx + Supertonic 3 INT8 | Apache-2.0 + OpenRAIL-M | integrated and benchmarked |
| Kokoro 82M | Apache-2.0 | English TTS candidate |
| OHF Piper | GPL-3.0 | optional Indonesian TTS adapter |
| Tesseract | Apache-2.0 | OCR baseline candidate |
| PaddleOCR | Apache-2.0 | optional heavy OCR provider |
| FlaUI | MIT | semantic Windows automation candidate; needs .NET |
| Playwright | Apache-2.0 | browser automation candidate |
| sqlite-vec | MIT | optional pre-v1 retrieval candidate |
| WinSW | MIT | future noninteractive broker candidate only |

Candidate means researched, not approved for bundling. No candidate model or binary
is downloaded until its artifact manifest is added.

The Supertonic code repository was archived by its owner in July 2026. The admitted
runtime is therefore exact-pinned, checksum-verified, and isolated behind the TTS
interface so a maintained provider can replace it without changing conversation or
desktop code. Archive status is not concealed as a quality claim.
