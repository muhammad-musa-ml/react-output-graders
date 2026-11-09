import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { isCode, lineOf, parseFile, ts, walk } from "../parse.mjs";

const namesText = readFileSync(new URL("../../data/lucide-react-names.txt", import.meta.url), "utf8");
export const LUCIDE_NAMES = new Set(namesText.split("\n").filter((l) => l && !l.startsWith("#")));
export const LUCIDE_VERSION = (namesText.match(/lucide-react (\S+)/) ?? [])[1] ?? "unknown";

// The packages the recreate-as-react contract names, react-dom because its own
// index.tsx imports react-dom/client, and framer-motion because the
// integrate-magic-patterns-design skill lists it among the libraries Magic
// Patterns code uses. Anything else has to be declared in a package.json the
// output carries.
export const ALLOWED_PACKAGES = new Set([
  "react",
  "react-dom",
  "lucide-react",
  "react-router-dom",
  "framer-motion",
  "sonner",
  "recharts",
  "@xyflow/react",
  "leaflet",
  "@magicpatterns/cubed",
  "@radix-ui/themes",
]);

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css"];

function packageName(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function declaredPackages(files) {
  const declared = new Set();
  for (const [path, text] of files) {
    if (path !== "package.json") continue;
    try {
      const pkg = JSON.parse(text);
      for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
        for (const name of Object.keys(pkg[key] ?? {})) declared.add(name);
      }
    } catch {
      // a package.json that does not parse declares nothing
    }
  }
  return declared;
}

function resolvesRelative(files, fromPath, spec) {
  const base = posix.normalize(posix.join(posix.dirname(fromPath), spec));
  return EXTENSIONS.some((ext) => files.has(base + ext)) || EXTENSIONS.some((ext) => files.has(posix.join(base, "index" + ext)));
}

// Every module specifier a file asks for: import and export-from, import(), require().
function specifiers(sf) {
  const found = [];
  walk(sf, (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      found.push({ spec: n.moduleSpecifier.text, node: n });
    }
    if (ts.isCallExpression(n) && n.arguments.length >= 1 && ts.isStringLiteralLike(n.arguments[0])) {
      const callee = n.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
        found.push({ spec: n.arguments[0].text, node: n });
      }
    }
  });
  return found;
}

// "The code must compile - no unresolved imports": relative paths must exist
// in the output, packages must be named by the contract or by a package.json.
const importsResolve = {
  id: "imports-resolve",
  check(files) {
    const findings = [];
    const declared = declaredPackages(files);
    for (const path of files.keys()) {
      if (!isCode(path) || path === "tailwind.config.js") continue;
      const sf = parseFile(files, path);
      for (const { spec, node } of specifiers(sf)) {
        const add = (message) => findings.push({ file: path, line: lineOf(sf, node), message });
        if (spec.startsWith(".")) {
          if (!resolvesRelative(files, path, spec)) add(`"${spec}" is not a file in the output`);
        } else if (/^[@~#]\//.test(spec) || spec.startsWith("node:")) {
          add(`"${spec}" does not resolve in a standalone folder`);
        } else {
          const name = packageName(spec);
          if (!ALLOWED_PACKAGES.has(name) && !declared.has(name)) add(`package "${name}" is neither named by the contract nor declared in a package.json`);
        }
      }
    }
    return findings;
  },
};

function nearest(name) {
  const prefix = name.slice(0, 4).toLowerCase();
  return [...LUCIDE_NAMES].filter((n) => n.toLowerCase().startsWith(prefix) && !n.startsWith("Lucide")).slice(0, 3);
}

// The hallucinated-icon failure class: a name imported from lucide-react that the package does not export.
const iconNamesExist = {
  id: "icon-names-exist",
  check(files) {
    const findings = [];
    for (const path of files.keys()) {
      if (!isCode(path)) continue;
      const sf = parseFile(files, path);
      const namespaces = new Set();
      const unknown = (node, name) => {
        const hint = nearest(name);
        findings.push({
          file: path,
          line: lineOf(sf, node),
          message: `${name} is not exported by lucide-react ${LUCIDE_VERSION}${hint.length ? "; similar: " + hint.join(", ") : ""}`,
        });
      };
      for (const stmt of sf.statements) {
        if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || stmt.moduleSpecifier.text !== "lucide-react") continue;
        const clause = stmt.importClause;
        if (!clause) continue;
        if (clause.name) findings.push({ file: path, line: lineOf(sf, stmt), message: "lucide-react has no default export" });
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            const name = (el.propertyName ?? el.name).text;
            if (!LUCIDE_NAMES.has(name)) unknown(el, name);
          }
        }
      }
      if (namespaces.size > 0) {
        walk(sf, (n) => {
          // A JSX tag <Icons.X /> has a property access for its tag name, so this one arm covers it.
          if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && namespaces.has(n.expression.text)) {
            if (!LUCIDE_NAMES.has(n.name.text)) unknown(n, n.name.text);
          }
        });
      }
    }
    return findings;
  },
};

export const IMPORT_RULES = [importsResolve, iconNamesExist];
