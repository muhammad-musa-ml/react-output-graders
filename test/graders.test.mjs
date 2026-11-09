import assert from "node:assert/strict";
import { test } from "node:test";
import { extractFiles } from "../src/files.mjs";
import { grade, REQUIRED_FILES } from "../src/graders.mjs";
import { failedIds, findingsFor, good, spec, variant } from "./helpers.mjs";

test("the known-good output passes every rule that ran", () => {
  const result = grade(good(), spec);
  assert.deepEqual(failedIds(good()), []);
  assert.equal(result.pass, true);
  assert.equal(result.rulesSkipped, 0);
});

test("an empty file set never passes", () => {
  const result = grade(new Map(), spec);
  assert.equal(result.pass, false);
  assert.equal(result.fileCount, 0);
});

test("required-files names each missing file", () => {
  for (const name of REQUIRED_FILES) {
    const files = good();
    files.delete(name);
    // index.tsx imports App and index.css, so deleting those also breaks an import.
    assert.ok(failedIds(files).includes("required-files"), name);
    assert.deepEqual(
      findingsFor(files, "required-files").map((f) => f.file),
      [name],
    );
  }
});

test("a shared wrapper folder does not hide the files", () => {
  const wrapped = new Map([...good()].map(([p, t]) => [`PricingCard/${p}`, t]));
  assert.deepEqual(failedIds(wrapped), []);
});

test("syntax reports the line of the error and nothing else fails", () => {
  const files = variant("PricingCard.tsx", (t) => t.replace("return (", "return (\n    <section>\n"));
  assert.deepEqual(failedIds(files), ["syntax"]);
  assert.ok(findingsFor(files, "syntax").every((f) => f.file === "PricingCard.tsx" && f.line > 0));
});

test("extractFiles reads names from a heading, an info string and a first-line comment", () => {
  const reply = [
    "Here you go.",
    "### App.tsx",
    "```tsx",
    "export function App() { return null; }",
    "```",
    "```css index.css",
    "body { margin: 0; }",
    "```",
    "```ts",
    "// mockData.ts",
    "export const rows = [];",
    "```",
    "```bash",
    "npm run dev",
    "```",
  ].join("\n");
  const { files, unnamed } = extractFiles(reply);
  assert.deepEqual([...files.keys()].sort(), ["App.tsx", "index.css", "mockData.ts"]);
  assert.equal(files.get("mockData.ts").includes("// mockData.ts"), false);
  assert.equal(unnamed, 1);
});

test("extractFiles ignores a reasoning block and keeps the last text of a repeated name", () => {
  const reply = "<think>### Fake.tsx\n```tsx\nx\n```</think>\n### A.tsx\n```tsx\none\n```\n### A.tsx\n```tsx\ntwo\n```\n";
  const { files } = extractFiles(reply);
  assert.deepEqual([...files.keys()], ["A.tsx"]);
  assert.equal(files.get("A.tsx").trim(), "two");
});
