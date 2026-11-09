import { isTypeScript, lineOf, parseFile, ts, walk } from "../parse.mjs";

const uiFiles = (files) => [...files.keys()].filter((p) => /\.(tsx|ts|jsx)$/.test(p));
const tsFiles = (files) => [...files.keys()].filter(isTypeScript);

const hasModifier = (node, kind) => (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []).some((m) => m.kind === kind) : false);

function containsJsx(node) {
  let found = false;
  walk(node, (n) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true;
  });
  return found;
}

// "Named exports only - never export default a React component."
const namedExports = {
  id: "named-exports",
  check(files) {
    const findings = [];
    for (const path of tsFiles(files)) {
      const sf = parseFile(files, path);
      for (const stmt of sf.statements) {
        const defaultExpr = ts.isExportAssignment(stmt) && !stmt.isExportEquals;
        const defaultDecl = hasModifier(stmt, ts.SyntaxKind.ExportKeyword) && hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
        const asDefault =
          ts.isExportDeclaration(stmt) &&
          stmt.exportClause &&
          ts.isNamedExports(stmt.exportClause) &&
          stmt.exportClause.elements.some((e) => e.name.text === "default");
        if (defaultExpr || defaultDecl || asDefault) {
          findings.push({ file: path, line: lineOf(sf, stmt), message: "default export; the contract asks for named exports only" });
        }
      }
    }
    return findings;
  },
};

// "React + TypeScript. No `any`".
const noAny = {
  id: "no-any",
  check(files) {
    const findings = [];
    for (const path of tsFiles(files)) {
      const sf = parseFile(files, path);
      walk(sf, (n) => {
        if (n.kind === ts.SyntaxKind.AnyKeyword) findings.push({ file: path, line: lineOf(sf, n), message: "the type any" });
      });
    }
    return findings;
  },
};

const isPascal = (name) => /^[A-Z][A-Za-z0-9]*$/.test(name);

function topLevelComponents(sf) {
  const found = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && isPascal(stmt.name.text) && stmt.body && containsJsx(stmt.body)) {
      found.push({ name: stmt.name.text, node: stmt });
    } else if (ts.isClassDeclaration(stmt) && stmt.name && isPascal(stmt.name.text) && containsJsx(stmt)) {
      found.push({ name: stmt.name.text, node: stmt });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !isPascal(decl.name.text) || !decl.initializer) continue;
        const init = decl.initializer;
        const callsWithFunction =
          ts.isCallExpression(init) && init.arguments.some((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init) || callsWithFunction) && containsJsx(init)) {
          found.push({ name: decl.name.text, node: decl });
        }
      }
    }
  }
  return found;
}

// "One React component per file."
const oneComponentPerFile = {
  id: "one-component-per-file",
  check(files) {
    const findings = [];
    for (const path of tsFiles(files)) {
      const sf = parseFile(files, path);
      const components = topLevelComponents(sf);
      if (components.length > 1) {
        findings.push({
          file: path,
          line: lineOf(sf, components[1].node),
          message: `${components.length} components in one file: ${components.map((c) => c.name).join(", ")}`,
        });
      }
    }
    return findings;
  },
};

const HOOKS = new Set([
  "useState",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useRef",
  "useMemo",
  "useCallback",
  "useContext",
  "useReducer",
  "useId",
  "useTransition",
  "useDeferredValue",
  "useImperativeHandle",
  "useSyncExternalStore",
]);

function moduleBindings(sf) {
  const names = new Set();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const clause = stmt.importClause;
      if (clause.name) names.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) names.add(el.name.text);
    } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
      names.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    }
  }
  return names;
}

// The failure class where a model uses a hook or React.something and forgets the import.
const reactInScope = {
  id: "react-in-scope",
  check(files) {
    const findings = [];
    for (const path of uiFiles(files)) {
      const sf = parseFile(files, path);
      const bound = moduleBindings(sf);
      const reported = new Set();
      walk(sf, (n) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOKS.has(n.expression.text) && !bound.has(n.expression.text)) {
          if (!reported.has(n.expression.text)) {
            reported.add(n.expression.text);
            findings.push({ file: path, line: lineOf(sf, n), message: `${n.expression.text} is called but not imported` });
          }
        }
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "React" && !bound.has("React")) {
          if (!reported.has("React")) {
            reported.add("React");
            findings.push({ file: path, line: lineOf(sf, n), message: "React.* is used but React is not imported" });
          }
        }
      });
    }
    return findings;
  },
};

// "Strip runtime, keep the UI": no network calls, env reads, server directives or Next.js modules.
const runtimeStripped = {
  id: "runtime-stripped",
  check(files) {
    const findings = [];
    for (const path of uiFiles(files)) {
      const sf = parseFile(files, path);
      const add = (node, message) => findings.push({ file: path, line: lineOf(sf, node), message });
      const first = sf.statements[0];
      if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server") {
        add(first, "'use server' directive");
      }
      walk(sf, (n) => {
        if (ts.isCallExpression(n)) {
          const callee = n.expression;
          if (ts.isIdentifier(callee) && (callee.text === "fetch" || callee.text === "axios")) add(n, `${callee.text}() call`);
          if (ts.isPropertyAccessExpression(callee)) {
            const base = callee.expression;
            if (ts.isIdentifier(base) && base.text === "axios") add(n, "axios call");
            if (ts.isIdentifier(base) && (base.text === "window" || base.text === "globalThis") && callee.name.text === "fetch") {
              add(n, "fetch() call");
            }
          }
        }
        if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "XMLHttpRequest") add(n, "XMLHttpRequest");
        if (ts.isPropertyAccessExpression(n) && n.name.text === "env") {
          const base = n.expression;
          const processEnv = ts.isIdentifier(base) && base.text === "process";
          const metaEnv = ts.isMetaProperty(base);
          if (processEnv || metaEnv) add(n, "environment variable read");
        }
        if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
          const spec = n.moduleSpecifier.text;
          if (spec === "next" || spec.startsWith("next/")) add(n, `Next.js module ${spec}`);
          if (spec === "axios") add(n, "axios import");
        }
      });
    }
    return findings;
  },
};

const ABSOLUTE = /^(https?:)?\/\//i;

// "Images: absolute URLs only - app-relative paths won't resolve."
const absoluteImageUrls = {
  id: "absolute-image-urls",
  check(files) {
    const findings = [];
    for (const path of uiFiles(files)) {
      const sf = parseFile(files, path);
      walk(sf, (n) => {
        const element = ts.isJsxSelfClosingElement(n) ? n : ts.isJsxOpeningElement(n) ? n : null;
        if (!element || !ts.isIdentifier(element.tagName) || element.tagName.text !== "img") return;
        for (const attr of element.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || attr.name.text !== "src" || !attr.initializer) continue;
          let literal = null;
          if (ts.isStringLiteral(attr.initializer)) literal = attr.initializer;
          else if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
            const e = attr.initializer.expression;
            if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) literal = e;
          }
          if (literal && !ABSOLUTE.test(literal.text) && !/^data:/i.test(literal.text)) {
            findings.push({ file: path, line: lineOf(sf, attr), message: `img src "${literal.text}" is not an absolute URL` });
          }
        }
      });
    }
    return findings;
  },
};

export const CODE_RULES = [namedExports, noAny, oneComponentPerFile, reactInScope, runtimeStripped, absoluteImageUrls];
