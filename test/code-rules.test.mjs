import assert from "node:assert/strict";
import { test } from "node:test";
import { failedIds, findingsFor, variant } from "./helpers.mjs";

const CARD = "PricingCard.tsx";

test("named-exports fails a default function, a default expression and an as-default export", () => {
  const forms = [
    (t) => t.replace("export function PricingCard", "export default function PricingCard"),
    (t) => t + "\nexport default PricingCard;\n",
    (t) => t + "\nexport { PricingCard as default };\n",
  ];
  for (const edit of forms) assert.deepEqual(failedIds(variant(CARD, edit)), ["named-exports"]);
});

test("named-exports ignores the words inside a comment or a string", () => {
  const files = variant(CARD, (t) => t + "\n// export default is not allowed\nconst note = 'export default';\nexport const Note = note;\n");
  assert.deepEqual(failedIds(files), []);
});

test("no-any fails the type, as-any and a generic any, with the line", () => {
  const forms = [
    (t) => t.replace("useState<Billing>", "useState<any>"),
    (t) => t.replace("const plan = plans[billing];", "const plan = plans[billing] as any;"),
    (t) => t.replace("type Billing", "type Loose = Record<string, any>;\ntype Billing"),
  ];
  for (const edit of forms) {
    const files = variant(CARD, edit);
    assert.deepEqual(failedIds(files), ["no-any"]);
    assert.ok(findingsFor(files, "no-any")[0].line > 0);
  }
});

test("no-any ignores the word any in text, a string and a comment", () => {
  const files = variant(CARD, (t) =>
    t
      .replace("{plan.name}</h2>", "{plan.name}</h2>\n      <p>Note: any plan can be cancelled.</p>")
      .replace("type Billing", "// any value\nconst label = 'any';\ntype Billing"),
  );
  assert.deepEqual(failedIds(files), []);
});

test("one-component-per-file fails a second component and names both", () => {
  const files = variant(CARD, (t) => t + "\nexport function Badge() {\n  return <span>New</span>;\n}\n");
  assert.deepEqual(failedIds(files), ["one-component-per-file"]);
  assert.match(findingsFor(files, "one-component-per-file")[0].message, /PricingCard, Badge/);
});

test("one-component-per-file counts arrow components and wrapped components", () => {
  const arrow = variant(CARD, (t) => t + "\nexport const Badge = () => <span>New</span>;\n");
  const wrapped = variant(CARD, (t) => t + "\nexport const Badge = React.memo(() => <span>New</span>);\n");
  assert.deepEqual(failedIds(arrow), ["one-component-per-file"]);
  assert.deepEqual(failedIds(wrapped), ["one-component-per-file"]);
});

test("one-component-per-file ignores helpers that return no JSX and types", () => {
  const files = variant(CARD, (t) => t + "\nexport function Formatter(n: number) {\n  return String(n);\n}\nexport type Props = { a: string };\nconst Style = { color: 'red' };\n");
  assert.deepEqual(failedIds(files), []);
});

test("react-in-scope fails a hook that is not imported", () => {
  const files = variant(CARD, (t) => t.replace("import React, { useState } from 'react';", "import React from 'react';"));
  assert.deepEqual(failedIds(files), ["react-in-scope"]);
  assert.match(findingsFor(files, "react-in-scope")[0].message, /useState/);
});

test("react-in-scope fails React.memo when React is not imported, and passes when it is", () => {
  const without = variant(CARD, (t) => t.replace("import React, { useState }", "import { useState }") + "\nexport const Memoized = React.memo(PricingCard);\n");
  const withReact = variant(CARD, (t) => t + "\nexport const Memoized = React.memo(PricingCard);\n");
  assert.deepEqual(failedIds(without), ["react-in-scope"]);
  assert.deepEqual(failedIds(withReact), []);
});

test("react-in-scope accepts a hook imported under a namespace and a type-only React reference", () => {
  const files = variant(CARD, (t) =>
    t.replace("import React, { useState } from 'react';", "import * as React from 'react';\nimport { useState } from 'react';") + "\nexport type Kids = React.ReactNode;\n",
  );
  assert.deepEqual(failedIds(files), []);
});

test("runtime-stripped fails fetch, axios, an env read, import.meta.env and a Next.js module", () => {
  const forms = [
    (t) => t.replace("const plan = plans[billing];", "const plan = plans[billing];\n  fetch('/api/plans');"),
    (t) => t.replace("const plan = plans[billing];", "const plan = plans[billing];\n  window.fetch('/api/plans');"),
    (t) => t.replace("const plan = plans[billing];", "const plan = plans[billing];\n  axios.get('/api/plans');"),
    (t) => t.replace("const plan = plans[billing];", "const plan = plans[billing];\n  axios('/api/plans');"),
    (t) => t.replace("const plan = plans[billing];", "const plan = plans[billing];\n  const key = process.env.API_KEY;\n  void key;"),
    (t) => t.replace("const plan = plans[billing];", "const plan = plans[billing];\n  const key = import.meta.env.VITE_KEY;\n  void key;"),
    (t) => "'use server';\n" + t,
  ];
  for (const edit of forms) assert.deepEqual(failedIds(variant(CARD, edit)), ["runtime-stripped"]);
  const next = variant(CARD, (t) => t.replace("import { plans }", "import Image from 'next/image';\nimport { plans }"));
  assert.ok(failedIds(next).includes("runtime-stripped"));
});

test("runtime-stripped ignores a method named fetch and a local env object", () => {
  const files = variant(CARD, (t) => t.replace("const plan = plans[billing];", "const store = { fetch: () => 1, env: 2 };\n  const plan = plans[billing];\n  void store.fetch();\n  void store.env;"));
  assert.deepEqual(failedIds(files), []);
});

test("absolute-image-urls fails an app-relative and a relative src", () => {
  for (const bad of ["/images/logo.png", "./logo.png", "images/logo.png"]) {
    const files = variant(CARD, (t) => t.replace("https://example.com/assets/logo.png", bad));
    assert.deepEqual(failedIds(files), ["absolute-image-urls"], bad);
  }
});

test("absolute-image-urls accepts https, protocol-relative, data and expression sources", () => {
  for (const ok of ['src="//cdn.example.com/x.png"', 'src="data:image/png;base64,AAAA"', "src={logoUrl}"]) {
    const files = variant(CARD, (t) => t.replace('src="https://example.com/assets/logo.png"', ok).replace("export function", "const logoUrl = 'https://example.com/a.png';\nexport function"));
    assert.deepEqual(failedIds(files), [], ok);
  }
});
