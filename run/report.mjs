// node run/report.mjs <dir with trials.jsonl>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summarize, toMarkdown } from "./summary.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node run/report.mjs <dir with trials.jsonl>");
  process.exit(2);
}
const trials = readFileSync(join(dir, "trials.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
if (trials.length === 0) {
  console.error("trials.jsonl is empty; nothing to report");
  process.exit(2);
}
console.log(toMarkdown(summarize(trials)));
