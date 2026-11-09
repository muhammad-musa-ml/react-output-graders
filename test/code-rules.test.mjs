import assert from "node:assert/strict";
import { test } from "node:test";
import { failedIds, findingsFor, variant } from "./helpers.mjs";

const CARD = "PricingCard.tsx";

test("named-exports fails a default function, a default expression and an as-default export", () => {
  // Making PricingCard default-only also breaks App's named import of it, so that form fails two rules.
  const forms = [
    [(t) => t.replace("export function PricingCard", "export default function PricingCard"), ["imports-resolve", "named-exports"]],
    [(t) => t + "\nexport default PricingCard;\n", ["named-exports"]],
    [(t) => t + "\nexport { PricingCard as default };\n", ["named-exports"]],
  ];
  for (const [edit, expected] of forms) assert.deepEqual(failedIds(variant(CARD, edit)).sort(), expected);
});

test("named-exports does not count export = as a default export", () => {
  assert.deepEqual(failedIds(variant(CARD, (t) => t + "\nexport = PricingCard;\n")), []);
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

test("one-component-per-file counts a component nested in another, a class, and an as-wrapped arrow", () => {
  const nested = variant(CARD, (t) => t.replace("  const plan = plans[billing];", "  const Feature = ({ label }: { label: string }) => <li>{label}</li>;\n  void Feature;\n  const plan = plans[billing];"));
  const klass = variant(CARD, (t) => t + "\nexport class Legacy extends React.Component {\n  render() {\n    return <div />;\n  }\n}\n");
  const asWrapped = variant(CARD, (t) => t + "\nexport const Badge = (() => <span>New</span>) as React.FC;\n");
  for (const files of [nested, klass, asWrapped]) assert.deepEqual(failedIds(files), ["one-component-per-file"]);
});

test("one-component-per-file does not count a capitalised value that merely holds JSX or a hook result", () => {
  const files = variant(CARD, (t) => t.replace("  const plan = plans[billing];", "  const Hero = <h1>Hi</h1>;\n  const Memoised = useMemo(() => <b>x</b>, []);\n  void Hero;\n  void Memoised;\n  const plan = plans[billing];").replace("{ useState }", "{ useState, useMemo }"));
  assert.deepEqual(failedIds(files), []);
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

test("react-in-scope accepts hooks taken from React by destructuring", () => {
  const files = variant(CARD, (t) => t.replace("import React, { useState } from 'react';", "import React from 'react';\nconst { useState } = React;"));
  assert.deepEqual(failedIds(files), []);
});

test("react-in-scope accepts a hook imported under a namespace", () => {
  const files = variant(CARD, (t) => t.replace("import React, { useState } from 'react';", "import * as React from 'react';\nimport { useState } from 'react';") + "\nexport const Memoized = React.memo(PricingCard);\n");
  assert.deepEqual(failedIds(files), []);
});

test("react-in-scope accepts a type-only React reference when React itself is not imported", () => {
  const files = variant(CARD, (t) => t.replace("import React, { useState } from 'react';", "import { useState } from 'react';") + "\nexport type Kids = React.ReactNode;\n");
  assert.deepEqual(failedIds(files), []);
});

test("react-in-scope fails a capitalised JSX tag that is never imported or declared, and names it", () => {
  const files = variant(CARD, (t) => t.replace("<CheckIcon", "<TickIcon"));
  assert.deepEqual(failedIds(files), ["react-in-scope"]);
  assert.match(findingsFor(files, "react-in-scope")[0].message, /<TickIcon> is used but TickIcon is neither imported nor declared/);
});

test("react-in-scope checks the root of a dotted tag, whatever its case", () => {
  const dotted = variant(CARD, (t) => t.replace("<ul className", "<Ui.Card>x</Ui.Card>\n      <ul className"));
  assert.deepEqual(failedIds(dotted), ["react-in-scope"]);
  assert.match(findingsFor(dotted, "react-in-scope")[0].message, /Ui is neither imported nor declared/);
  const lower = variant(CARD, (t) => t.replace("<ul className", "<motion.div />\n      <ul className"));
  assert.deepEqual(failedIds(lower), ["react-in-scope"]);
  const imported = variant(CARD, (t) => t.replace("<ul className", "<motion.div />\n      <ul className").replace("import { plans }", "import { motion } from 'framer-motion';\nimport { plans }"));
  assert.deepEqual(failedIds(imported), []);
});

test("react-in-scope accepts a tag bound by a variable or a parameter, and plain lower-case tags", () => {
  const variable = variant(CARD, (t) => t.replace("<ul className", "<Tag>x</Tag>\n      <ul className").replace("  const plan = plans[billing];", "  const Tag = 'h3';\n  const plan = plans[billing];"));
  assert.deepEqual(failedIds(variable), []);
  const param = variant(CARD, (t) => t + "\nexport const drawIcon = (Icon: typeof CheckIcon) => <Icon />;\n");
  assert.deepEqual(failedIds(param), []);
  const intrinsic = variant(CARD, (t) => t.replace("<ul className", "<video controls />\n      <ul className"));
  assert.deepEqual(failedIds(intrinsic), []);
});

test("react-in-scope accepts a tag bound by a function, a class, an enum, a namespace or an import =", () => {
  const forms = [
    ["function Wrap() {\n  return null;\n}", "<Wrap />"],
    ["class Holder {}", "<Holder />"],
    ["enum Kind {\n  A,\n}", "<Kind.A />"],
    ["namespace Ui {\n  export const Card = 'div';\n}", "<Ui.Card />"],
  ];
  for (const [declaration, tag] of forms) {
    const files = variant(CARD, (t) => t.replace("<ul className", `${tag}\n      <ul className`) + `\n${declaration}\n`);
    assert.deepEqual(failedIds(files), [], tag);
  }
  const equals = variant(CARD, (t) => t.replace("import React, { useState } from 'react';", "import React = require('react');\nimport { useState } from 'react';").replace("<ul className", "<React.Fragment />\n      <ul className"));
  assert.deepEqual(failedIds(equals), []);
});

test("react-in-scope accepts a tag bound by the name of a function expression or a class expression", () => {
  const fn = variant(CARD, (t) => t + "\nexport const tree = function Node2(): JSX.Element {\n  return <Node2 />;\n};\n");
  assert.deepEqual(failedIds(fn), []);
  const cls = variant(CARD, (t) => t + "\nexport const holder = class Holder2 {\n  make() {\n    return <Holder2 />;\n  }\n};\n");
  assert.deepEqual(failedIds(cls), []);
});

test("react-in-scope follows TypeScript on which tags are HTML: lower-case or hyphenated names are, _Foo is not", () => {
  const underscore = variant(CARD, (t) => t.replace("<ul className", "<_Foo />\n      <ul className"));
  assert.deepEqual(failedIds(underscore), ["react-in-scope"]);
  assert.match(findingsFor(underscore, "react-in-scope")[0].message, /_Foo/);
  const html = variant(CARD, (t) => t.replace("<ul className", "<my-element />\n      <ul className"));
  assert.deepEqual(failedIds(html), []);
  const hyphenated = variant(CARD, (t) => t.replace("<ul className", "<Foo-bar />\n      <ul className"));
  assert.deepEqual(failedIds(hyphenated), [], "a hyphenated name is an HTML element even when it starts with a capital");
});

test("react-in-scope skips a tag whose root is not a name, such as <this.Tag />", () => {
  const files = variant(CARD, (t) => t + "\nexport class Holder {\n  Tag = 'div';\n  build() {\n    return <this.Tag />;\n  }\n}\n");
  assert.deepEqual(failedIds(files), []);
});

test("react-in-scope finds the root of a dotted tag three names deep", () => {
  const files = variant(CARD, (t) => t.replace("<ul className", "<Ui.Card.Body>x</Ui.Card.Body>\n      <ul className"));
  assert.deepEqual(failedIds(files), ["react-in-scope"]);
  assert.match(findingsFor(files, "react-in-scope")[0].message, /<Ui\.Card\.Body> is used but Ui is neither imported nor declared/);
});

test("react-in-scope fails <React.Fragment> when React is not imported", () => {
  const files = variant(CARD, (t) => t.replace("import React, { useState }", "import { useState }").replace("<ul className", "<React.Fragment />\n      <ul className"));
  assert.deepEqual(failedIds(files), ["react-in-scope"]);
});

test("react-in-scope fails ReactDOM.* with no ReactDOM binding, and passes with the import", () => {
  const without = variant(CARD, (t) => t + "\nReactDOM.render(<PricingCard />, document.body);\n");
  assert.deepEqual(failedIds(without), ["react-in-scope"]);
  assert.match(findingsFor(without, "react-in-scope")[0].message, /ReactDOM/);
  const withImport = variant(CARD, (t) => "import ReactDOM from 'react-dom';\n" + t + "\nReactDOM.render(<PricingCard />, document.body);\n");
  assert.deepEqual(failedIds(withImport), []);
});

test("react-in-scope reports each missing name once per file", () => {
  const files = variant(CARD, (t) => t.replace("<ul className", "<Ui.Card>x</Ui.Card>\n      <Ui.Card>y</Ui.Card>\n      <ul className"));
  assert.equal(findingsFor(files, "react-in-scope").length, 1);
});

test("one-component-per-file does not count a helper that only hands JSX to another function", () => {
  const files = variant(CARD, (t) => t + "\nexport function Notify(message: string) {\n  toast.custom(<span>{message}</span>);\n}\n");
  assert.deepEqual(failedIds(files), []);
});

test("one-component-per-file reads only a function's own return statements, not those of a function nested in it", () => {
  const files = variant(CARD, (t) => t + "\nexport function Pick() {\n  const make = () => {\n    return <span>x</span>;\n  };\n  return make;\n}\n");
  assert.deepEqual(failedIds(files), []);
});

test("one-component-per-file counts a component that returns JSX in a branch, a logical expression or an early return", () => {
  const forms = [
    "\nexport const Badge = ({ on }: { on: boolean }) => (on ? <span>New</span> : null);\n",
    "\nexport const Badge = ({ on }: { on: boolean }) => (on ? null : <span>New</span>);\n",
    "\nexport const Badge = ({ on }: { on: boolean }) => on && <span>New</span>;\n",
    "\nexport const Badge = ({ text }: { text?: string }) => text || <span>None</span>;\n",
    "\nexport const Badge = ({ text }: { text?: string }) => text ?? <span>None</span>;\n",
    "\nexport function Badge({ on }: { on: boolean }) {\n  if (!on) {\n    return null;\n  }\n  return <span>New</span>;\n}\n",
  ];
  for (const form of forms) assert.deepEqual(failedIds(variant(CARD, (t) => t + form)), ["one-component-per-file"], form);
});

test("one-component-per-file counts a function whose returned value holds the JSX", () => {
  const forms = [
    "\nexport function Badge() {\n  const el = <span>x</span>;\n  return el;\n}\n",
    "\nexport function Badge({ xs }: { xs: string[] }) {\n  return xs.map((x) => <li key={x}>{x}</li>);\n}\n",
    "\nexport const Badge = () => [<b key=\"a\" />, <i key=\"b\" />];\n",
    "\nexport function Badge({ on }: { on: boolean }) {\n  return (on && <b />) || null;\n}\n",
    "\nexport function Badge() {\n  return createPortal(<div />, document.body);\n}\n",
    "\nexport function Gate({ on }: { on: boolean }) {\n  if (!on) {\n    return;\n  }\n  return <b />;\n}\n",
    "\nexport function Frag() {\n  return <>text</>;\n}\n",
    "\nexport function Badge({ on }: { on: boolean }) {\n  const el = on ? <b /> : null;\n  return el;\n}\n",
    "\nexport function Badge({ on }: { on: boolean }) {\n  const el = on ? null : <b />;\n  return el;\n}\n",
    "\nexport function Badge({ on }: { on: boolean }) {\n  const el = on && <b />;\n  return el;\n}\n",
    "\nexport function Badge({ text }: { text?: string }) {\n  const el = text || <b />;\n  return el;\n}\n",
    "\nexport function Badge({ text }: { text?: string }) {\n  const el = text ?? <b />;\n  return el;\n}\n",
    "\nexport function Foo_Bar() {\n  return <b />;\n}\n",
    "\nexport function Tag$() {\n  return <b />;\n}\n",
  ];
  for (const form of forms) assert.deepEqual(failedIds(variant(CARD, (t) => t + form)), ["one-component-per-file"], form);
});

test("one-component-per-file does not count a function that returns a function or a value built without JSX", () => {
  const forms = [
    "\nexport function Pick2() {\n  const handler = () => <span />;\n  return handler;\n}\n",
    "\nexport function Count() {\n  const total = 1 + 1;\n  return total;\n}\n",
    "\nexport function Pass({ children }: { children: JSX.Element }) {\n  return children;\n}\n",
  ];
  for (const form of forms) assert.deepEqual(failedIds(variant(CARD, (t) => t + form)), [], form);
});

test("one-component-per-file counts an unnamed default export, and names it", () => {
  const files = variant(CARD, (t) => t + "\nexport default function () {\n  return <div />;\n}\n");
  assert.deepEqual(failedIds(files), ["named-exports", "one-component-per-file"]);
  assert.match(findingsFor(files, "one-component-per-file")[0].message, /PricingCard, \(default export\)/);
});

test("one-component-per-file counts a class expression and a render arrow property", () => {
  const forms = [
    "\nexport const Legacy = class extends React.Component {\n  render() {\n    return <div />;\n  }\n};\n",
    "\nexport class Legacy {\n  render = () => <div />;\n}\n",
    "\nexport class Legacy {\n  render = (() => <div />) as () => JSX.Element;\n}\n",
  ];
  for (const form of forms) assert.deepEqual(failedIds(variant(CARD, (t) => t + form)), ["one-component-per-file"], form);
  const notRender = variant(CARD, (t) => t + "\nexport class Store {\n  build = () => <div />;\n  render = 5;\n}\n");
  assert.deepEqual(failedIds(notRender), []);
});

test("one-component-per-file reads a class with a constructor and a render property that has no initializer", () => {
  const files = variant(CARD, (t) => t + "\nexport class Store {\n  render?: () => JSX.Element;\n  constructor() {\n    this.render = undefined;\n  }\n}\n");
  assert.deepEqual(failedIds(files), []);
});

test("one-component-per-file sees through satisfies and a non-null assertion", () => {
  const forms = ["\nexport const Badge = (() => <span>x</span>) satisfies React.FC;\n", "\nexport const Badge = React.memo(() => <span>x</span>)!;\n"];
  for (const form of forms) assert.deepEqual(failedIds(variant(CARD, (t) => t + form)), ["one-component-per-file"], form);
});

test("a file can destructure an array with holes", () => {
  assert.deepEqual(failedIds(variant(CARD, (t) => t + "\nconst [, second] = [1, 2];\nvoid second;\n")), []);
});

test("one-component-per-file counts memo and forwardRef called by their bare names", () => {
  const forms = [
    "\nexport const Badge = memo(() => <span>x</span>);\n",
    "\nexport const Badge = forwardRef<HTMLSpanElement>((props, ref) => <span ref={ref}>x</span>);\n",
  ];
  for (const form of forms) {
    const files = variant(CARD, (t) => t.replace("{ useState }", "{ useState, memo, forwardRef }") + form);
    assert.deepEqual(failedIds(files), ["one-component-per-file"], form);
  }
});

test("one-component-per-file does not count an overload signature that has no body", () => {
  const files = variant(CARD, (t) => t + "\nexport function Badge(a: string): JSX.Element;\nexport function Badge(a: number): JSX.Element;\nexport function Badge(a: unknown) {\n  return <span>{String(a)}</span>;\n}\n");
  assert.deepEqual(failedIds(files), ["one-component-per-file"]);
  assert.match(findingsFor(files, "one-component-per-file")[0].message, /^2 components in one file: PricingCard, Badge$/);
});

test("one-component-per-file counts a memo around a forwardRef", () => {
  const files = variant(CARD, (t) => t + "\nexport const Badge = React.memo(React.forwardRef<HTMLSpanElement>((props, ref) => <span ref={ref}>x</span>));\n");
  assert.deepEqual(failedIds(files), ["one-component-per-file"]);
});

test("one-component-per-file counts a class by its render method and ignores another method that returns JSX", () => {
  const helper = variant(CARD, (t) => t + "\nexport class Legacy {\n  helper() {\n    return <b>x</b>;\n  }\n}\n");
  assert.deepEqual(failedIds(helper), []);
  const plain = variant(CARD, (t) => t + "\nexport class Store {\n  render() {\n    return 1;\n  }\n}\n");
  assert.deepEqual(failedIds(plain), []);
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

test("runtime-stripped also fails globalThis.fetch, XMLHttpRequest, an axios import and an inline use server", () => {
  const forms = [
    (t) => t.replace("const plan = plans[billing];", "const plan = plans[billing];\n  globalThis.fetch('/api/plans');"),
    (t) => t.replace("const plan = plans[billing];", "const plan = plans[billing];\n  const x = new XMLHttpRequest();\n  void x;"),
    (t) => t + "\nexport async function save() {\n  'use server';\n}\n",
    (t) => t + "\nexport const save = async () => {\n  'use server';\n};\n",
  ];
  for (const edit of forms) assert.deepEqual(failedIds(variant(CARD, edit)), ["runtime-stripped"]);
  const axiosImport = variant(CARD, (t) => t.replace("import { plans }", "import axios from 'axios';\nvoid axios;\nimport { plans }"));
  assert.ok(findingsFor(axiosImport, "runtime-stripped").some((f) => /axios import/.test(f.message)));
});

test("runtime-stripped ignores other window calls and a use server string that is not a directive", () => {
  const files = variant(CARD, (t) => t.replace("const plan = plans[billing];", "const plan = plans[billing];\n  window.scrollTo(0, 0);\n  const label = 'use server';\n  void label;"));
  assert.deepEqual(failedIds(files), []);
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

test("absolute-image-urls fails a string in braces and an img that is not self-closing", () => {
  const braces = variant(CARD, (t) => t.replace('src="https://example.com/assets/logo.png"', "src={'/images/logo.png'}"));
  assert.deepEqual(failedIds(braces), ["absolute-image-urls"]);
  const open = variant(CARD, (t) => t.replace('<h2 className="mt-4', '<img src="/x.png"></img>\n      <h2 className="mt-4'));
  assert.deepEqual(failedIds(open), ["absolute-image-urls"]);
});

test("absolute-image-urls fails a template literal with no substitution", () => {
  const files = variant(CARD, (t) => t.replace('src="https://example.com/assets/logo.png"', "src={`/images/logo.png`}"));
  assert.deepEqual(failedIds(files), ["absolute-image-urls"]);
});

test("runtime-stripped fails a Next.js module that is re-exported", () => {
  const files = variant(CARD, (t) => t + "\nexport { default as NextImage } from 'next/image';\n");
  assert.ok(findingsFor(files, "runtime-stripped").some((f) => /Next\.js module next\/image/.test(f.message)));
});

test("absolute-image-urls accepts https, protocol-relative, data and expression sources", () => {
  for (const ok of ['src="//cdn.example.com/x.png"', 'src="data:image/png;base64,AAAA"', "src={logoUrl}"]) {
    const files = variant(CARD, (t) => t.replace('src="https://example.com/assets/logo.png"', ok).replace("export function", "const logoUrl = 'https://example.com/a.png';\nexport function"));
    assert.deepEqual(failedIds(files), [], ok);
  }
});
