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
  const files = variant(CARD, (t) => t.replace("import { CheckIcon }", "import { Check as Tick, LucideCheck, UserIcon, type LucideIcon }") + "\nexport const Marks: LucideIcon[] = [Tick, LucideCheck, UserIcon];\n");
  assert.deepEqual(failedIds(files), []);
});

test("the name list carries the version it came from and the names an output uses", () => {
  assert.equal(LUCIDE_VERSION, "1.70.0");
  assert.ok(LUCIDE_NAMES.size > 1000);
  for (const name of ["Check", "CheckIcon", "LucideCheck", "LucideIcon", "LucideProps"]) assert.ok(LUCIDE_NAMES.has(name), name);
  assert.equal(LUCIDE_NAMES.has("CheckmarkIcon"), false);
});
