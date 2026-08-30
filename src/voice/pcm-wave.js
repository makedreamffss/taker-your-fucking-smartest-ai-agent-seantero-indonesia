const PCM16_MAX = 32_767;
const PCM16_MIN = -32_768;

export function encodeMonoPcm16Wave(samples, sampleRate = 16_000) {
  if (!(samples instanceof Float32Array)) {
    throw new TypeError("PCM samples must be a Float32Array.");
  }
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8_000 ||
    sampleRate > 192_000
  ) {
    throw new RangeError("sampleRate must be an integer from 8000 through 192000.");
  }

  const dataLength = samples.length * 2;
  const output = Buffer.allocUnsafe(44 + dataLength);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + dataLength, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(dataLength, 40);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? samples[index] : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    const value =
      clamped < 0
        ? Math.round(clamped * -PCM16_MIN)
        : Math.round(clamped * PCM16_MAX);
    output.writeInt16LE(value, 44 + index * 2);
  }
  return output;
}
