import { existsSync, readFileSync, statSync } from "node:fs";
import { loadDir } from "./files.mjs";
import { grade } from "./graders.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const specAt = args.indexOf("--spec");
const specPath = specAt >= 0 ? args[specAt + 1] : null;
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

const spec = specPath ? JSON.parse(readFileSync(specPath, "utf8")) : null;
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
