import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export class JsonlLogger {
  #tail = Promise.resolve();

  constructor({ filePath, onError = () => {} }) {
    this.filePath = filePath;
    this.onError = onError;
  }

  log(level, event, fields = {}) {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    };

    this.#tail = this.#tail
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
      })
      .catch((error) => {
        this.onError(error);
      });
    return this.#tail;
  }
}

export class NullLogger {
  async log() {}
}
