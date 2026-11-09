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

const FIRST_LINE_NAME = /^\s*(?:\/\/|\/\*)\s*([A-Za-z0-9_@./-]+\.(?:tsx|ts|jsx|js|css|json))\s*(?:\*\/)?\s*$/;

// Pulls files out of a model reply. A line that is only a path (### App.tsx)
// starts a file, so one stray or missing fence cannot swallow the next file.
// A fenced block with no heading is named by its info string or a first-line
// comment. Returns the files and the number of blocks that had no usable name.
export function extractFiles(reply) {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/g, "");
  const files = new Map();
  let unnamed = 0;
  let current = null;

  const commit = () => {
    while (current && current.body.length > 0 && current.body[current.body.length - 1].trim() === "") current.body.pop();
    if (current && current.body.some((l) => l.trim() !== "")) {
      let name = current.name;
      if (!name && current.body.length > 0) {
        const first = current.body[0].match(FIRST_LINE_NAME);
        if (first) {
          name = first[1];
          current.body.shift();
        }
      }
      if (name) files.set(name, current.body.join("\n") + "\n");
      else unnamed += 1;
    }
    current = null;
  };

  for (const line of text.split("\n")) {
    const heading = pathFromLine(line);
    if (heading) {
      commit();
      current = { name: heading, body: [], sawOpen: false };
      continue;
    }
    const fence = line.match(/^\s*```(\S*)\s*(.*)$/);
    if (!fence) {
      if (current && (current.sawOpen || line.trim() !== "" || current.body.length > 0)) current.body.push(line);
      continue;
    }
    const info = `${fence[1]} ${fence[2]}`.trim();
    if (current && current.sawOpen) {
      commit(); // a closing fence
    } else if (current && current.body.length > 0 && info === "") {
      commit(); // a bare fence after fence-less code is a stray closing fence
    } else if (current) {
      current.sawOpen = true; // the opening fence of a named heading
      current.body = []; // anything written between the heading and the fence was prose
    } else {
      const named = info.match(PATH_TOKEN);
      current = { name: named ? named[1] : null, body: [], sawOpen: true };
    }
  }
  commit();
  return { files, unnamed };
}
