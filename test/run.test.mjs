import assert from "node:assert/strict";
import { test } from "node:test";
import { grade } from "../src/graders.mjs";
import { feedbackPrompt, firstPrompt } from "../run/prompts.mjs";
import { summarize, toMarkdown } from "../run/summary.mjs";
import { wilson } from "../run/stats.mjs";
import { variant } from "./helpers.mjs";

const close = (a, b) => assert.ok(Math.abs(a - b) < 5e-4, `${a} is not ${b}`);

test("wilson matches hand-computed intervals at 5/10, 0/10 and 10/10", () => {
  const [lo, hi] = wilson(5, 10);
  close(lo, 0.2366);
  close(hi, 0.7634);
  const [lo0, hi0] = wilson(0, 10);
  assert.equal(lo0, 0);
  close(hi0, 0.2776);
  const [lo1, hi1] = wilson(10, 10);
  close(lo1, 0.7224);
  assert.equal(hi1, 1);
});

test("wilson of no trials is the whole range", () => {
  assert.deepEqual(wilson(0, 0), [0, 1]);
});

const task = { prompt: "A pricing card.", spec: { colors: ["#3e63dd"], fonts: ["Inter"] } };

test("the contract prompt adds the rules and the bare prompt does not", () => {
  const bare = firstPrompt(task, "bare");
  const contract = firstPrompt(task, "contract");
  assert.ok(bare.includes("A pricing card.") && bare.includes("#3e63dd") && bare.includes("Inter"));
  assert.equal(bare.includes("Never use export default"), false);
  assert.equal(bare.includes("Rules for the files"), false);
  assert.ok(contract.startsWith(bare));
  assert.ok(contract.includes("Never use export default"));
  assert.ok(contract.includes("lucide-react"));
});

test("the feedback prompt lists each finding with its rule, file and line", () => {
  const files = variant("PricingCard.tsx", (t) => t.replace("export function PricingCard", "export default function PricingCard"));
  const text = feedbackPrompt(grade(files, { colors: ["#3e63dd"], fonts: ["Inter"] }));
  assert.match(text, /- named-exports: PricingCard\.tsx:\d+ default export/);
  assert.match(text, /send all the files again/);
});

const trial = (run, task, seed, success, failed = []) => ({ run, task, trial: seed, success, failed_rules: failed });

test("summarize counts passes per run and per seed, rule failures, and repairs", () => {
  const trials = [
    trial("bare", "a", 1, false, ["named-exports"]),
    trial("bare", "b", 1, false, ["named-exports", "no-any"]),
    trial("bare", "a", 2, true),
    { ...trial("bare", "b", 2, false, ["no-any"]), cut: true },
    trial("contract", "a", 1, true),
    trial("contract", "b", 1, false, ["imports-resolve"]),
    { ...trial("contract+feedback", "a", 1, true), repaired: false },
    { ...trial("contract+feedback", "b", 1, true), repaired: true },
  ];
  const s = summarize(trials);
  assert.equal(s.runs.bare.n, 4);
  assert.equal(s.runs.bare.passes, 1);
  assert.deepEqual(s.runs.bare.perSeed, { 1: { passes: 0, n: 2 }, 2: { passes: 1, n: 2 } });
  assert.deepEqual(s.runs.bare.ruleFailures, { "named-exports": 2, "no-any": 2 });
  assert.deepEqual(s.repair, { attempted: 1, fixed: 1 });
  const md = toMarkdown(s);
  assert.match(md, /\| bare \| 1\/4 \| 25\.0% \|/);
  assert.match(md, /\| contract\+feedback \| 2\/2 \| 100\.0% \|/);
  assert.match(md, /Repair turn: 1 of 1 failing contract replies/);
  assert.equal(s.runs.bare.cut, 1);
  assert.match(md, /cut off at the length limit or the context window: bare 1, contract 0, contract\+feedback 0\./);
});
