import { createMicrophoneVad } from "./voice-capture.js";

window.vadSmokeResult = (async () => {
  const vad = await createMicrophoneVad();
  const audioContext = new AudioContext({ sampleRate: 16_000 });
  await audioContext.audioWorklet.addModule(
    "taker://app/vad/vad.worklet.bundle.min.js",
  );
  const worklet = new AudioWorkletNode(
    audioContext,
    "vad-helper-worklet",
    { processorOptions: { frameSamples: 512 } },
  );
  worklet.disconnect();
  await audioContext.close();
  return {
    modelLoaded: Boolean(vad),
    workletLoaded: true,
  };
})();
