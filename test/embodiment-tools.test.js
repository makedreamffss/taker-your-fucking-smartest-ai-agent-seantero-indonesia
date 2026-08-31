import assert from "node:assert/strict";
import test from "node:test";

import { createEmbodimentTools } from "../src/tools/builtins/embodiment-tools.js";

test("embodiment tools expose presentation control without machine execution", async () => {
  const calls = [];
  const controller = {
    inspect: () => ({ ready: true }),
    dispatch: async (type, payload) => {
      calls.push({ type, payload });
      return { accepted: true };
    },
  };
  const tools = createEmbodimentTools({ controller });
  assert.deepEqual(
    tools.map(({ name }) => name),
    [
      "embodiment_inspect",
      "embodiment_play_action",
      "embodiment_set_mood",
      "embodiment_look_at",
      "embodiment_set_presence",
    ],
  );
  const action = tools.find(({ name }) => name === "embodiment_play_action");
  const assessment = action.assess({ action: "wave" });
  assert.equal(assessment.safeInSemiAutonomous, true);
  assert.equal(assessment.destructive, false);
  await action.execute({ action: "wave" });
  assert.deepEqual(calls, [{ type: "play_action", payload: { action: "wave" } }]);
});
