// node scripts/mutate.mjs
// Copies the repo to a temp folder, breaks one guard at a time there, and runs
// the tests. A guard whose break leaves the tests green has no test behind it.
// The repo itself is never edited.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// [file, text that occurs once, what replaces it]
const MUTANTS = [
  ["src/graders.mjs", "REQUIRED_FILES.filter((name) => !files.has(name))", "[].filter((name) => !files.has(name))"],
  ["src/graders.mjs", "for (const e of syntaxErrors(path, text))", "for (const e of [])"],
  ["src/graders.mjs", "rulesSkipped: rules.length - run.length", "rulesSkipped: 0"],
  ["src/rules/code.mjs", "const defaultExpr = ts.isExportAssignment(stmt) && !stmt.isExportEquals;", "const defaultExpr = false;"],
  ["src/rules/code.mjs", "const defaultDecl = hasModifier(stmt, ts.SyntaxKind.ExportKeyword) && hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);", "const defaultDecl = false;"],
  ["src/rules/code.mjs", 'stmt.exportClause.elements.some((e) => e.name.text === "default")', "false"],
  ["src/rules/code.mjs", "if (n.kind === ts.SyntaxKind.AnyKeyword)", "if (false)"],
  ["src/rules/code.mjs", "if (components.length > 1)", "if (components.length > 99)"],
  ["src/rules/code.mjs", "(ts.isArrowFunction(init) || ts.isFunctionExpression(init) || callsWithFunction)", "(ts.isFunctionExpression(init) || callsWithFunction)"],
  ["src/rules/code.mjs", "(ts.isArrowFunction(init) || ts.isFunctionExpression(init) || callsWithFunction)", "(ts.isArrowFunction(init) || ts.isFunctionExpression(init))"],
  ["src/rules/code.mjs", "HOOKS.has(n.expression.text) && !bound.has(n.expression.text)", "HOOKS.has(n.expression.text) && false"],
  ["src/rules/code.mjs", 'n.expression.text === "React" && !bound.has("React")', 'n.expression.text === "React" && false'],
  ["src/rules/code.mjs", '(callee.text === "fetch" || callee.text === "axios")', '(callee.text === "axios")'],
  ["src/rules/code.mjs", 'base.text === "axios") add(n, "axios call")', 'base.text === "axiosX") add(n, "axios call")'],
  ["src/rules/code.mjs", '(base.text === "window" || base.text === "globalThis") && callee.name.text === "fetch"', "false"],
  ["src/rules/code.mjs", "if (processEnv || metaEnv)", "if (metaEnv)"],
  ["src/rules/code.mjs", "if (processEnv || metaEnv)", "if (processEnv)"],
  ["src/rules/code.mjs", 'first.expression.text === "use server"', 'first.expression.text === "use serverX"'],
  ['src/rules/code.mjs', 'if (spec === "next" || spec.startsWith("next/"))', "if (false)"],
  ["src/rules/code.mjs", "if (literal && !ABSOLUTE.test(literal.text) && !/^data:/i.test(literal.text))", "if (false)"],
  ["src/rules/code.mjs", "if (literal && !ABSOLUTE.test(literal.text) && !/^data:/i.test(literal.text))", "if (literal && !/^data:/i.test(literal.text))"],
  ["src/rules/imports.mjs", "if (!resolvesRelative(files, path, spec))", "if (false)"],
  ["src/rules/imports.mjs", '|| spec.startsWith("node:")', "|| false"],
  ["src/rules/imports.mjs", "[@~#]", "[X]"],
  ["src/rules/imports.mjs", "if (!ALLOWED_PACKAGES.has(name) && !declared.has(name))", "if (false)"],
  ["src/rules/imports.mjs", "if (!ALLOWED_PACKAGES.has(name) && !declared.has(name))", "if (!ALLOWED_PACKAGES.has(name))"],
  ["src/rules/imports.mjs", "if (!LUCIDE_NAMES.has(name)) unknown(el, name);", ""],
  ["src/rules/imports.mjs", "if (clause.name) findings.push(", "if (false) findings.push("],
  ["src/rules/imports.mjs", "if (namespaces.size > 0) {", "if (false) {"],
  ["src/rules/css.mjs", "if (b && c && c.index < b.index)", "if (false)"],
  ["src/rules/css.mjs", "if (c && u && u.index < c.index)", "if (false)"],
  ["src/rules/css.mjs", 'if (i.kind === "font" && b && i.index > b.index)', "if (false)"],
  ["src/rules/css.mjs", 'if (i.kind === "other" && u && i.index < u.index)', "if (false)"],
  ["src/rules/css.mjs", "if (!first(kind) && !directive)", "if (false)"],
  ["src/rules/css.mjs", "if (directive) add(", "if (false) add("],
  ["src/rules/css.mjs", "uses.filter((u) => !defined.has(u.name))", "uses.filter(() => false)"],
  ["src/rules/css.mjs", 'if (m[2] === ")") uses.push', "uses.push"],
  ["src/rules/css.mjs", "if (importsPackageCss(files)) return [];", ""],
  ["src/rules/css.mjs", "if (!present.has(hexOf(want)))", "if (false)"],
  ["src/rules/css.mjs", "if (!css.includes(font.toLowerCase()))", "if (false)"],
  ["src/rules/css.mjs", "if (h.length === 3 || h.length === 4)", "if (false)"],
  ["src/rules/css.mjs", "Boolean(spec && ((spec.colors ?? []).length > 0 || (spec.fonts ?? []).length > 0))", "Boolean(spec)"],
  ["src/files.mjs", "if (firsts.size !== 1 || firsts.has(null)) return cleaned;", "return cleaned;"],
  ["src/files.mjs", 'else if (current && current.body.length > 0 && info === "")', "else if (false)"],
  ["src/files.mjs", "current.body = []; // anything written between the heading and the fence was prose", ""],
  ["src/files.mjs", 'replace(/<think>[\\s\\S]*?<\\/think>/g, "")', 'replace(/<thinkX>[\\s\\S]*?<\\/thinkX>/g, "")'],
  ["src/cli.mjs", "if (files.size === 0) {", "if (false) {"],
  ["run/stats.mjs", "if (n === 0) return [0, 1];", ""],
];

const md5 = (text) => createHash("md5").update(text).digest("hex");
const work = mkdtempSync(join(tmpdir(), "rog-mutants-"));
for (const name of ["src", "test", "fixtures", "data", "run", "tasks", "package.json"]) cpSync(join(root, name), join(work, name), { recursive: true });
symlinkSync(join(root, "node_modules"), join(work, "node_modules"), "junction");

function testFiles() {
  return ["graders", "code-rules", "import-rules", "css-rules", "cli", "run"].map((n) => `test/${n}.test.mjs`);
}

let survived = 0;
let unrun = 0;
const rows = [];
for (const [file, from, to] of MUTANTS) {
  const original = readFileSync(join(root, file), "utf8");
  const count = original.split(from).length - 1;
  if (count !== 1) {
    rows.push(`UNRUN     ${file}: the anchor occurs ${count} times: ${from.slice(0, 60)}`);
    unrun += 1;
    continue;
  }
  const mutated = original.replace(from, () => to);
  if (md5(mutated) === md5(original)) {
    rows.push(`UNRUN     ${file}: the mutation changed nothing`);
    unrun += 1;
    continue;
  }
  writeFileSync(join(work, file), mutated);
  const r = spawnSync(process.execPath, ["--test", ...testFiles()], { cwd: work, encoding: "utf8" });
  writeFileSync(join(work, file), original);
  const failed = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  if (r.status === 0) {
    rows.push(`SURVIVED  ${file}: ${from.slice(0, 70)}`);
    survived += 1;
  } else {
    rows.push(`killed    ${file}: ${from.slice(0, 50)}  <- ${failed.length} failing test(s): ${failed[0] ?? "(a crash)"}`);
  }
}
// Remove the junction on its own first, so the recursive delete below can
// never reach the real node_modules.
unlinkSync(join(work, "node_modules"));
rmSync(work, { recursive: true, force: true });
console.log(rows.join("\n"));
console.log(`${MUTANTS.length} mutants: ${MUTANTS.length - survived - unrun} killed, ${survived} survived, ${unrun} not run`);
process.exit(survived + unrun === 0 ? 0 : 1);
