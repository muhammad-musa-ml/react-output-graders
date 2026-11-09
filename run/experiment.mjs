// node run/experiment.mjs --model <ollama model> [--seeds 3] [--tasks a,b] [--out runs/<name>]
// For each task and seed: a bare prompt, a prompt with the contract rules, and
// one repair turn for each contract reply that fails, using the grader's findings.
// Replies are cached under <out>/replies, so a rerun regrades without regenerating.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFiles } from "../src/files.mjs";
import { grade } from "../src/graders.mjs";
import { chat } from "./ollama.mjs";
import { feedbackPrompt, firstPrompt } from "./prompts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const model = opt("--model");
if (!model) {
  console.error("usage: node run/experiment.mjs --model <ollama model> [--seeds 3] [--tasks a,b] [--out dir]");
  process.exit(2);
}
const seeds = Number(opt("--seeds", "3"));
const only = opt("--tasks")?.split(",");
const out = opt("--out", join(root, "runs", model.replace(/[^\w.-]+/g, "_")));
const tasks = JSON.parse(readFileSync(join(root, "tasks", "tasks.json"), "utf8")).filter((t) => !only || only.includes(t.id));
if (tasks.length === 0) {
  console.error("no task matched --tasks");
  process.exit(2);
}

mkdirSync(join(out, "replies"), { recursive: true });

async function reply(name, seed, messages) {
  const file = join(out, "replies", `${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const got = await chat({ model, messages, seed });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(got, null, 1));
  console.log(`generated ${name}: ${got.tokens} tokens, ${got.seconds.toFixed(0)} s, ${got.done}`);
  return got;
}

function record(run, task, seed, result, extra) {
  return {
    run,
    task: task.id,
    trial: seed,
    success: result.pass,
    failed_rules: result.rules.filter((r) => r.pass === false).map((r) => r.id),
    files: result.fileCount,
    ...extra,
  };
}

const trials = [];
for (const task of tasks) {
  for (let seed = 1; seed <= seeds; seed += 1) {
    const bareMessages = [{ role: "user", content: firstPrompt(task, "bare") }];
    const bare = await reply(`bare/${task.id}-s${seed}`, seed, bareMessages);
    const bareFiles = extractFiles(bare.text);
    trials.push(record("bare", task, seed, grade(bareFiles.files, task.spec), { unnamed_blocks: bareFiles.unnamed, tokens: bare.tokens }));

    const contractMessages = [{ role: "user", content: firstPrompt(task, "contract") }];
    const first = await reply(`contract/${task.id}-s${seed}`, seed, contractMessages);
    const firstFiles = extractFiles(first.text);
    const firstResult = grade(firstFiles.files, task.spec);
    trials.push(record("contract", task, seed, firstResult, { unnamed_blocks: firstFiles.unnamed, tokens: first.tokens }));

    if (firstResult.pass) {
      trials.push(record("contract+feedback", task, seed, firstResult, { repaired: false, tokens: first.tokens }));
      continue;
    }
    const repairMessages = [
      ...contractMessages,
      { role: "assistant", content: first.text },
      { role: "user", content: feedbackPrompt(firstResult) },
    ];
    const second = await reply(`repair/${task.id}-s${seed}`, seed, repairMessages);
    const secondFiles = extractFiles(second.text);
    trials.push(record("contract+feedback", task, seed, grade(secondFiles.files, task.spec), { repaired: true, unnamed_blocks: secondFiles.unnamed, tokens: second.tokens }));
  }
}

writeFileSync(join(out, "trials.jsonl"), trials.map((t) => JSON.stringify(t)).join("\n") + "\n");
console.log(`${trials.length} trials written to ${join(out, "trials.jsonl")}`);
