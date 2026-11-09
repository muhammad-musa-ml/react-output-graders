import assert from "node:assert/strict";
import { test } from "node:test";
import { LUCIDE_NAMES, LUCIDE_VERSION } from "../src/rules/imports.mjs";
import { failedIds, findingsFor, good, variant } from "./helpers.mjs";

const CARD = "PricingCard.tsx";
const withImport = (line) => (t) => t.replace("import { plans }", `${line}\nimport { plans }`);

test("imports-resolve fails a relative path that is not in the output, and an image import", () => {
  for (const line of ["import { Missing } from './Missing';", "import logo from './logo.png';"]) {
    const files = variant(CARD, withImport(line));
    assert.deepEqual(failedIds(files), ["imports-resolve"], line);
  }
});

test("imports-resolve fails a path alias and a node: module", () => {
  for (const line of ["import { Button } from '@/components/Button';", "import fs from 'node:fs';"]) {
    const files = variant(CARD, withImport(line));
    assert.deepEqual(failedIds(files), ["imports-resolve"], line);
    assert.match(findingsFor(files, "imports-resolve")[0].message, /does not resolve in a standalone folder/, line);
  }
});

test("imports-resolve fails a package outside the contract unless a package.json declares it", () => {
  const files = variant(CARD, withImport("import { debounce } from 'lodash';"));
  assert.deepEqual(failedIds(files), ["imports-resolve"]);
  assert.match(findingsFor(files, "imports-resolve")[0].message, /lodash/);
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    files.set("package.json", JSON.stringify({ [key]: { lodash: "^4.17.0" } }));
    assert.deepEqual(failedIds(files), [], key);
  }
});

test("imports-resolve allows framer-motion, which Magic Patterns code uses", () => {
  assert.deepEqual(failedIds(variant(CARD, withImport("import { motion } from 'framer-motion';"))), []);
});

test("imports-resolve reads require() and export-from, and skips tailwind.config.js", () => {
  assert.deepEqual(failedIds(variant(CARD, withImport("const m = require('./Missing');"))), ["imports-resolve"]);
  assert.deepEqual(failedIds(variant(CARD, (t) => t + "\nexport * from './Missing';\n")), ["imports-resolve"]);
  const config = good();
  config.set("tailwind.config.js", config.get("tailwind.config.js").replace("plugins: []", "plugins: [require('@tailwindcss/forms')]"));
  assert.deepEqual(failedIds(config), []);
});

test("imports-resolve treats a package.json that does not parse as declaring nothing", () => {
  const files = variant(CARD, withImport("import { debounce } from 'lodash';"));
  files.set("package.json", "{ not json");
  assert.deepEqual(failedIds(files), ["imports-resolve"]);
});

test("imports-resolve accepts the contract's packages, sub-paths, css and dynamic imports", () => {
  const lines = [
    "import { createRoot } from 'react-dom/client';",
    "import { toast } from 'sonner';",
    "import { LineChart } from 'recharts';",
    "import '@radix-ui/themes/styles.css';",
    "import './index.css';",
    "const lazy = () => import('./mockData');",
  ];
  for (const line of lines) assert.deepEqual(failedIds(variant(CARD, withImport(line))), [], line);
});

test("imports-resolve resolves ../ paths and an index file", () => {
  const files = good();
  files.set("components/Badge/index.tsx", "export function Badge() {\n  return <span>x</span>;\n}\n");
  files.set("components/Row.tsx", "import { Badge } from './Badge';\nexport function Row() {\n  return <Badge />;\n}\n");
  files.set(CARD, files.get(CARD).replace("import { plans }", "import { Row } from './components/Row';\nimport { plans }") + "\nvoid Row;\n");
  assert.deepEqual(failedIds(files), []);
  files.set("components/Row.tsx", files.get("components/Row.tsx").replace("./Badge", "../Nope"));
  assert.deepEqual(failedIds(files), ["imports-resolve"]);
  files.set("components/Row.tsx", files.get("components/Row.tsx").replace("../Nope", "../mockData").replace("{ Badge }", "{ plans }").replace("<Badge />", "<span>{plans.monthly.name}</span>"));
  assert.deepEqual(failedIds(files), []);
});

// Imports one name from a module the test writes, and returns the imports-resolve findings.
function bindingFindings(moduleText, importLine, moduleName = "Other.tsx") {
  const files = good();
  files.set(moduleName, moduleText);
  files.set(CARD, files.get(CARD).replace("import { plans }", `${importLine}\nimport { plans }`));
  return findingsFor(files, "imports-resolve");
}

test("imports-resolve fails a default import of a module that has only named exports", () => {
  const files = variant("index.tsx", (t) => t.replace("import { App } from './App';", "import App from './App';"));
  assert.deepEqual(failedIds(files), ["imports-resolve"]);
  assert.match(findingsFor(files, "imports-resolve")[0].message, /"\.\/App" has no default export, but App is imported as its default/);
  assert.equal(findingsFor(files, "imports-resolve")[0].file, "index.tsx");
  assert.equal(findingsFor(files, "imports-resolve")[0].line, 3);
});

test("imports-resolve fails a named import of a name the module does not export", () => {
  const files = variant(CARD, withImport("import { Missing } from './mockData';"));
  assert.deepEqual(failedIds(files), ["imports-resolve"]);
  assert.match(findingsFor(files, "imports-resolve")[0].message, /"\.\/mockData" does not export Missing/);
  const renamed = variant(CARD, withImport("import { Missing as Other } from './mockData';"));
  assert.match(findingsFor(renamed, "imports-resolve")[0].message, /does not export Missing/, "the exported name is checked, not the local one");
  const asDefault = variant(CARD, withImport("import { default as Thing } from './mockData';"));
  assert.match(findingsFor(asDefault, "imports-resolve")[0].message, /does not export default/);
});

test("imports-resolve accepts an import of a name the module exports, a type or an interface included", () => {
  const files = variant(CARD, (t) => t.replace("import { plans } from './mockData';", "import { plans, type Plan } from './mockData';") + "\nexport const first: Plan = plans.monthly;\n");
  assert.deepEqual(failedIds(files), []);
});

test("imports-resolve reads every way a module can export a name", () => {
  const modules = [
    ["export const a = 1, b = 2;", "a"],
    ["export const a = 1, b = 2;", "b"],
    ["export const { c, d } = { c: 1, d: 2 };", "d"],
    ["const x = 1;\nexport { x as y };", "y"],
    ["export { plans as z } from './mockData';", "z"],
    ["export * as ns from './mockData';", "ns"],
    ["export function f() {}", "f"],
    ["export class C {}", "C"],
    ["export enum E { A }", "E"],
    ["export type T = string;", "T"],
    ["export interface I { a: string }", "I"],
    ["export namespace N { export const a = 1; }", "N"],
    ["export declare const g: number;", "g"],
  ];
  for (const [text, name] of modules) assert.deepEqual(bindingFindings(text, `import { ${name} } from './Other';`), [], `${name} from ${text}`);
});

test("imports-resolve does not count a name that is only local, or only the old name of a renamed export", () => {
  assert.equal(bindingFindings("const x = 1;\nexport { x as y };", "import { x } from './Other';").length, 1);
  assert.equal(bindingFindings("const hidden = 1;\nexport const shown = hidden;", "import { hidden } from './Other';").length, 1);
});

test("imports-resolve reads every way a module can export a default", () => {
  const modules = [
    "export default function Thing() {}",
    "export default class Thing {}",
    "export default 42;",
    "const t = 1;\nexport { t as default };",
    "export { plans as default } from './mockData';",
  ];
  for (const text of modules) assert.deepEqual(bindingFindings(text, "import Thing from './Other';"), [], text);
  assert.deepEqual(bindingFindings("export default 42;", "import { default as Thing } from './Other';"), []);
});

test("imports-resolve says nothing against a module whose export list is open", () => {
  assert.deepEqual(bindingFindings("export * from './mockData';", "import Anything, { nothing } from './Other';"), []);
  assert.deepEqual(bindingFindings("const T = 1;\nexport = T;", "import Anything, { nothing } from './Other';"), []);
  assert.deepEqual(bindingFindings("module.exports = { a: 1 };", "import Anything, { nothing } from './Other';", "Other.js"), []);
  assert.deepEqual(bindingFindings("exports.a = 1;", "import { nothing } from './Other';", "Other.js"), []);
});

test("imports-resolve reads export * as default as a default export", () => {
  assert.deepEqual(bindingFindings("export * as default from './mockData';", "import Thing from './Other';"), []);
});

test("imports-resolve counts any kind of ES export as proof that a file is not CommonJS", () => {
  assert.equal(bindingFindings("// exports.a = 1\nexport default 42;", "import { nothing } from './Other';").length, 1);
  assert.equal(bindingFindings("// exports.a = 1\nconst x = 1;\nexport { x };", "import { nothing } from './Other';").length, 1);
  assert.equal(bindingFindings("// exports.a = 1\nexport function f() {}", "import { nothing } from './Other';").length, 1);
});

test("imports-resolve resolves ./name.jsx to a TypeScript file", () => {
  assert.deepEqual(bindingFindings("export const a = 1;", "import { a } from './Other.jsx';"), []);
});

test("imports-resolve treats a file as CommonJS only when it has no ES export", () => {
  assert.deepEqual(bindingFindings("Object.defineProperty(exports, 'a', { value: 1 });", "import { nothing } from './Other';", "Other.js"), []);
  assert.deepEqual(bindingFindings("exports['a'] = 1;", "import { nothing } from './Other';", "Other.js"), []);
  assert.equal(bindingFindings("// old: exports.a = 1\nexport const b = 2;", "import { nothing } from './Other';").length, 1);
});

test("imports-resolve resolves ./name.js to a TypeScript file and reads import x = require()", () => {
  const ok = variant(CARD, (t) => t.replace("'./mockData'", "'./mockData.js'"));
  assert.deepEqual(failedIds(ok), []);
  assert.deepEqual(failedIds(variant(CARD, withImport("import { Missing } from './Missing.js';"))), ["imports-resolve"]);
  assert.deepEqual(failedIds(variant(CARD, withImport("import data = require('./mockData');\nvoid data;"))), []);
  assert.deepEqual(failedIds(variant(CARD, withImport("import data = require('./Missing');\nvoid data;"))), ["imports-resolve"]);
});

test("imports-resolve accepts a namespace import of a relative module, and does not export a declare", () => {
  assert.deepEqual(bindingFindings("export const a = 1;", "import * as other from './Other';\nvoid other;"), []);
  assert.equal(bindingFindings("declare const hidden: number;\nexport const shown = 1;", "import { hidden } from './Other';").length, 1);
  assert.deepEqual(bindingFindings("export const [, z] = [1, 2];", "import { z } from './Other';"), []);
});

test("imports-resolve does not treat an export default as an open export list", () => {
  assert.equal(bindingFindings("export default 42;", "import { nothing } from './Other';").length, 1);
  assert.equal(bindingFindings("export const a = 1;", "import Thing from './Other';").length, 1);
});

test("imports-resolve checks a javascript module that uses ES exports", () => {
  assert.equal(bindingFindings("export const a = 1;", "import { nothing } from './Other';", "Other.js").length, 1);
});

test("imports-resolve checks the bindings of an index file reached by its folder", () => {
  assert.deepEqual(bindingFindings("export function Badge() {}", "import { Badge } from './components/Badge';", "components/Badge/index.tsx"), []);
  assert.equal(bindingFindings("export function Other() {}", "import { Badge } from './components/Badge';", "components/Badge/index.tsx").length, 1);
});

test("imports-resolve leaves css and json imports alone and checks no binding for a side-effect import", () => {
  assert.deepEqual(bindingFindings("{ \"a\": 1 }", "import data from './Other';", "Other.json"), []);
  assert.deepEqual(bindingFindings("p { margin: 0; }", "import styles from './Other';", "Other.css"), []);
  assert.deepEqual(bindingFindings("export const a = 1;", "import './Other';"), []);
});

test("imports-resolve reports each missing binding of one import with its own line", () => {
  const found = bindingFindings("export const a = 1;", "import {\n  a,\n  b,\n  c,\n} from './Other';");
  assert.deepEqual(
    found.map((f) => [f.line, f.message]),
    [
      [5, '"./Other" does not export b'],
      [6, '"./Other" does not export c'],
    ],
  );
});

test("the next/font import fails both runtime-stripped and imports-resolve", () => {
  const files = variant(CARD, withImport("import { Inter } from 'next/font/google';"));
  assert.deepEqual(failedIds(files).sort(), ["imports-resolve", "runtime-stripped"]);
});

test("icon-names-exist fails a made-up icon and lists similar real ones", () => {
  const files = variant(CARD, (t) => t.replace("import { CheckIcon }", "import { CheckmarkIcon }").replace("<CheckIcon", "<CheckmarkIcon"));
  assert.deepEqual(failedIds(files), ["icon-names-exist"]);
  assert.match(findingsFor(files, "icon-names-exist")[0].message, /CheckmarkIcon is not exported by lucide-react/);
  assert.match(findingsFor(files, "icon-names-exist")[0].message, /similar: .*Check/);
});

test("icon-names-exist fails a default import and a made-up name on a namespace import", () => {
  const def = variant(CARD, withImport("import Lucide from 'lucide-react';"));
  assert.deepEqual(failedIds(def), ["icon-names-exist"]);
  const ns = variant(CARD, (t) => t.replace("import { CheckIcon } from 'lucide-react';", "import * as Icons from 'lucide-react';").replace("<CheckIcon", "<Icons.CheckmarkNope"));
  assert.deepEqual(failedIds(ns), ["icon-names-exist"]);
  assert.equal(findingsFor(ns, "icon-names-exist").length, 1, "a JSX tag is reported once");
  const outsideJsx = variant(CARD, (t) => t.replace("import { CheckIcon } from 'lucide-react';", "import * as Icons from 'lucide-react';\nconst Tick = Icons.CheckmarkNope;\nvoid Tick;").replace("<CheckIcon", "<Icons.Check"));
  assert.deepEqual(failedIds(outsideJsx), ["icon-names-exist"]);
  const real = variant(CARD, (t) => t.replace("import { CheckIcon } from 'lucide-react';", "import * as Icons from 'lucide-react';").replace("<CheckIcon", "<Icons.Check"));
  assert.deepEqual(failedIds(real), []);
});

test("icon-names-exist accepts renamed imports, Icon and Lucide aliases, and the types", () => {
  const files = variant(CARD, (t) => t.replace("import { CheckIcon }", "import { Check as Tick, LucideCheck, UserIcon, type LucideIcon }").replace("<CheckIcon", "<Tick") + "\nexport const Marks: LucideIcon[] = [Tick, LucideCheck, UserIcon];\n");
  assert.deepEqual(failedIds(files), []);
});

test("the name list carries the version it came from and the names an output uses", () => {
  assert.equal(LUCIDE_VERSION, "1.70.0");
  assert.ok(LUCIDE_NAMES.size > 1000);
  for (const name of ["Check", "CheckIcon", "LucideCheck", "LucideIcon", "LucideProps"]) assert.ok(LUCIDE_NAMES.has(name), name);
  assert.equal(LUCIDE_NAMES.has("CheckmarkIcon"), false);
});
