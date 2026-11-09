import { existsSync, readFileSync, statSync } from "node:fs";
import { loadDir } from "./files.mjs";
import { grade, RULES } from "./graders.mjs";

// Some editors and shells write a byte-order mark at the start of a JSON file; JSON.parse rejects it.
const stripBom = (text) => (text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text);

const args = process.argv.slice(2);
const json = args.includes("--json");
const specAt = args.indexOf("--spec");
const specInline = args.find((a) => a.startsWith("--spec="));
const specAsked = specAt >= 0 || specInline !== undefined;
const specPath = specInline !== undefined ? specInline.slice("--spec=".length) : specAt >= 0 ? args[specAt + 1] : null;
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--spec");

if (!dir) {
  console.error("usage: node src/cli.mjs <folder> [--spec spec.json] [--json]");
  process.exit(2);
}

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`${dir} is not a folder; nothing was graded`);
  process.exit(2);
}

const files = loadDir(dir);
if (files.size === 0) {
  console.error(`no source files found under ${dir}; nothing was graded`);
  process.exit(2);
}

// A spec that was asked for and cannot be used stops the run, so a typo in the
// path, a file that is not JSON, or one that lists no colors and no fonts never
// turns into a grade with a rule silently skipped.
let spec = null;
if (specAsked) {
  if (!existsSync(specPath) || !statSync(specPath).isFile()) {
    console.error(`--spec needs a spec file that exists (${specPath ?? "none given"}); nothing was graded`);
    process.exit(2);
  }
  try {
    spec = JSON.parse(stripBom(readFileSync(specPath, "utf8")));
  } catch (e) {
    console.error(`${specPath} is not valid JSON (${e.message}); nothing was graded`);
    process.exit(2);
  }
  if (!RULES.find((r) => r.id === "token-coverage").specHasInput(spec)) {
    console.error(`${specPath} lists no colors and no fonts; nothing was graded`);
    process.exit(2);
  }
}
const result = grade(files, spec);

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const rule of result.rules) {
    const label = rule.skipped ? "skip" : rule.pass ? "pass" : "FAIL";
    console.log(`${label}  ${rule.id}`);
    for (const f of rule.findings) console.log(`      ${f.file}:${f.line}  ${f.message}`);
  }
  console.log(`${result.pass ? "PASS" : "FAIL"}: ${result.rulesRun} rules run, ${result.rulesSkipped} skipped, ${result.fileCount} files`);
}
process.exit(result.pass ? 0 : 1);
