import { isTypeScript, lineOf, parseFile, ts, walk } from "../parse.mjs";

const uiFiles = (files) => [...files.keys()].filter((p) => /\.(tsx|ts|jsx)$/.test(p));
const tsFiles = (files) => [...files.keys()].filter(isTypeScript);

const hasModifier = (node, kind) => (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []).some((m) => m.kind === kind) : false);

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

const isPascal = (name) => /^[A-Z][\w$]*$/.test(name);

const unwrap = (node) => {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
  return n;
};

const isJsx = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);

const containsJsx = (node) => {
  let found = false;
  walk(node, (n) => {
    if (isJsx(n)) found = true;
  });
  return found;
};

// Is this expression JSX, or a conditional with a JSX branch, or a && / || / ?? with JSX on the right?
function jsxValue(expr) {
  const e = unwrap(expr);
  if (isJsx(e)) return true;
  if (ts.isConditionalExpression(e)) return jsxValue(e.whenTrue) || jsxValue(e.whenFalse);
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    const logical = op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken;
    return logical && jsxValue(e.right);
  }
  return false;
}

// The return expressions and the local variables of this function itself, not of a
// function nested in it.
function ownParts(body) {
  const returns = [];
  const locals = new Map();
  const visit = (n) => {
    if (ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) locals.set(n.name.text, n.initializer);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return { returns, locals };
}

// "Returns JSX": an arrow's expression body or one of the function's own return
// statements has JSX in it (so return items.map((i) => <li />) and
// return createPortal(<div />, body) count), or returns a local variable that was set to
// JSX. JSX that the function builds and hands to something else without returning it does not.
function returnsJsx(fn) {
  if (!fn.body) return false;
  if (!ts.isBlock(fn.body)) return containsJsx(fn.body);
  const { returns, locals } = ownParts(fn.body);
  return returns.some((e) => {
    if (containsJsx(e)) return true;
    const returned = unwrap(e);
    return ts.isIdentifier(returned) && locals.has(returned.text) && jsxValue(locals.get(returned.text));
  });
}

const isFunctionValue = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n);

// memo(() => ...) and forwardRef(...) wrap a component, possibly one inside the other;
// useMemo(() => <div />) does not. Returns the wrapped function, or null.
function wrappedFunction(init) {
  if (!ts.isCallExpression(init)) return null;
  const callee = init.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
  if (name !== "memo" && name !== "forwardRef") return null;
  for (const arg of init.arguments) {
    const a = unwrap(arg);
    if (isFunctionValue(a)) return a;
    const inner = wrappedFunction(a);
    if (inner) return inner;
  }
  return null;
}

// A class is a component when its render method, or an arrow assigned to render, returns JSX.
function rendersJsx(cls) {
  return cls.members.some((m) => {
    if (!(m.name && ts.isIdentifier(m.name) && m.name.text === "render")) return false;
    if (ts.isMethodDeclaration(m)) return returnsJsx(m);
    return ts.isPropertyDeclaration(m) && m.initializer !== undefined && isFunctionValue(unwrap(m.initializer)) && returnsJsx(unwrap(m.initializer));
  });
}

// A component is a capitalised function, arrow, class or memo/forwardRef wrapper that returns
// JSX (a class: from render), declared anywhere in the file: one nested in another component
// counts too, and so does an unnamed default export. A function that only passes JSX to
// another function, such as toast.custom(<span />) as a statement, is not a component.
function findComponents(sf) {
  const found = [];
  walk(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && isPascal(n.name.text) && returnsJsx(n)) {
      found.push({ name: n.name.text, node: n });
    } else if (ts.isFunctionDeclaration(n) && !n.name && hasModifier(n, ts.SyntaxKind.DefaultKeyword) && returnsJsx(n)) {
      found.push({ name: "(default export)", node: n });
    } else if (ts.isClassDeclaration(n) && n.name && isPascal(n.name.text) && rendersJsx(n)) {
      found.push({ name: n.name.text, node: n });
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isPascal(n.name.text) && n.initializer) {
      const init = unwrap(n.initializer);
      const fn = isFunctionValue(init) ? init : wrappedFunction(init);
      if ((fn && returnsJsx(fn)) || (ts.isClassExpression(init) && rendersJsx(init))) found.push({ name: n.name.text, node: n });
    }
  });
  return found;
}

// "One React component per file."
const oneComponentPerFile = {
  id: "one-component-per-file",
  check(files) {
    const findings = [];
    for (const path of tsFiles(files)) {
      const sf = parseFile(files, path);
      const components = findComponents(sf);
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

function bindingNames(name, out) {
  if (ts.isIdentifier(name)) out.add(name.text);
  else for (const el of name.elements) if (ts.isBindingElement(el)) bindingNames(el.name, out);
}

// Every name the file declares anywhere: imports, functions, classes, variables
// (including destructured ones), parameters. A name in this set is bound somewhere;
// the rule does not work out scopes.
function declaredNames(sf) {
  const names = new Set();
  const add = (id) => {
    if (id && ts.isIdentifier(id)) names.add(id.text);
  };
  walk(sf, (n) => {
    if (ts.isImportClause(n) || ts.isNamespaceImport(n) || ts.isImportSpecifier(n) || ts.isImportEqualsDeclaration(n)) add(n.name);
    else if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isEnumDeclaration(n) || ts.isModuleDeclaration(n)) add(n.name);
    else if (ts.isVariableDeclaration(n) || ts.isParameter(n)) bindingNames(n.name, names);
  });
  return names;
}

// The leftmost identifier of a JSX tag name: Foo for <Foo />, <Foo.Bar />, <motion.div />.
function tagRoot(tagName) {
  let t = tagName;
  while (ts.isPropertyAccessExpression(t)) t = t.expression;
  return ts.isIdentifier(t) ? t : null;
}

// The failure class where a model uses a hook, React.something, ReactDOM.something or a
// component and forgets the import. As in TypeScript, a tag that starts with a lower-case
// letter or contains a hyphen (<div />, <my-element />) is an HTML element; any other tag, and
// the root of a dotted one, has to be bound.
const reactInScope = {
  id: "react-in-scope",
  check(files) {
    const findings = [];
    for (const path of uiFiles(files)) {
      const sf = parseFile(files, path);
      const bound = declaredNames(sf);
      const reported = new Set();
      const report = (name, node, message) => {
        if (reported.has(name)) return;
        reported.add(name);
        findings.push({ file: path, line: lineOf(sf, node), message });
      };
      walk(sf, (n) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOKS.has(n.expression.text) && !bound.has(n.expression.text)) {
          report(n.expression.text, n, `${n.expression.text} is called but not imported`);
        }
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "React" && !bound.has("React")) {
          report("React", n, "React.* is used but React is not imported");
        }
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "ReactDOM" && !bound.has("ReactDOM")) {
          report("ReactDOM", n, "ReactDOM.* is used but ReactDOM is not imported");
        }
        if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
          const root = tagRoot(n.tagName);
          const needsBinding = root && (ts.isPropertyAccessExpression(n.tagName) || !/^[a-z]|-/.test(root.text));
          if (needsBinding && !bound.has(root.text)) {
            report(root.text, n, `<${n.tagName.getText(sf)}> is used but ${root.text} is neither imported nor declared`);
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
      const isUseServer = (stmt) => stmt && ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression) && stmt.expression.text === "use server";
      if (isUseServer(sf.statements[0])) add(sf.statements[0], "'use server' directive");
      walk(sf, (n) => {
        const fn = ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
        if (fn && n.body && ts.isBlock(n.body) && isUseServer(n.body.statements[0])) add(n.body.statements[0], "'use server' directive in a function");
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
