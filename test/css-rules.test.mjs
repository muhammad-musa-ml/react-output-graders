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

test("css-import-order treats a stylesheet from a CDN as a remote import, not a font import", () => {
  const cdn = "@import url('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');\n";
  const after = variant(CSS, (t) => t.replace(UTILITIES, UTILITIES + cdn));
  assert.deepEqual(failedIds(after), []);
  const before = variant(CSS, (t) => t.replace(COMPONENTS, cdn + COMPONENTS));
  assert.deepEqual(failedIds(before), ["css-import-order"]);
});

test("css-import-order lets a remote stylesheet come first, with the fonts, or last, but not between the tailwindcss imports", () => {
  const remote = "@import url('https://rsms.me/inter/inter.css');\n";
  const first = variant(CSS, (t) => remote + t);
  assert.deepEqual(failedIds(first), []);
  const last = variant(CSS, (t) => t.replace(UTILITIES, UTILITIES + remote));
  assert.deepEqual(failedIds(last), []);
  const middle = variant(CSS, (t) => t.replace(COMPONENTS, remote + COMPONENTS));
  assert.deepEqual(failedIds(middle), ["css-import-order"]);
  assert.match(findingsFor(middle, "css-import-order")[0].message, /sits between the tailwindcss imports/);
  const betweenLast = variant(CSS, (t) => t.replace(UTILITIES, remote + UTILITIES));
  assert.deepEqual(failedIds(betweenLast), ["css-import-order"]);
});

// One address per alternative of the font-host pattern, each matching only that alternative.
const FONT_ADDRESSES = [
  "https://fonts.googleapis.com/x.css",
  "https://fonts.gstatic.com/x.css",
  "https://fonts.bunny.net/x.css",
  "https://use.typekit.net/x.css",
  "https://kit.fontawesome.com/x.css",
  "https://cdn.example.com/css?family=Inter",
  "https://cdn.example.com/inter.woff",
  "https://cdn.example.com/inter.woff2",
  "https://cdn.example.com/inter.ttf",
  "https://cdn.example.com/inter.otf",
  "https://cdn.example.com/inter.woff2?v=1",
];

test("css-import-order knows the font hosts and font file addresses: a font import after the tailwindcss imports fails", () => {
  for (const address of FONT_ADDRESSES) {
    const late = variant(CSS, (t) => t.replace(UTILITIES, UTILITIES + `@import url('${address}');\n`));
    assert.deepEqual(failedIds(late), ["css-import-order"], address);
    assert.match(findingsFor(late, "css-import-order")[0].message, /font import after the tailwindcss imports/, address);
    const first = variant(CSS, (t) => `@import url('${address}');\n` + t);
    assert.deepEqual(failedIds(first), [], address);
  }
});

test("css-vars-defined defines a variable through setProperty", () => {
  const files = variant("PricingCard.tsx", (t) => t.replace("text-[var(--accent)]", "text-[var(--brand)]") + "\ndocument.body.style.setProperty('--brand', '#3e63dd');\n");
  assert.deepEqual(failedIds(files), []);
});

test("css-vars-defined ignores Tailwind's own --tw- variables and nothing else that starts with tw", () => {
  assert.deepEqual(failedIds(variant(CSS, (t) => t + "\n.a { transform: translateX(var(--tw-translate-x)); }\n")), []);
  assert.deepEqual(failedIds(variant(CSS, (t) => t + "\n.a { color: var(--twist); }\n")), ["css-vars-defined"]);
  assert.deepEqual(failedIds(variant(CSS, (t) => t + "\n.a { color: var(--tw); }\n")), ["css-vars-defined"]);
});

test("css-vars-defined says nothing when the css itself imports a package stylesheet", () => {
  const files = variant(CSS, (t) => t.replace(UTILITIES, UTILITIES + "@import '@radix-ui/themes/styles.css';\n") + "\n.a { color: var(--accent-9); }\n");
  assert.deepEqual(failedIds(files), []);
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

// The font name Inter replaced in the listed files of the known-good set.
function withoutInter(...paths) {
  const files = good();
  for (const path of paths) files.set(path, files.get(path).replaceAll("Inter", "Roboto"));
  return files;
}

test("token-coverage fails a color and a font the spec lists but the output lacks", () => {
  const noColor = variant(CSS, (t) => t.replaceAll("#3e63dd", "#111111"));
  noColor.set("tailwind.config.js", good().get("tailwind.config.js").replaceAll("#3e63dd", "#111111"));
  noColor.set("PricingCard.tsx", good().get("PricingCard.tsx"));
  assert.deepEqual(failedIds(noColor), ["token-coverage"]);
  const noFont = withoutInter("index.css", "tailwind.config.js");
  assert.deepEqual(failedIds(noFont), ["token-coverage"]);
  assert.match(findingsFor(noFont, "token-coverage")[0].message, /in neither index\.css nor tailwind\.config\.js/);
});

test("token-coverage finds a font in index.css alone or in tailwind.config.js alone", () => {
  assert.deepEqual(failedIds(withoutInter("index.css")), [], "only the config names Inter");
  assert.deepEqual(failedIds(withoutInter("tailwind.config.js")), [], "only index.css names Inter");
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

test("token-coverage does not find the font Inter inside the word pointer", () => {
  const files = withoutInter("index.css", "tailwind.config.js");
  files.set(CSS, files.get(CSS) + "\nbutton {\n  cursor: pointer;\n}\n");
  assert.deepEqual(failedIds(files), ["token-coverage"]);
  assert.match(findingsFor(files, "token-coverage")[0].message, /font Inter/);
});

test("token-coverage zero-pads a color written as rgb() with small numbers", () => {
  const files = variant(CSS, (t) => t + "\n.a { color: rgb(1, 2, 3); }\n");
  assert.deepEqual(failedIds(files, { colors: ["#010203"], fonts: [] }), []);
  assert.deepEqual(failedIds(files, { colors: ["#010204"], fonts: [] }), ["token-coverage"]);
});

test("token-coverage reads an 8-digit hex color with alpha", () => {
  const files = good();
  for (const path of ["index.css", "tailwind.config.js"]) files.set(path, files.get(path).replaceAll("#3e63dd", "#3e63ddcc"));
  assert.deepEqual(failedIds(files), []);
});

test("token-coverage finds a font named with a plus sign or %20 in a Google Fonts url", () => {
  for (const written of ["Open+Sans", "Open%20Sans"]) {
    const files = variant(CSS, (t) => t.replace("family=Inter", `family=${written}`));
    assert.deepEqual(failedIds(files, { colors: [], fonts: ["Open Sans"] }), [], written);
  }
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
