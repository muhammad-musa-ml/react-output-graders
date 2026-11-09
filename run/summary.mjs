import { wilson } from "./stats.mjs";

const ORDER = ["bare", "contract", "contract+feedback"];

// Pass counts per run and per seed, the rules that failed, and how many
// contract failures one repair turn fixed.
export function summarize(trials) {
  const runs = {};
  for (const t of trials) {
    const r = (runs[t.run] ??= { n: 0, passes: 0, perSeed: {}, ruleFailures: {} });
    r.n += 1;
    if (t.success) r.passes += 1;
    const s = (r.perSeed[t.trial] ??= { passes: 0, n: 0 });
    s.n += 1;
    if (t.success) s.passes += 1;
    for (const rule of t.failed_rules ?? []) r.ruleFailures[rule] = (r.ruleFailures[rule] ?? 0) + 1;
  }
  for (const r of Object.values(runs)) r.ci = wilson(r.passes, r.n);
  const repairs = trials.filter((t) => t.run === "contract+feedback" && t.repaired);
  return {
    runs,
    repair: { attempted: repairs.length, fixed: repairs.filter((t) => t.success).length },
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function toMarkdown(summary) {
  const names = ORDER.filter((n) => summary.runs[n]);
  const lines = ["| run | passed | rate | 95% Wilson | per seed |", "| --- | --- | --- | --- | --- |"];
  for (const name of names) {
    const r = summary.runs[name];
    const seeds = Object.keys(r.perSeed)
      .sort((a, b) => Number(a) - Number(b))
      .map((s) => `${r.perSeed[s].passes}/${r.perSeed[s].n}`)
      .join(", ");
    lines.push(`| ${name} | ${r.passes}/${r.n} | ${pct(r.passes / r.n)} | ${pct(r.ci[0])} to ${pct(r.ci[1])} | ${seeds} |`);
  }
  const rules = [...new Set(names.flatMap((n) => Object.keys(summary.runs[n].ruleFailures)))].sort();
  lines.push("", "Trials that failed each rule:", "", `| rule | ${names.join(" | ")} |`, `| --- | ${names.map(() => "---").join(" | ")} |`);
  for (const rule of rules) lines.push(`| ${rule} | ${names.map((n) => summary.runs[n].ruleFailures[rule] ?? 0).join(" | ")} |`);
  lines.push("", `Repair turn: ${summary.repair.fixed} of ${summary.repair.attempted} failing contract replies passed every rule after one round of the grader's findings.`);
  return lines.join("\n");
}
