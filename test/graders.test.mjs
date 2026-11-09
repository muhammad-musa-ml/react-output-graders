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

test("extractFiles keeps the file after one whose opening fence the model forgot", () => {
  // The shape a 4B model wrote: ### index.css with no opening fence and a closing one.
  const reply = [
    "### index.tsx",
    "```tsx",
    "import './index.css';",
    "```",
    "",
    "### index.css",
    "@import 'tailwindcss/base';",
    "body { margin: 0; }",
    "```",
    "",
    "### tailwind.config.js",
    "```js",
    "module.exports = { plugins: [] };",
    "```",
  ].join("\n");
  const { files, unnamed } = extractFiles(reply);
  assert.deepEqual([...files.keys()], ["index.tsx", "index.css", "tailwind.config.js"]);
  assert.equal(files.get("index.css"), "@import 'tailwindcss/base';\nbody { margin: 0; }\n");
  assert.equal(files.get("tailwind.config.js"), "module.exports = { plugins: [] };\n");
  assert.equal(unnamed, 0);
});

test("extractFiles drops prose between a heading and its fence, and reads a last file with no closing fence", () => {
  const reply = "### App.tsx\nHere is the entry file:\n```tsx\nexport function App() {}\n```\n### mockData.ts\n```ts\nexport const a = 1;\n";
  const { files } = extractFiles(reply);
  assert.equal(files.get("App.tsx"), "export function App() {}\n");
  assert.equal(files.get("mockData.ts"), "export const a = 1;\n");
});

test("extractFiles ignores a reasoning block and keeps the last text of a repeated name", () => {
  const reply = "<think>\n### Fake.tsx\n```tsx\nx\n```\n</think>\n### A.tsx\n```tsx\none\n```\n### A.tsx\n```tsx\ntwo\n```\n";
  const { files } = extractFiles(reply);
  assert.deepEqual([...files.keys()], ["A.tsx"]);
  assert.equal(files.get("A.tsx").trim(), "two");
});
