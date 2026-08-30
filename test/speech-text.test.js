import assert from "node:assert/strict";
import test from "node:test";

import {
  detectSpeechLanguage,
  prepareSpeechText,
  splitSpeechSegments,
} from "../src/voice/speech-text.js";

test("speech text removes markup and code while preserving useful prose", () => {
  const result = prepareSpeechText(
    "# Done\n- Fixed **three** files.\n```js\nalert('no')\n```\nRead [the report](https://example.com).",
  );
  assert.equal(
    result,
    "Done Fixed three files. Code details are in the transcript. Read the report.",
  );
  assert.doesNotMatch(result, /alert|https?:|```/);
});

test("speech text declares when the visible transcript has more detail", () => {
  const result = prepareSpeechText("word ".repeat(300), { maxCharacters: 160 });
  assert.ok(result.length <= 160);
  assert.match(result, /remaining details are in the transcript\.$/);
});

test("speech segments are bounded without losing text", () => {
  const source = "One sentence. " + "bounded ".repeat(60) + "End.";
  const segments = splitSpeechSegments(source, { maxCharacters: 100 });
  assert.ok(segments.length > 2);
  assert.ok(segments.every((segment) => segment.length <= 100));
  assert.equal(segments.join(" ").replace(/\s+/g, " "), source.trim().replace(/\s+/g, " "));
});

test("language detection selects supported English and Indonesian codes", () => {
  assert.equal(detectSpeechLanguage("I verified the files and finished the test."), "en");
  assert.equal(detectSpeechLanguage("Saya sudah memeriksa berkas ini dan semuanya selesai."), "id");
});
