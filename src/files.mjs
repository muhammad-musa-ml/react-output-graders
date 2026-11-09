import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const TEXT_EXT = /\.(tsx|ts|jsx|js|mjs|cjs|css|json)$/;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

// Reads a folder into a Map of forward-slash relative path -> text.
export function loadDir(dir) {
  const files = new Map();
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (TEXT_EXT.test(name)) {
        files.set(relative(dir, full).split("\\").join("/"), readFileSync(full, "utf8"));
      }
    }
  };
  walk(dir);
  return files;
}

// A model often writes ComponentName/App.tsx. When every file sits under one
// folder, that folder is the output root, so drop it.
export function normalizePaths(files) {
  const cleaned = new Map();
  for (const [path, text] of files) cleaned.set(path.replace(/^(\.\/)+/, ""), text);
  const firsts = new Set([...cleaned.keys()].map((p) => (p.includes("/") ? p.split("/")[0] : null)));
  if (firsts.size !== 1 || firsts.has(null)) return cleaned;
  const prefix = [...firsts][0] + "/";
  const stripped = new Map();
  for (const [path, text] of cleaned) stripped.set(path.slice(prefix.length), text);
  return stripped;
}

const PATH_TOKEN = /([A-Za-z0-9_@./-]+\.(?:tsx|ts|jsx|js|css|json))/;

function pathFromLine(line) {
  const trimmed = line.trim().replace(/^[#*>\s`]+|[*`:\s]+$/g, "");
  const m = trimmed.match(/^(?:file(?:name)?:\s*)?([A-Za-z0-9_@./-]+\.(?:tsx|ts|jsx|js|css|json))$/i);
  return m ? m[1] : null;
}

// Pulls files out of a model reply: fenced blocks named by the line before the
// fence, by the info string, or by a first-line comment. Returns the files and
// the number of fenced blocks that had no usable name.
export function extractFiles(reply) {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, "");
  const files = new Map();
  let unnamed = 0;
  const lines = text.split("\n");
  let i = 0;
  let lastLine = "";
  while (i < lines.length) {
    const open = lines[i].match(/^\s*```(\S*)\s*(.*)$/);
    if (!open) {
      if (lines[i].trim() !== "") lastLine = lines[i];
      i += 1;
      continue;
    }
    const body = [];
    i += 1;
    while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
      body.push(lines[i]);
      i += 1;
    }
    i += 1;
    let name = pathFromLine(lastLine);
    if (!name) {
      const info = `${open[1]} ${open[2]}`.match(PATH_TOKEN);
      if (info) name = info[1];
    }
    if (!name && body.length > 0) {
      const first = body[0].match(/^\s*(?:\/\/|\/\*)\s*([A-Za-z0-9_@./-]+\.(?:tsx|ts|jsx|js|css|json))\s*(?:\*\/)?\s*$/);
      if (first) {
        name = first[1];
        body.shift();
      }
    }
    if (name) files.set(name, body.join("\n") + "\n");
    else unnamed += 1;
    lastLine = "";
  }
  return { files, unnamed };
}
