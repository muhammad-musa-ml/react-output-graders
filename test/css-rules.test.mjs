import assert from "node:assert/strict";
import { test } from "node:test";
import { grade } from "../src/graders.mjs";
import { failedIds, findingsFor, good, spec, variant } from "./helpers.mjs";

const CSS = "index.css";
const BASE = "@import 'tailwindcss/base';\n";
const COMPONENTS = "@import 'tailwindcss/components';\n";
const UTILITIES = "@import 'tailwindcss/utilities';\n";

test("css-import-order fails each way the three imports can be misordered", () => {
  const forms = [
    (t) => t.replace(BASE + COMPONENTS, COMPONENTS + BASE),
    (t) => t.replace(COMPONENTS + UTILITIES, UTILITIES + COMPONENTS),
    (t) => t.replace(BASE + COMPONENTS + UTILITIES, UTILITIES + BASE + COMPONENTS),
  ];
  for (const edit of forms) assert.deepEqual(failedIds(variant(CSS, edit)), ["css-import-order"]);
});

test("css-import-order fails a missing import, a late font import and an early other import", () => {
  assert.deepEqual(failedIds(variant(CSS, (t) => t.replace(COMPONENTS, ""))), ["css-import-order"]);
  const lateFont = variant(CSS, (t) => {
    const [font, ...rest] = t.split("\n");
    return rest.join("\n").replace(UTILITIES, UTILITIES + font + "\n");
  });
  assert.deepEqual(failedIds(lateFont), ["css-import-order"]);
  const earlyOther = variant(CSS, (t) => t.replace(COMPONENTS, "@import './extra.css';\n" + COMPONENTS));
  const files = new Map(earlyOther);
  files.set("extra.css", "p { margin: 0; }\n");
  assert.deepEqual(failedIds(files), ["css-import-order"]);
});

test("css-import-order fails the @tailwind directive form and says why", () => {
  const files = variant(CSS, (t) => t.replace(BASE + COMPONENTS + UTILITIES, "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n"));
  assert.deepEqual(failedIds(files), ["css-import-order"]);
  assert.match(findingsFor(files, "css-import-order")[0].message, /contract writes @import/);
});

test("css-import-order accepts comments that mention the imports, a second font and a late other import", () => {
  const files = variant(CSS, (t) =>
    "/* @import 'tailwindcss/utilities'; comes last */\n" +
    t.replace(BASE, "@import url('https://fonts.googleapis.com/css2?family=Fira+Code');\n" + BASE).replace(UTILITIES, UTILITIES + "@import './extra.css';\n"),
  );
  files.set("extra.css", "p { margin: 0; }\n");
  assert.deepEqual(failedIds(files), []);
});

test("css-import-order reads a font url with semicolons, an unquoted url and a plain quoted import", () => {
  const forms = [
    "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');\n",
    "@import url(https://fonts.googleapis.com/css2?family=Inter);\n",
    '@import "https://fonts.googleapis.com/css2?family=Inter" screen;\n',
  ];
  for (const form of forms) {
    const files = variant(CSS, (t) => t.split("\n").slice(1).join("\n").replace("@import 'tailwindcss/base';", form + "@import 'tailwindcss/base';"));
    assert.deepEqual(failedIds(files, { colors: [], fonts: [] }), [], form);
    const late = variant(CSS, (t) => t.split("\n").slice(1).join("\n").replace("@import 'tailwindcss/utilities';", "@import 'tailwindcss/utilities';\n" + form));
    assert.deepEqual(failedIds(late, { colors: [], fonts: [] }), ["css-import-order"], form);
  }
});

test("css-vars-defined fails a var that nothing defines, and names the line", () => {
  const files = variant(CSS, (t) => t + "\n.card {\n  color: var(--missing);\n}\n");
  assert.deepEqual(failedIds(files), ["css-vars-defined"]);
  assert.ok(findingsFor(files, "css-vars-defined")[0].line > 0);
  const inTsx = variant("PricingCard.tsx", (t) => t.replace("text-[var(--accent)]", "text-[var(--brand)]"));
  assert.deepEqual(failedIds(inTsx), ["css-vars-defined"]);
});

test("css-vars-defined accepts a fallback, a definition in a style key, and a package stylesheet", () => {
  assert.deepEqual(failedIds(variant(CSS, (t) => t + "\n.a { color: var(--missing, #fff); }\n")), []);
  const styleKey = variant("PricingCard.tsx", (t) => t.replace("text-[var(--accent)]", "text-[var(--brand)]").replace("<section className", "<section style={{ '--brand': '#3e63dd' } as React.CSSProperties} className"));
  assert.deepEqual(failedIds(styleKey), []);
  const pkg = variant(CSS, (t) => t + "\n.a { color: var(--accent-9); }\n");
  pkg.set("App.tsx", "import '@radix-ui/themes/styles.css';\n" + pkg.get("App.tsx"));
  assert.deepEqual(failedIds(pkg), []);
});

test("css-vars-defined ignores a var() inside a css comment", () => {
  assert.deepEqual(failedIds(variant(CSS, (t) => t + "\n/* var(--nothing) */\n")), []);
});

test("token-coverage fails a color and a font the spec lists but the output lacks", () => {
  const noColor = variant(CSS, (t) => t.replaceAll("#3e63dd", "#111111"));
  noColor.set("tailwind.config.js", good().get("tailwind.config.js").replaceAll("#3e63dd", "#111111"));
  noColor.set("PricingCard.tsx", good().get("PricingCard.tsx"));
  assert.deepEqual(failedIds(noColor), ["token-coverage"]);
  const noFont = variant(CSS, (t) => t.replaceAll("Inter", "Roboto"));
  assert.deepEqual(failedIds(noFont), ["token-coverage"]);
});

test("token-coverage matches a color written as short hex, upper case or rgb()", () => {
  for (const written of ["#36d", "#3E63DD", "rgb(62, 99, 221)", "rgba(62 99 221 / 0.5)"]) {
    const files = good();
    for (const path of ["index.css", "tailwind.config.js"]) files.set(path, files.get(path).replaceAll("#3e63dd", written === "#36d" ? "#111111" : written));
    if (written === "#36d") files.set("PricingCard.tsx", files.get("PricingCard.tsx") + "\nexport const tint = '#36d';\n");
    const wanted = written === "#36d" ? { colors: ["#3366dd"], fonts: ["Inter"] } : spec;
    const failed = grade(files, wanted).rules.filter((r) => r.pass === false).map((r) => r.id);
    assert.ok(!failed.includes("token-coverage"), written);
  }
});

test("token-coverage finds a font named with a plus sign in a Google Fonts url", () => {
  const files = variant(CSS, (t) => t.replace("family=Inter", "family=Open+Sans"));
  assert.deepEqual(failedIds(files, { colors: [], fonts: ["Open Sans"] }), []);
});

test("a spec rule with no spec, or an empty spec, is skipped and never counted as a pass", () => {
  for (const given of [null, {}, { colors: [], fonts: [] }]) {
    const result = grade(good(), given);
    const rule = result.rules.find((r) => r.id === "token-coverage");
    assert.equal(rule.skipped, true);
    assert.equal(rule.pass, null);
    assert.equal(result.rulesSkipped, 1);
  }
});
