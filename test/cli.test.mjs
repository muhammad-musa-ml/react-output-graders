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

test("the cli exits 2 for a spec file that does not exist, and never grades without it", () => {
  const r = run(join(root, "fixtures", "good"), "--spec", join(root, "no-such-spec.json"));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--spec needs a spec file that exists/);
  assert.doesNotMatch(r.stdout, /PASS|FAIL/);
});

test("the cli exits 2 for --spec with no value and for a spec path that is a folder", () => {
  const none = run(join(root, "fixtures", "good"), "--spec");
  assert.equal(none.status, 2);
  assert.match(none.stderr, /none given/);
  const folder = run(join(root, "fixtures", "good"), "--spec", join(root, "fixtures"));
  assert.equal(folder.status, 2);
  assert.match(folder.stderr, /--spec needs a spec file that exists/);
});

test("the cli exits 2 for a spec file that is not JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "rog-"));
  try {
    const bad = join(dir, "spec.json");
    writeFileSync(bad, "{ not json");
    const r = run(join(root, "fixtures", "good"), "--spec", bad);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /is not valid JSON/);
    assert.doesNotMatch(r.stdout, /PASS|FAIL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the cli reads --spec=path as well as --spec path, and exits 2 for a missing one", () => {
  const ok = run(join(root, "fixtures", "good"), `--spec=${join(root, "fixtures", "good.spec.json")}`);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /PASS: 13 rules run, 0 skipped/);
  const missing = run(join(root, "fixtures", "good"), `--spec=${join(root, "no-such-spec.json")}`);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--spec needs a spec file that exists/);
  const empty = run(join(root, "fixtures", "good"), "--spec=");
  assert.equal(empty.status, 2);
});

test("the cli exits 2 for a spec that lists no colors and no fonts", () => {
  const dir = mkdtempSync(join(tmpdir(), "rog-"));
  try {
    for (const [name, body] of [["wrong-key", '{"color": ["#3e63dd"]}'], ["empty-lists", '{"colors": [], "fonts": []}'], ["array", "[]"], ["null", "null"], ["number", "5"]]) {
      const file = join(dir, `${name}.json`);
      writeFileSync(file, body);
      const r = run(join(root, "fixtures", "good"), "--spec", file);
      assert.equal(r.status, 2, name);
      assert.match(r.stderr, /lists no colors and no fonts/, name);
      assert.doesNotMatch(r.stdout, /PASS|FAIL/, name);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the cli reads a spec file that starts with a byte-order mark", () => {
  const dir = mkdtempSync(join(tmpdir(), "rog-"));
  try {
    const file = join(dir, "spec.json");
    writeFileSync(file, String.fromCharCode(0xfeff) + JSON.stringify({ colors: ["#3e63dd"], fonts: ["Inter"] }));
    const r = run(join(root, "fixtures", "good"), "--spec", file);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS: 13 rules run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the cli prints the whole result as JSON with --json", () => {
  const r = run(join(root, "fixtures", "good"), "--spec", join(root, "fixtures", "good.spec.json"), "--json");
  assert.equal(r.status, 0);
  const result = JSON.parse(r.stdout);
  assert.equal(result.pass, true);
  assert.equal(result.rulesRun, 13);
  assert.equal(result.rules.length, 13);
  assert.equal(result.fileCount, 6);
  const withoutSpec = JSON.parse(run(join(root, "fixtures", "good"), "--json").stdout);
  assert.equal(withoutSpec.rulesSkipped, 1);
  assert.equal(withoutSpec.rulesRun, 12);
});
