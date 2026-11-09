import ts from "typescript";

export { ts };

const CODE = /\.(tsx|ts|jsx|js|mjs|cjs)$/;

export const isCode = (path) => CODE.test(path);
export const isTypeScript = (path) => /\.(tsx|ts)$/.test(path);

function kindFor(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".ts")) return ts.ScriptKind.TS;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

const cache = new WeakMap();

// Parses once per (files, path); the rules share the tree.
export function parseFile(files, path) {
  let perSet = cache.get(files);
  if (!perSet) {
    perSet = new Map();
    cache.set(files, perSet);
  }
  if (!perSet.has(path)) {
    perSet.set(path, ts.createSourceFile(path, files.get(path), ts.ScriptTarget.Latest, true, kindFor(path)));
  }
  return perSet.get(path);
}

export function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

export function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

// Syntax errors only. transpileModule does not resolve imports or check types.
export function syntaxErrors(path, text) {
  const out = ts.transpileModule(text, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext },
  });
  return (out.diagnostics ?? []).map((d) => {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindFor(path));
    const line = d.start === undefined ? 1 : sf.getLineAndCharacterOfPosition(d.start).line + 1;
    return { line, message: ts.flattenDiagnosticMessageText(d.messageText, " ") };
  });
}
