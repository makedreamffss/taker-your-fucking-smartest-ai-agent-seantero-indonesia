import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { JsonlLogger } from "../src/infra/jsonl-logger.js";

test("JSONL logger writes event metadata inside the project", async () => {
  const projectRoot = process.cwd();
  const fixtureRoot = await mkdtemp(path.join(projectRoot, ".test-tmp-"));
  const relativeFixture = path.relative(projectRoot, fixtureRoot);
  assert.ok(
    relativeFixture &&
      relativeFixture !== ".." &&
      !relativeFixture.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeFixture),
    "temporary logger directory must remain inside the project",
  );

  try {
    const logPath = path.join(fixtureRoot, "logs", "events.jsonl");
    const logger = new JsonlLogger({ filePath: logPath });
    await logger.log("info", "test_event", { tool: "example", ok: true });

    const record = JSON.parse((await readFile(logPath, "utf8")).trim());
    assert.equal(record.level, "info");
    assert.equal(record.event, "test_event");
    assert.equal(record.tool, "example");
    assert.equal(record.ok, true);
    assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
