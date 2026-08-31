"use strict";

import { MOTION_NAMES } from "./renderer/character-motion-catalog.js";

export const MOTION_SHOWCASE_INTERVAL_MS = 850;

export const MOTION_SHOWCASE_FRAMES = Object.freeze(
  MOTION_NAMES.map((name, index) =>
    Object.freeze({
      type: "state",
      name,
      index,
      total: MOTION_NAMES.length,
    }),
  ),
);
