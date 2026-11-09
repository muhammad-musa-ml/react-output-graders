import { normalizePaths } from "./files.mjs";
import { isCode, syntaxErrors } from "./parse.mjs";
import { CODE_RULES } from "./rules/code.mjs";
import { CSS_RULES } from "./rules/css.mjs";
import { IMPORT_RULES } from "./rules/imports.mjs";

export const REQUIRED_FILES = ["App.tsx", "index.tsx", "index.css", "tailwind.config.js"];

// Each rule: { id, needsSpec, specHasInput(spec), check(files, spec) -> [{ file, line, message }] }.
// A rule that needs a spec and gets none, or gets a spec with nothing to check,
// is reported as skipped, never as passed.
export const RULES = [
  {
    id: "required-files",
    check(files) {
      return REQUIRED_FILES.filter((name) => !files.has(name)).map((name) => ({
        file: name,
        line: 0,
        message: "the output contract asks for this file and it was not written",
      }));
    },
  },
  {
    id: "syntax",
    check(files) {
      const findings = [];
      for (const [path, text] of files) {
        if (!isCode(path)) continue;
        for (const e of syntaxErrors(path, text)) findings.push({ file: path, line: e.line, message: e.message });
      }
      return findings;
    },
  },
  ...CODE_RULES,
  ...IMPORT_RULES,
  ...CSS_RULES,
];

export function grade(inputFiles, spec = null) {
  const files = normalizePaths(inputFiles);
  const rules = RULES.map((rule) => {
    if (rule.needsSpec && !rule.specHasInput(spec)) return { id: rule.id, pass: null, skipped: true, findings: [] };
    const findings = rule.check(files, spec);
    return { id: rule.id, pass: findings.length === 0, skipped: false, findings };
  });
  const run = rules.filter((r) => !r.skipped);
  return {
    pass: run.every((r) => r.pass),
    fileCount: files.size,
    rulesRun: run.length,
    rulesSkipped: rules.length - run.length,
    rules,
  };
}
