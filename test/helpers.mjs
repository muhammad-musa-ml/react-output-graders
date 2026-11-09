import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDir } from "../src/files.mjs";
import { grade } from "../src/graders.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const spec = JSON.parse(readFileSync(join(root, "fixtures", "good.spec.json"), "utf8"));

// A fresh copy of the known-good file set each call, so a test can edit it.
export function good() {
  return new Map(loadDir(join(root, "fixtures", "good")));
}

// The good set with one file's text replaced by edit(text).
export function variant(path, edit) {
  const files = good();
  if (!files.has(path)) throw new Error(`fixture has no ${path}`);
  const next = edit(files.get(path));
  if (next === files.get(path)) throw new Error(`edit changed nothing in ${path}`);
  files.set(path, next);
  return files;
}

export function failedIds(files, withSpec = spec) {
  return grade(files, withSpec)
    .rules.filter((r) => r.pass === false)
    .map((r) => r.id);
}

export function findingsFor(files, id, withSpec = spec) {
  return grade(files, withSpec).rules.find((r) => r.id === id).findings;
}
