import { isCode } from "../parse.mjs";

// Replace comment text with spaces so line numbers stay the same.
const blank = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const lineAt = (text, index) => text.slice(0, index).split("\n").length;

// The three forms: url("x"), url(x) and "x". A font url can hold semicolons
// (wght@400;600), so a quoted form is read up to its closing quote.
function cssImports(css) {
  const found = [];
  const re = /@import\s+(?:url\(\s*(?:(['"])(.*?)\1|([^'")\s]+))\s*\)|(['"])(.*?)\4)[^;]*;/g;
  let m;
  while ((m = re.exec(css)) !== null) found.push({ spec: m[2] ?? m[3] ?? m[5], index: m.index, line: lineAt(css, m.index) });
  return found;
}

const kindOf = (spec) => {
  if (/^(https?:)?\/\//i.test(spec)) return "font";
  if (spec === "tailwindcss/base") return "base";
  if (spec === "tailwindcss/components") return "components";
  if (spec === "tailwindcss/utilities") return "utilities";
  return "other";
};

// "index.css must keep these in this exact order": font imports, the three
// tailwindcss imports, other imports, then custom css.
const cssImportOrder = {
  id: "css-import-order",
  check(files) {
    if (!files.has("index.css")) return []; // required-files reports the missing file
    const css = blank(files.get("index.css"));
    const findings = [];
    const add = (line, message) => findings.push({ file: "index.css", line, message });
    const directive = css.match(/@tailwind\s+(base|components|utilities)/);
    if (directive) add(lineAt(css, directive.index), `@tailwind ${directive[1]} used; the contract writes @import 'tailwindcss/${directive[1]}'`);
    const imports = cssImports(css).map((i) => ({ ...i, kind: kindOf(i.spec) }));
    const first = (kind) => imports.find((i) => i.kind === kind);
    for (const kind of ["base", "components", "utilities"]) {
      if (!first(kind) && !directive) add(0, `missing @import 'tailwindcss/${kind}'`);
    }
    const [b, c, u] = ["base", "components", "utilities"].map(first);
    if (b && c && c.index < b.index) add(c.line, "components imported before base");
    if (c && u && u.index < c.index) add(u.line, "utilities imported before components");
    if (b && u && u.index < b.index) add(u.line, "utilities imported before base");
    for (const i of imports) {
      if (i.kind === "font" && b && i.index > b.index) add(i.line, "font import after the tailwindcss imports");
      if (i.kind === "other" && u && i.index < u.index) add(i.line, `@import "${i.spec}" before the tailwindcss imports finish`);
    }
    return findings;
  },
};

const VAR_USE = /var\(\s*(--[\w-]+)\s*([,)])/g;
const VAR_DEF = /(--[\w-]+)['"]?\s*:|setProperty\(\s*['"](--[\w-]+)/g;

function importsPackageCss(files) {
  for (const [path, text] of files) {
    if (path.endsWith(".css")) {
      if (cssImports(blank(text)).some((i) => /\.css$/.test(i.spec) && !/^(\.|https?:|\/\/)/.test(i.spec) && kindOf(i.spec) === "other")) return true;
    } else if (isCode(path) && /^\s*import\s+['"][^.'"][^'"]*\.css['"]/m.test(text)) {
      return true;
    }
  }
  return false;
}

// "never leave a bare var(--...) undefined". A var() with a fallback is fine.
// When the output imports a package's stylesheet, that sheet may define the
// variable, so the rule says nothing rather than guess.
const cssVarsDefined = {
  id: "css-vars-defined",
  check(files) {
    if (importsPackageCss(files)) return [];
    const defined = new Set();
    const uses = [];
    for (const [path, text] of files) {
      if (!path.endsWith(".css") && !isCode(path)) continue;
      const body = path.endsWith(".css") ? blank(text) : text;
      for (const m of body.matchAll(VAR_DEF)) defined.add(m[1] ?? m[2]);
      for (const m of body.matchAll(VAR_USE)) if (m[2] === ")") uses.push({ file: path, line: lineAt(body, m.index), name: m[1] });
    }
    return uses.filter((u) => !defined.has(u.name)).map((u) => ({ file: u.file, line: u.line, message: `var(${u.name}) is used and never defined` }));
  },
};

function hexOf(token) {
  let h = token.toLowerCase().replace("#", "");
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  return "#" + h.slice(0, 6);
}

function colorsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) if ([4, 5, 7, 9].includes(m[0].length)) out.add(hexOf(m[0]));
  for (const m of text.matchAll(/rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/g)) {
    out.add("#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join(""));
  }
  return out;
}

// Presence of the resolved values a spec lists: not rendered fidelity.
const tokenCoverage = {
  id: "token-coverage",
  needsSpec: true,
  specHasInput: (spec) => Boolean(spec && ((spec.colors ?? []).length > 0 || (spec.fonts ?? []).length > 0)),
  check(files, spec) {
    const findings = [];
    const present = new Set();
    for (const [path, text] of files) if (path.endsWith(".css") || isCode(path)) for (const c of colorsIn(text)) present.add(c);
    for (const want of spec.colors ?? []) {
      if (!present.has(hexOf(want))) findings.push({ file: "(output)", line: 0, message: `color ${want} from the spec is in no file` });
    }
    const css = (files.get("index.css") ?? "").toLowerCase().replace(/\+/g, " ");
    for (const font of spec.fonts ?? []) {
      if (!css.includes(font.toLowerCase())) findings.push({ file: "index.css", line: 0, message: `font ${font} from the spec is not in index.css` });
    }
    return findings;
  },
};

export const CSS_RULES = [cssImportOrder, cssVarsDefined, tokenCoverage];
