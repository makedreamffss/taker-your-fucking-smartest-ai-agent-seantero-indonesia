import { MicVAD } from "@ricky0123/vad-web";

export async function createMicrophoneVad() {
  return MicVAD.new({
    model: "v5",
    startOnLoad: false,
    processorType: "AudioWorklet",
    baseAssetPath: "taker://app/vad/",
    onnxWASMBasePath: "taker://app/vad/",
    positiveSpeechThreshold: 0.6,
    negativeSpeechThreshold: 0.35,
    redemptionMs: 600,
    preSpeechPadMs: 320,
    minSpeechMs: 250,
    ortConfig(ort) {
      ort.env.logLevel = "error";
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
    },
    onSpeechStart() {
      window.taker.voice.reportEvent("speech_started");
    },
    onSpeechRealStart() {},
    onVADMisfire() {
      window.taker.voice.reportEvent("vad_misfire");
    },
    onSpeechEnd(audio) {
      const buffer = audio.buffer.slice(
        audio.byteOffset,
        audio.byteOffset + audio.byteLength,
      );
      window.taker.voice.submitSpeechSegment(buffer);
    },
  });
}
