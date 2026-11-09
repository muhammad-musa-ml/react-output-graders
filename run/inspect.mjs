// node run/inspect.mjs <reply.json> [task id]
// Prints the files a stored model reply held and what each rule found in it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFiles } from "../src/files.mjs";
import { grade } from "../src/graders.mjs";

const [replyPath, taskId] = process.argv.slice(2);
if (!replyPath) {
  console.error("usage: node run/inspect.mjs <reply.json> [task id]");
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const task = taskId ? JSON.parse(readFileSync(join(root, "tasks", "tasks.json"), "utf8")).find((t) => t.id === taskId) : null;
if (taskId && !task) {
  console.error(`no task named ${taskId}`);
  process.exit(2);
}

const { files, unnamed } = extractFiles(JSON.parse(readFileSync(replyPath, "utf8")).text);
const result = grade(files, task?.spec ?? null);
console.log(`files: ${[...files.keys()].join(", ") || "(none)"}; unnamed blocks: ${unnamed}`);
for (const rule of result.rules) {
  if (rule.skipped) console.log(`skip  ${rule.id}`);
  else if (!rule.pass) {
    console.log(`FAIL  ${rule.id}`);
    for (const f of rule.findings) console.log(`      ${f.file}:${f.line}  ${f.message}`);
  }
}
console.log(result.pass ? "PASS" : "FAIL");
