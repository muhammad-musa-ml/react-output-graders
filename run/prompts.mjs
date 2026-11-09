// What the model is asked. "bare" gives the task and the file list only.
// "contract" adds the rules the graders check, in plain words.

const FILES =
  "Write a self-contained React + TypeScript + Tailwind CSS v3 prototype. " +
  "Reply with every file as a heading line of the form ### path followed by one fenced code block. " +
  "Write these files: App.tsx, index.tsx, index.css, tailwind.config.js, and one file named after the main component. " +
  "Put mock data in mockData.ts when the design needs it.";

const RULES = [
  "Use named exports only. Never use export default.",
  "Never use the type any. Define prop types.",
  "Put one React component in each file.",
  "index.css starts with the font @import url(...) line, then @import 'tailwindcss/base'; then @import 'tailwindcss/components'; then @import 'tailwindcss/utilities'; in that order.",
  "Use lucide-react for icons and import full names that end in Icon, for example UserIcon.",
  "Use absolute https URLs for images, never app-relative paths.",
  "Do not call fetch or axios, read process.env, or import from next or next/*. Use hardcoded mock data.",
  "Import only react, react-dom, lucide-react, react-router-dom, sonner, recharts, @xyflow/react, leaflet, or files you write.",
  "Import every hook you call, and import React if you write React.something.",
  "Never write var(--name) unless you define --name.",
];

function tokens(spec) {
  const colors = (spec.colors ?? []).map((c) => `use ${c} as the accent color`);
  const fonts = (spec.fonts ?? []).map((f) => `use the font ${f}, loaded with @import url(...) at the top of index.css`);
  return [...colors, ...fonts].join(" and ") + ".";
}

export function firstPrompt(task, config) {
  const parts = [`${FILES}\n\nBuild this: ${task.prompt}\n\nDesign tokens: ${tokens(task.spec)}`];
  if (config === "contract") parts.push(`Rules for the files:\n${RULES.map((r) => `- ${r}`).join("\n")}`);
  return parts.join("\n\n");
}

// The grader's findings, handed back as the next user turn.
export function feedbackPrompt(result) {
  const lines = [];
  for (const rule of result.rules) {
    for (const f of rule.findings) lines.push(`- ${rule.id}: ${f.file}${f.line ? ":" + f.line : ""} ${f.message}`);
  }
  return `A checker found these problems in your files:\n${lines.join("\n")}\n\nFix them and send all the files again in the same format.`;
}
