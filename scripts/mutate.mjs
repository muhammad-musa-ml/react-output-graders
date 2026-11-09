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

// The line of declaredNames in src/rules/code.mjs that lists the declaration kinds, and the
// same line with one kind taken out.
const DECLARED =
  "else if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isEnumDeclaration(n) || ts.isModuleDeclaration(n)) add(n.name);";
const withoutKind = (kind) => DECLARED.replace(`ts.is${kind}(n) || `, "").replace(` || ts.is${kind}(n)`, "");

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
  ["src/rules/code.mjs", "const fn = isFunctionValue(init) ? init : wrappedFunction(init);", "const fn = wrappedFunction(init);"],
  ["src/rules/code.mjs", "const fn = isFunctionValue(init) ? init : wrappedFunction(init);", "const fn = isFunctionValue(init) ? init : null;"],
  ["src/rules/code.mjs", 'if (name !== "memo" && name !== "forwardRef") return null;', "if (false) return null;"],
  ["src/rules/code.mjs", 'if (name !== "memo" && name !== "forwardRef") return null;', 'if (name !== "forwardRef") return null;'],
  ["src/rules/code.mjs", 'if (name !== "memo" && name !== "forwardRef") return null;', 'if (name !== "memo") return null;'],
  ["src/rules/code.mjs", "const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : \"\";", "const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : \"\";"],
  ["src/rules/code.mjs", "const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : \"\";", "const name = ts.isIdentifier(callee) ? callee.text : \"\";"],
  ["src/rules/code.mjs", "if (isFunctionValue(a)) return a;", ""],
  ["src/rules/code.mjs", "if (inner) return inner;", ""],
  ["src/rules/code.mjs", "ts.isParenthesizedExpression(n) || ts.isAsExpression(n) ||", "ts.isParenthesizedExpression(n) ||"],
  ["src/rules/code.mjs", "} else if (ts.isClassDeclaration(n) &&", "} else if (false &&"],
  ["src/rules/code.mjs", 'ts.isIdentifier(m.name) && m.name.text === "render"', "ts.isIdentifier(m.name)"],
  ["src/rules/code.mjs", "if (isJsx(e)) return true;", "if (false) return true;"],
  ["src/rules/code.mjs", "jsxValue(e.whenTrue) || jsxValue(e.whenFalse)", "jsxValue(e.whenTrue)"],
  ["src/rules/code.mjs", "jsxValue(e.whenTrue) || jsxValue(e.whenFalse)", "jsxValue(e.whenFalse)"],
  ["src/rules/code.mjs", "op === ts.SyntaxKind.AmpersandAmpersandToken || ", ""],
  ["src/rules/code.mjs", " || op === ts.SyntaxKind.BarBarToken", ""],
  ["src/rules/code.mjs", " || op === ts.SyntaxKind.QuestionQuestionToken", ""],
  ["src/rules/code.mjs", "return logical && jsxValue(e.right);", "return false;"],
  ["src/rules/code.mjs", "if (ts.isFunctionLike(n)) return;", "if (false) return;"],
  ["src/rules/code.mjs", "if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);", ""],
  ["src/rules/code.mjs", "if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);", "if (ts.isReturnStatement(n)) returns.push(n.expression);"],
  ["src/rules/code.mjs", "if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) locals.set(n.name.text, n.initializer);", ""],
  ["src/rules/code.mjs", "if (!fn.body) return false;", ""],
  ["src/rules/code.mjs", "if (!ts.isBlock(fn.body)) return containsJsx(fn.body);", ""],
  ["src/rules/code.mjs", "return returns.some((e) => {", "return returns.every((e) => {"],
  ["src/rules/code.mjs", "if (containsJsx(e)) return true;", "if (false) return true;"],
  ["src/rules/code.mjs", "return ts.isIdentifier(returned) && locals.has(returned.text) && jsxValue(locals.get(returned.text));", "return ts.isIdentifier(returned) && jsxValue(locals.get(returned.text));"],
  ["src/rules/code.mjs", "&& jsxValue(locals.get(returned.text));", "&& containsJsx(locals.get(returned.text));"],
  ["src/rules/code.mjs", "if (isJsx(n)) found = true;", ""],
  ["src/rules/code.mjs", "const isJsx = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);", "const isJsx = (n) => ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);"],
  ["src/rules/code.mjs", "const isJsx = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);", "const isJsx = (n) => ts.isJsxElement(n) || ts.isJsxFragment(n);"],
  ["src/rules/code.mjs", "const isJsx = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);", "const isJsx = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);"],
  ["src/rules/code.mjs", "const isPascal = (name) => /^[A-Z][\\w$]*$/.test(name);", "const isPascal = (name) => /^[A-Z][A-Za-z0-9]*$/.test(name);"],
  ["src/rules/code.mjs", "const isPascal = (name) => /^[A-Z][\\w$]*$/.test(name);", "const isPascal = (name) => /^[A-Z][\\w]*$/.test(name);"],
  ["src/rules/code.mjs", "else if (ts.isFunctionDeclaration(n) && !n.name && hasModifier(n, ts.SyntaxKind.DefaultKeyword) && returnsJsx(n)) {", "else if (false) {"],
  ["src/rules/code.mjs", "if ((fn && returnsJsx(fn)) || (ts.isClassExpression(init) && rendersJsx(init)))", "if (fn && returnsJsx(fn))"],
  ["src/rules/code.mjs", "if (!(m.name && ts.isIdentifier(m.name) && m.name.text === \"render\")) return false;", "if (!(ts.isIdentifier(m.name) && m.name.text === \"render\")) return false;"],
  ["src/rules/code.mjs", "if (!(m.name && ts.isIdentifier(m.name) && m.name.text === \"render\")) return false;", "if (!(m.name && ts.isIdentifier(m.name))) return false;"],
  ["src/rules/code.mjs", "if (ts.isMethodDeclaration(m)) return returnsJsx(m);", "if (false) return returnsJsx(m);"],
  ["src/rules/code.mjs", "ts.isPropertyDeclaration(m) && m.initializer !== undefined && isFunctionValue", "ts.isPropertyDeclaration(m) && isFunctionValue"],
  ["src/rules/code.mjs", "while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n)) n = n.expression;", "while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)) n = n.expression;"],
  ["src/rules/code.mjs", "while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n)) n = n.expression;", "while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n)) n = n.expression;"],
  ["src/rules/code.mjs", "else for (const el of name.elements) if (ts.isBindingElement(el)) bindingNames(el.name, out);", "else for (const el of name.elements) bindingNames(el.name, out);"],
  ["src/rules/code.mjs", "return ts.isIdentifier(t) ? t : null;", "return t;"],
  ["src/rules/code.mjs", "ts.isImportClause(n) || ts.isNamespaceImport(n)", "ts.isNamespaceImport(n)"],
  ["src/rules/code.mjs", "|| ts.isNamespaceImport(n) ||", "||"],
  ["src/rules/code.mjs", "|| ts.isImportSpecifier(n) ||", "||"],
  ["src/rules/code.mjs", "|| ts.isImportEqualsDeclaration(n)) add(n.name);", ") add(n.name);"],
  ...["FunctionDeclaration", "FunctionExpression", "ClassDeclaration", "ClassExpression", "EnumDeclaration", "ModuleDeclaration"].map((kind) => ["src/rules/code.mjs", DECLARED, withoutKind(kind)]),
  ["src/rules/code.mjs", "else if (ts.isVariableDeclaration(n) || ts.isParameter(n)) bindingNames(n.name, names);", "else if (ts.isVariableDeclaration(n)) bindingNames(n.name, names);"],
  ["src/rules/code.mjs", "else if (ts.isVariableDeclaration(n) || ts.isParameter(n)) bindingNames(n.name, names);", "else if (ts.isParameter(n)) bindingNames(n.name, names);"],
  ["src/rules/code.mjs", "while (ts.isPropertyAccessExpression(t)) t = t.expression;", "if (ts.isPropertyAccessExpression(t)) t = t.expression;"],
  ["src/rules/code.mjs", "if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {", "if (ts.isJsxSelfClosingElement(n)) {"],
  ["src/rules/code.mjs", "if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {", "if (ts.isJsxOpeningElement(n)) {"],
  ["src/rules/code.mjs", "(ts.isPropertyAccessExpression(n.tagName) || !/^[a-z]|-/.test(root.text))", "!/^[a-z]|-/.test(root.text)"],
  ["src/rules/code.mjs", "(ts.isPropertyAccessExpression(n.tagName) || !/^[a-z]|-/.test(root.text))", "true"],
  ["src/rules/code.mjs", "(ts.isPropertyAccessExpression(n.tagName) || !/^[a-z]|-/.test(root.text))", "(ts.isPropertyAccessExpression(n.tagName) || !/^[a-z]/.test(root.text))"],
  ["src/rules/code.mjs", "(ts.isPropertyAccessExpression(n.tagName) || !/^[a-z]|-/.test(root.text))", "(ts.isPropertyAccessExpression(n.tagName) || /^[A-Z]/.test(root.text))"],
  ["src/rules/code.mjs", 'n.expression.text === "ReactDOM" && !bound.has("ReactDOM")', 'n.expression.text === "ReactDOM" && false'],
  ["src/rules/code.mjs", "if (reported.has(name)) return;", ""],
  ["src/rules/code.mjs", "if (needsBinding && !bound.has(root.text)) {", "if (false) {"],
  ["src/rules/code.mjs", "const found = [];\n  walk(sf, (n) => {\n    if (ts.isFunctionDeclaration(n)", "const found = [];\n  ts.forEachChild(sf, (n) => {\n    if (ts.isFunctionDeclaration(n)"],
  ["src/rules/code.mjs", "else for (const el of name.elements) if (ts.isBindingElement(el)) bindingNames(el.name, out);", "else void 0;"],
  ["src/rules/code.mjs", "if (fn && n.body && ts.isBlock(n.body) && isUseServer(n.body.statements[0]))", "if (false)"],
  ["src/rules/code.mjs", '&& callee.name.text === "fetch"', "&& true"],
  ["src/rules/code.mjs", 'base.text === "globalThis"', 'base.text === "globalThisX"'],
  ["src/rules/code.mjs", 'n.expression.text === "XMLHttpRequest"', 'n.expression.text === "XMLHttpRequestX"'],
  ["src/rules/code.mjs", 'if (spec === "axios") add(n, "axios import");', ""],
  ["src/rules/code.mjs", "if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) literal = e;", "if (ts.isNoSubstitutionTemplateLiteral(e)) literal = e;"],
  ["src/rules/code.mjs", ": ts.isJsxOpeningElement(n) ? n : null", ": null"],
  ["src/rules/imports.mjs", '  "framer-motion",\n', ""],
  ["src/rules/imports.mjs", '["dependencies", "devDependencies", "peerDependencies"]', '["dependencies"]'],
  ["src/rules/imports.mjs", '(ts.isIdentifier(callee) && callee.text === "require")', "false"],
  ["src/rules/imports.mjs", "(ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)", "(ts.isImportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)"],
  ["src/rules/imports.mjs", ' || path === "tailwind.config.js"', ""],
  ["src/rules/imports.mjs", "if (!LUCIDE_NAMES.has(n.name.text)) unknown(n, n.name.text);", ""],
  ["src/rules/css.mjs", 'return FONT_URL.test(spec) ? "font" : "remote";', 'return "font";'],
  ["src/rules/css.mjs", 'return FONT_URL.test(spec) ? "font" : "remote";', 'return "remote";'],
  ["src/rules/css.mjs", 'return FONT_URL.test(spec) ? "font" : "remote";', 'return FONT_URL.test(spec) ? "font" : "other";'],
  ["src/rules/css.mjs", 'if (i.kind === "remote" && b && u && i.index > b.index && i.index < u.index) {', "if (false) {"],
  ["src/rules/css.mjs", "&& i.index > b.index && i.index < u.index) {", "&& i.index < u.index) {"],
  ["src/rules/css.mjs", "&& i.index > b.index && i.index < u.index) {", "&& i.index > b.index) {"],
  ["src/rules/css.mjs", "googleapis|gstatic|bunny", "gstatic|bunny"],
  ["src/rules/css.mjs", "googleapis|gstatic|bunny", "googleapis|bunny"],
  ["src/rules/css.mjs", "googleapis|gstatic|bunny", "googleapis|gstatic"],
  ["src/rules/css.mjs", "|typekit", ""],
  ["src/rules/css.mjs", "|fontawesome", ""],
  ["src/rules/css.mjs", "|[?&]family=", ""],
  ["src/rules/css.mjs", "(woff2?|ttf|otf)", "(ttf|otf)"],
  ["src/rules/css.mjs", "(woff2?|ttf|otf)", "(woff2?|otf)"],
  ["src/rules/css.mjs", "(woff2?|ttf|otf)", "(woff2?|ttf)"],
  ["src/rules/css.mjs", "(woff2?|ttf|otf)", "(woff2|ttf|otf)"],
  ["src/rules/css.mjs", "([?]|$)", "($)"],
  ["src/rules/css.mjs", "([?]|$)", "([?])"],
  ["src/rules/css.mjs", " && !u.name.startsWith(\"--tw-\")", ""],
  ["src/rules/css.mjs", 'startsWith("--tw-")', 'startsWith("--tw")'],
  ["src/rules/css.mjs", "|setProperty\\(\\s*['\"](--[\\w-]+)", ""],
  ["src/rules/css.mjs", '(files.get("index.css") ?? "") + "\\n" + ', ""],
  ["src/rules/css.mjs", ' + "\\n" + (files.get("tailwind.config.js") ?? "")', ""],
  ["src/rules/css.mjs", ".toLowerCase().replace(/\\+|%20/g, \" \");", ".toLowerCase();"],
  ["src/rules/css.mjs", ".toLowerCase().replace(/\\+|%20/g, \" \");", ".toLowerCase().replace(/\\+/g, \" \");"],
  ["src/rules/css.mjs", ".toLowerCase().replace(/\\+|%20/g, \" \");", ".toLowerCase().replace(/%20/g, \" \");"],
  ["src/rules/css.mjs", "Number(n).toString(16).padStart(2, \"0\")", "Number(n).toString(16)"],
  ["src/rules/css.mjs", "(^|[^a-z0-9])${escaped}([^a-z0-9]|$)", "${escaped}"],
  ["src/rules/css.mjs", "[4, 5, 7, 9].includes(m[0].length)", "[4, 7].includes(m[0].length)"],
  ["src/rules/css.mjs", "if (cssImports(blank(text)).some(", "if (false && cssImports(blank(text)).some("],
  ["src/files.mjs", 'path.replace(/^(\\.\\/)+/, "")', "path"],
  ["src/files.mjs", "if (SKIP_DIRS.has(name)) continue;", ""],
  ["src/files.mjs", "else if (TEXT_EXT.test(name)) {", "else {"],
  ["src/cli.mjs", "if (!existsSync(dir) || !statSync(dir).isDirectory()) {", "if (false) {"],
  ["run/summary.mjs", "if (t.cut) r.cut += 1;", ""],
  ["src/rules/code.mjs", "HOOKS.has(n.expression.text) && !bound.has(n.expression.text)", "HOOKS.has(n.expression.text) && false"],
  ["src/rules/code.mjs", 'n.expression.text === "React" && !bound.has("React")', 'n.expression.text === "React" && false'],
  ["src/rules/code.mjs", '(callee.text === "fetch" || callee.text === "axios")', '(callee.text === "axios")'],
  ["src/rules/code.mjs", 'base.text === "axios") add(n, "axios call")', 'base.text === "axiosX") add(n, "axios call")'],
  ["src/rules/code.mjs", '(base.text === "window" || base.text === "globalThis") && callee.name.text === "fetch"', "false"],
  ["src/rules/code.mjs", "if (processEnv || metaEnv)", "if (metaEnv)"],
  ["src/rules/code.mjs", "if (processEnv || metaEnv)", "if (processEnv)"],
  ["src/rules/code.mjs", 'stmt.expression.text === "use server"', 'stmt.expression.text === "use serverX"'],
  ['src/rules/code.mjs', 'if (spec === "next" || spec.startsWith("next/"))', "if (false)"],
  ["src/rules/code.mjs", "if (literal && !ABSOLUTE.test(literal.text) && !/^data:/i.test(literal.text))", "if (false)"],
  ["src/rules/code.mjs", "if (literal && !ABSOLUTE.test(literal.text) && !/^data:/i.test(literal.text))", "if (literal && !/^data:/i.test(literal.text))"],
  ["src/rules/imports.mjs", "if (!targetPath) {", "if (false) {"],
  ["src/rules/imports.mjs", "...EXTENSIONS.map((ext) => posix.join(base, \"index\" + ext)),", ""],
  ["src/rules/imports.mjs", "...EXTENSIONS.map((ext) => base + ext),", ""],
  ["src/rules/imports.mjs", "} else if (isCode(targetPath)) {", "} else {"],
  ["src/rules/imports.mjs", "if (!target.open) {", "if (true) {"],
  ["src/rules/imports.mjs", "if (!clause) return out;", ""],
  ["src/rules/imports.mjs", "if (clause.name && !target.hasDefault) {", "if (false) {"],
  ["src/rules/imports.mjs", "if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {", "if (false) {"],
  ["src/rules/imports.mjs", "const name = (el.propertyName ?? el.name).text;\n      const missing", "const name = el.name.text;\n      const missing"],
  ["src/rules/imports.mjs", 'const missing = name === "default" ? !target.hasDefault : !target.names.has(name);', "const missing = !target.names.has(name);"],
  ["src/rules/imports.mjs", 'const missing = name === "default" ? !target.hasDefault : !target.names.has(name);', "const missing = false;"],
  ["src/rules/imports.mjs", "if (!sawExport && COMMONJS.test(sf.text)) open = true;", ""],
  ["src/rules/imports.mjs", "if (!sawExport && COMMONJS.test(sf.text)) open = true;", "if (COMMONJS.test(sf.text)) open = true;"],
  ["src/rules/imports.mjs", "\\bmodule\\.exports\\b|", ""],
  ["src/rules/imports.mjs", "|\\bexports\\s*[.[]", ""],
  ["src/rules/imports.mjs", "|Object\\.defineProperty\\(\\s*exports", ""],
  ["src/rules/imports.mjs", "if (ts.isExportAssignment(stmt)) {\n      sawExport = true;", "if (ts.isExportAssignment(stmt)) {"],
  ["src/rules/imports.mjs", "} else if (ts.isExportDeclaration(stmt)) {\n      sawExport = true;", "} else if (ts.isExportDeclaration(stmt)) {"],
  ["src/rules/imports.mjs", "} else if (hasExportModifier(stmt)) {\n      sawExport = true;", "} else if (hasExportModifier(stmt)) {"],
  ["src/rules/imports.mjs", 'if (name === "default") hasDefault = true;', "if (false) hasDefault = true;"],
  ["src/rules/imports.mjs", "else names.add(name);", "else void 0;"],
  ["src/rules/imports.mjs", "else if (ts.isNamespaceExport(stmt.exportClause)) addName(stmt.exportClause.name.text);", "else if (ts.isNamespaceExport(stmt.exportClause)) void 0;"],
  ["src/rules/imports.mjs", "else for (const el of stmt.exportClause.elements) addName(el.name.text);", "else void 0;"],
  ["src/rules/imports.mjs", "...(stem === base ? [] : [stem + \".ts\", stem + \".tsx\"]),", "...[],"],
  ["src/rules/imports.mjs", "const stem = base.replace(/\\.jsx?$/, \"\");", "const stem = base.replace(/\\.js$/, \"\");"],
  ["src/rules/imports.mjs", "if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) {", "if (false) {"],
  ["src/rules/imports.mjs", "if (stmt.isExportEquals) open = true;", "if (false) open = true;"],
  ["src/rules/imports.mjs", "if (stmt.isExportEquals) open = true;\n      else hasDefault = true;", "if (true) open = true;\n      else hasDefault = true;"],
  ["src/rules/imports.mjs", "if (!stmt.exportClause) open = true;", "if (false) open = true;"],
  ["src/rules/imports.mjs", "} else if (hasExportModifier(stmt)) {", "} else if (false) {"],
  ["src/rules/imports.mjs", "if (hasDefaultModifier(stmt)) hasDefault = true;", "if (false) hasDefault = true;"],
  ["src/rules/imports.mjs", "else if (ts.isVariableStatement(stmt)) for (const d of stmt.declarationList.declarations) declaredNames(d.name, names);", "else if (ts.isVariableStatement(stmt)) void 0;"],
  ["src/rules/imports.mjs", "else for (const el of name.elements) if (ts.isBindingElement(el)) declaredNames(el.name, out);", "else void 0;"],
  ["src/rules/imports.mjs", "else if (stmt.name && ts.isIdentifier(stmt.name)) names.add(stmt.name.text);", "else void 0;"],
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
  ["src/rules/css.mjs", "uses.filter((u) => !defined.has(u.name) &&", "uses.filter((u) => false &&"],
  ["src/rules/css.mjs", 'if (m[2] === ")") uses.push', "uses.push"],
  ["src/rules/css.mjs", "if (importsPackageCss(files)) return [];", ""],
  ["src/rules/css.mjs", "if (!present.has(hexOf(want)))", "if (false)"],
  ["src/rules/css.mjs", "if (!new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(css)) {", "if (false) {"],
  ["src/rules/css.mjs", "if (h.length === 3 || h.length === 4)", "if (false)"],
  ["src/rules/css.mjs", "Boolean(spec && ((spec.colors ?? []).length > 0 || (spec.fonts ?? []).length > 0))", "Boolean(spec)"],
  ["src/files.mjs", "if (firsts.size !== 1 || firsts.has(null)) return cleaned;", "return cleaned;"],
  ["src/files.mjs", 'else if (current && current.body.length > 0 && info === "")', "else if (false)"],
  ["src/files.mjs", "current.body = []; // anything written between the heading and the fence was prose", ""],
  ["src/files.mjs", 'replace(/<think>[\\s\\S]*?<\\/think>/g, "")', 'replace(/<thinkX>[\\s\\S]*?<\\/thinkX>/g, "")'],
  ["src/cli.mjs", "if (files.size === 0) {", "if (false) {"],
  ["src/cli.mjs", "if (specAsked) {", "if (false) {"],
  ["src/cli.mjs", "const specAsked = specAt >= 0 || specInline !== undefined;", "const specAsked = specInline !== undefined;"],
  ["src/cli.mjs", "const specAsked = specAt >= 0 || specInline !== undefined;", "const specAsked = specAt >= 0;"],
  ["src/cli.mjs", 'specInline.slice("--spec=".length)', "specInline"],
  ["src/cli.mjs", "const stripBom = (text) => (text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text);", "const stripBom = (text) => text;"],
  ["src/cli.mjs", 'if (!RULES.find((r) => r.id === "token-coverage").specHasInput(spec)) {', "if (false) {"],
  ["src/cli.mjs", "if (!existsSync(specPath) || !statSync(specPath).isFile()) {", "if (!statSync(specPath).isFile()) {"],
  ["src/cli.mjs", "if (!existsSync(specPath) || !statSync(specPath).isFile()) {", "if (!existsSync(specPath)) {"],
  ["src/cli.mjs", "is not valid JSON (${e.message}); nothing was graded`);\n    process.exit(2);", "is not valid JSON (${e.message}); nothing was graded`);\n    process.exit(1);"],
  ["src/cli.mjs", "if (json) {", "if (false) {"],
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
