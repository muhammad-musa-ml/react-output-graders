import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (...args) => spawnSync(process.execPath, [join(root, "src", "cli.mjs"), ...args], { encoding: "utf8" });

test("the cli passes the known-good folder with its spec and counts 13 rules", () => {
  const r = run(join(root, "fixtures", "good"), "--spec", join(root, "fixtures", "good.spec.json"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS: 13 rules run, 0 skipped, 6 files/);
});

test("the cli passes without a spec but says one rule was skipped", () => {
  const r = run(join(root, "fixtures", "good"));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /PASS: 12 rules run, 1 skipped/);
  assert.match(r.stdout, /skip {2}token-coverage/);
});

test("the cli exits 1 with file and line on a failing folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "rog-"));
  try {
    writeFileSync(join(dir, "App.tsx"), "export default function App() {\n  return null;\n}\n");
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL {2}named-exports/);
    assert.match(r.stdout, /App\.tsx:1 {2}default export/);
    assert.match(r.stdout, /FAIL {2}required-files/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the cli exits 2 on a folder with no source files and never prints PASS", () => {
  const dir = mkdtempSync(join(tmpdir(), "rog-"));
  try {
    const r = run(dir);
    assert.equal(r.status, 2);
    assert.doesNotMatch(r.stdout, /PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the cli exits 2 for a folder that does not exist, not 1", () => {
  const r = run(join(root, "no-such-folder"));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not a folder/);
});

test("the cli exits 2 with no folder argument", () => {
  assert.equal(run().status, 2);
});
