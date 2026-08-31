"use strict";

import { DEFAULT_MOOD, MOODS, MOTION_CATALOG, motionForEvent } from "./character-motion-catalog.js";

const VERTEX_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_grid;
uniform float u_time;
uniform float u_motion_mix;
uniform vec2 u_resolution;
uniform vec4 u_motion_a;
uniform vec4 u_motion_b;
uniform vec4 u_motion_c;
uniform vec4 u_mood_a;
uniform vec4 u_mood_b;
out vec4 v_color;

float hash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }

void main() {
  float id = float(gl_VertexID);
  float gx = mod(id, u_grid);
  float gy = floor(id / u_grid);
  vec2 uv = (vec2(gx, gy) + 0.5) / u_grid;
  vec4 texel = texture(u_texture, uv);
  float amplitude = u_motion_a.x;
  float speed = u_motion_a.y;
  float frequency = u_motion_a.z;
  float scatter = u_motion_a.w;
  float scan = u_motion_b.x;
  float orbit = u_motion_b.y;
  float glitch = u_motion_b.z;
  float jaw = u_motion_b.w;
  float tilt = u_motion_c.x;
  float pulse = u_motion_c.y;
  float seed = u_motion_c.z;
  float action = u_motion_c.w;
  float eye_left = exp(-distance(uv, vec2(0.36, 0.47)) * 25.0);
  float eye_right = exp(-distance(uv, vec2(0.64, 0.47)) * 25.0);
  float eyes = max(eye_left, eye_right);
  float jaw_region = smoothstep(0.62, 0.94, uv.y);
  float crown = 1.0 - smoothstep(0.12, 0.43, uv.y);
  float edge = smoothstep(0.28, 0.5, abs(uv.x - 0.5));
  float wave = sin(uv.y * frequency + u_time * speed * 3.0 + seed * 9.0);
  float cross_wave = cos(uv.x * (frequency * 0.73) - u_time * speed * 2.1);
  float scan_line = exp(-abs(fract(uv.y * 1.13 + u_time * speed * 0.18) - 0.5) * 34.0);
  float random_x = hash(id + floor(u_time * speed * 7.0) + seed * 100.0) - 0.5;
  float random_y = hash(id * 1.93 + floor(u_time * speed * 5.0) + seed * 170.0) - 0.5;
  float glitch_gate = step(0.79, hash(floor(uv.y * 32.0) + floor(u_time * speed * 5.0) + seed));
  vec2 position = (uv - 0.5) * 2.0;
  position.y *= -1.0;
  position.x += tilt * (uv.y - 0.5);
  position += vec2(wave, cross_wave) * amplitude * 0.034;
  position += vec2(random_x, random_y) * scatter * (0.038 + edge * 0.13);
  position.x += glitch_gate * glitch * random_x * 0.21;
  position.x += scan_line * scan * 0.052 * sin(u_time * 8.0 + uv.y * 19.0);
  position.y -= jaw_region * jaw * (0.036 + 0.018 * sin(u_time * 7.0));
  float orbit_angle = u_time * speed * 0.7 + seed * 6.283 + id * 0.001;
  position += vec2(cos(orbit_angle), sin(orbit_angle)) * orbit * edge * 0.052;
  position += vec2(0.0, crown * sin(u_time * speed * 2.0 + uv.x * 8.0)) * amplitude * 0.03;
  float action_region = mod(action, 5.0);
  float region_crown = 1.0 - step(0.5, abs(action_region - 0.0));
  float region_eyes = 1.0 - step(0.5, abs(action_region - 1.0));
  float region_jaw = 1.0 - step(0.5, abs(action_region - 2.0));
  float region_edge = 1.0 - step(0.5, abs(action_region - 3.0));
  float region_core = 1.0 - step(0.5, abs(action_region - 4.0));
  float core = 1.0 - smoothstep(0.08, 0.42, distance(uv, vec2(0.5)));
  float action_mask = region_crown * crown + region_eyes * eyes +
    region_jaw * jaw_region + region_edge * edge + region_core * core;
  float action_signature = sin(
    u_time * (1.2 + mod(action, 7.0) * 0.31) +
    uv.x * (4.0 + mod(action, 9.0)) +
    uv.y * (3.0 + mod(action, 11.0))
  );
  position += vec2(
    action_signature,
    cos(action_signature * 2.1 + action * 0.37)
  ) * action_mask * amplitude * 0.025;
  float focus = u_mood_a.x;
  float energy = u_mood_a.y;
  float eye = u_mood_a.z;
  float mouth = u_mood_a.w;
  float stability = u_mood_b.x;
  vec3 tint = u_mood_b.yzw;
  position.x *= 1.0 - focus * 0.012;
  position.y -= eyes * eye * 0.014;
  position.y -= jaw_region * mouth * 0.018;
  position += vec2(random_x, random_y) * (1.0 - stability) * 0.06;
  float breathing = 1.0 + sin(u_time * (0.7 + energy)) * (0.005 + energy * 0.006);
  position *= breathing;
  position *= vec2(0.9, 0.94);
  gl_Position = vec4(position, 0.0, 1.0);
  float sensor = eyes * (0.32 + eye * 0.7) * (0.78 + 0.22 * sin(u_time * (3.0 + energy * 3.0)));
  vec3 base = mix(texel.rgb, tint, 0.12 + sensor * 0.52);
  base += tint * sensor * (0.28 + pulse * 0.34);
  float clean_alpha = smoothstep(0.16, 0.58, texel.a);
  float alpha = clean_alpha * u_motion_mix;
  v_color = vec4(base, alpha);
  float pixel_size = u_resolution.x / u_grid;
  gl_PointSize = max(1.0, pixel_size * (0.86 + pulse * 0.26));
  if (alpha < 0.01) gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 out_color;
void main() {
  vec2 cell = abs(gl_PointCoord - 0.5);
  float square = 1.0 - step(0.49, max(cell.x, cell.y));
  out_color = vec4(v_color.rgb, v_color.a * square);
}`;

const SOURCE_URL = new URL("../../../assets/character/operator-skull-anchor-v2.png", import.meta.url).href;

export class PixelCharacterRenderer {
  #canvas;
  #fallback;
  #gl;
  #program;
  #texture;
  #frame = null;
  #startedAt = performance.now();
  #motion = MOTION_CATALOG["idle.observe.sustain"];
  #mood = MOODS[DEFAULT_MOOD];
  #motionMix = 0;
  #speechEnergy = 0;
  #reduceMotion;

  constructor({ canvas, fallback }) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("PixelCharacterRenderer requires a canvas.");
    this.#canvas = canvas;
    this.#fallback = fallback;
    this.#reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  async start() {
    const image = await loadImage(SOURCE_URL);
    const gl = this.#canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    if (!gl) {
      this.#showFallback(image);
      return false;
    }
    this.#gl = gl;
    this.#program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.#texture = createTexture(gl, image);
    gl.useProgram(this.#program);
    gl.uniform1i(gl.getUniformLocation(this.#program, "u_texture"), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.resize();
    this.#fallback?.setAttribute("hidden", "");
    this.#canvas.removeAttribute("hidden");
    this.#frame = requestAnimationFrame((time) => this.#draw(time));
    return true;
  }

  resize() {
    if (!this.#gl) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.#canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.#canvas.clientHeight * ratio));
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }
    this.#gl.viewport(0, 0, width, height);
  }

  setMood(name) {
    if (MOODS[name]) this.#mood = MOODS[name];
  }

  setSpeechEnergy(value) {
    this.#speechEnergy += (Math.min(1, Math.max(0, Number(value) || 0)) - this.#speechEnergy) * 0.72;
  }

  play(name) {
    const motion = MOTION_CATALOG[name];
    if (!motion) return false;
    this.#motion = motion;
    this.#startedAt = performance.now();
    this.#motionMix = 0;
    return true;
  }

  handleEvent(event) {
    const motion = motionForEvent(event);
    if (motion) this.play(motion);
    const moods = {
      approval_requested: "guarded",
      turn_failed: "concerned",
      turn_completed: "satisfied",
      completed: "satisfied",
      interruption_requested: "vigilant",
      turn_started: "focused",
    };
    if (moods[event?.type]) this.setMood(moods[event.type]);
  }

  handleActivity(event) {
    const mapping = {
      idle: ["deadpan", "idle.observe.sustain"],
      starting: ["vigilant", "listen.capture.engage"],
      stopping: ["recovery", "interrupt.break.resolve"],
      thinking: ["analytical", "thought.reason.deep"],
      executing: ["focused", "terminal.execute.sustain"],
      waiting_approval: ["guarded", "approval.guard.sustain"],
      listening: ["vigilant", "listen.capture.sustain"],
      speaking: ["deadpan", "speech.output.sustain"],
      error: ["concerned", "failure.error.sustain"],
    };
    const next = mapping[event?.uiState];
    if (next) {
      this.setMood(next[0]);
      this.play(next[1]);
    }
  }

  destroy() {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    if (this.#gl && this.#texture) this.#gl.deleteTexture(this.#texture);
    if (this.#gl && this.#program) this.#gl.deleteProgram(this.#program);
  }

  #showFallback(image) {
    if (this.#fallback) {
      this.#fallback.src = createCleanFallbackSource(image);
      this.#fallback.removeAttribute("hidden");
    }
    this.#canvas.setAttribute("hidden", "");
  }

  #draw(now) {
    const gl = this.#gl;
    if (!gl) return;
    this.resize();
    const elapsed = (now - this.#startedAt) / 1000;
    this.#motionMix += (1 - this.#motionMix) * 0.09;
    const motionScale = this.#reduceMotion ? 0.18 : 1;
    const m = this.#motion;
    const mood = this.#mood;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.#program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    uniform1(gl, this.#program, "u_grid", 112);
    uniform1(gl, this.#program, "u_time", elapsed);
    uniform1(gl, this.#program, "u_motion_mix", this.#motionMix);
    uniform2(gl, this.#program, "u_resolution", this.#canvas.width, this.#canvas.height);
    uniform4(gl, this.#program, "u_motion_a", m.amplitude * motionScale, m.speed, m.frequency, m.scatter * motionScale);
    uniform4(
      gl,
      this.#program,
      "u_motion_b",
      m.scan * motionScale,
      m.orbit * motionScale,
      m.glitch * motionScale,
      Math.max(m.jaw, this.#speechEnergy * 0.92) * motionScale,
    );
    uniform4(
      gl,
      this.#program,
      "u_motion_c",
      m.tilt,
      Math.max(m.pulse, this.#speechEnergy * 0.7),
      m.seed,
      m.actionIndex,
    );
    uniform4(gl, this.#program, "u_mood_a", mood.focus, mood.energy, mood.eye, mood.jaw);
    uniform4(gl, this.#program, "u_mood_b", mood.stability, mood.tint[0], mood.tint[1], mood.tint[2]);
    gl.drawArrays(gl.POINTS, 0, 112 * 112);
    this.#frame = requestAnimationFrame((time) => this.#draw(time));
  }
}

function createCleanFallbackSource(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return image.src;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < pixels.data.length; index += 4) {
    pixels.data[index] = remapAlphaByte(pixels.data[index]);
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

export function remapAlphaByte(value) {
  const normalized = Math.min(255, Math.max(0, Number(value) || 0)) / 255;
  const start = 0.16;
  const end = 0.58;
  const position = Math.min(1, Math.max(0, (normalized - start) / (end - start)));
  const smooth = position * position * (3 - 2 * position);
  return Math.round(smooth * 255);
}

async function loadImage(source) {
  const image = new Image();
  image.decoding = "async";
  image.src = source;
  await image.decode();
  return image;
}

function createTexture(gl, image) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  return texture;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error("Character shader link failed: " + log);
  }
  return program;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error("Character shader compilation failed: " + log);
  }
  return shader;
}

function uniform1(gl, program, name, value) { gl.uniform1f(gl.getUniformLocation(program, name), value); }
function uniform2(gl, program, name, a, b) { gl.uniform2f(gl.getUniformLocation(program, name), a, b); }
function uniform4(gl, program, name, a, b, c, d) { gl.uniform4f(gl.getUniformLocation(program, name), a, b, c, d); }
