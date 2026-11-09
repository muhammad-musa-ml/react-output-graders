# react-output-graders

Deterministic graders for the React and Tailwind files a UI agent writes, and a runner that scores a local model with them. I am not affiliated with Magic Patterns and have no access to their agent, their evals or their data.

## Why

The rules come from the output contract in Magic Patterns' public `recreate-as-react` skill (magicpatterns/agent-plugins), and from a Langfuse customer story about their pipeline that lists three things the model gets wrong: invented icon names, conflicting libraries and forgotten React imports. I wanted to see how much of "does this output follow the contract" a script can grade without a model judge, and whether the findings are good enough to send back to the model. This repo grades the first and the third of those three. Conflicting libraries is not graded.

## Run it

```
npm ci
npm test
node src/cli.mjs fixtures/good --spec fixtures/good.spec.json
```

`src/cli.mjs <folder>` grades a folder, prints one line per rule with file and line, and exits 0 (pass), 1 (fail) or 2 (nothing to grade). A rule that needs a spec and gets none is printed as `skip` and counted, never reported as a pass.

`node run/inspect.mjs <reply.json> <task id>` prints the findings for one stored reply. `node scripts/mutate.mjs` copies the repo to a temp folder, breaks 75 guards one at a time and requires the tests to fail for each; it takes more than ten minutes.

## The rules

| rule | what it checks | where it comes from |
| --- | --- | --- |
| required-files | App.tsx, index.tsx, index.css and tailwind.config.js exist | skill, Output contract |
| syntax | every .ts, .tsx, .js and .jsx file parses | skill, Where this runs (the code must compile; syntax only here) |
| named-exports | no default export, in any of its three forms | skill, Where this runs |
| no-any | no `any` type, read from the syntax tree, so the word in text or a comment does not count | skill, Where this runs |
| one-component-per-file | at most one component (a capitalised function, class or memo/forwardRef wrapper that returns JSX, at any depth) | skill, Where this runs |
| react-in-scope | a hook is called, or `React.x` is used, without an import | Langfuse story |
| runtime-stripped | no fetch, axios, XMLHttpRequest, `process.env`, `import.meta.env`, `'use server'` or `next/*` | skill, Step 3 |
| absolute-image-urls | an `img` src written as a string is an absolute URL | skill, Where this runs |
| imports-resolve | a relative import names a file in the output; a package is one the skill names (plus framer-motion, which the integrate skill lists) or one a package.json in the output declares | skill, Where this runs |
| icon-names-exist | every name imported from lucide-react is exported by lucide-react 1.70.0 | Langfuse story |
| css-import-order | font imports, then the three tailwindcss imports in order, then other imports | skill, Output contract |
| css-vars-defined | a `var(--x)` with no fallback has a definition | skill, Step 2 |
| token-coverage | the colors and fonts a spec lists appear in the output | skill, Fidelity checklist |

## An experiment

One local model, qwen3:4b-instruct-2507-q4_K_M through Ollama (id 0edcdef34593), temperature 0.7, seeds 1 to 3, on a 6 GB laptop GPU that other jobs were also using. Six UI tasks (`tasks/tasks.json`), each with a color and a font to use, three seeds, three runs:

- bare: the task, the design tokens and the list of files to write
- contract: the same, plus the rules above in plain words
- contract+feedback: each failing contract reply gets one more turn that sends the grader's findings back

A reply passes only if all 13 rules pass. Each run has 18 replies. The table is `results/qwen3-4b-instruct-2507/report.md`.

| run | passed | rate | 95% Wilson | per seed |
| --- | --- | --- | --- | --- |
| bare | 0/18 | 0.0% | 0.0% to 17.6% | 0/6, 0/6, 0/6 |
| contract | 0/18 | 0.0% | 0.0% to 17.6% | 0/6, 0/6, 0/6 |
| contract+feedback | 7/18 | 38.9% | 20.3% to 61.4% | 3/6, 2/6, 2/6 |

Replies that failed each rule:

| rule | bare | contract | contract+feedback |
| --- | --- | --- | --- |
| css-import-order | 18 | 0 | 0 |
| icon-names-exist | 0 | 6 | 4 |
| imports-resolve | 9 | 4 | 3 |
| named-exports | 18 | 18 | 7 |
| one-component-per-file | 0 | 2 | 1 |
| react-in-scope | 0 | 1 | 0 |

What I read in it:

- Putting the rules in the prompt did not make one reply pass, but it changed what failed. css-import-order went from 18 failures to 0. named-exports stayed at 18 of 18, although the prompt says never to use `export default`.
- icon-names-exist caught 13 imports of six names that lucide-react does not export (ClearIcon, ErrorIcon, SortIcon, SuccessIcon, TeamIcon, WarningIcon), in 6 contract replies. No bare reply imported from lucide-react at all, so that rule had nothing to check there; the 0 is not a better result.
- One repair turn took 7 of the 18 failing contract replies to a full pass. What remained after it: named-exports in 7 replies, icon-names-exist in 4, imports-resolve in 3, one-component-per-file in 1.
- `passk compare results/qwen3-4b-instruct-2507/trials.jsonl --a contract --b contract+feedback --k 1 --margin 0.05`, with [passk-compare](https://github.com/muhammad-musa-ml/passk-compare) at its public commit b50469b, gives pass^1 of 0.0000 for contract and 0.3889 for contract+feedback, a difference of 0.3889 with a 95% interval of 0.1111 to 0.6667, and the verdict `superior`. Its separate permutation check gives p = 0.1194. Six tasks is too few to lean on either.

How the numbers were made: `node run/experiment.mjs --model qwen3:4b-instruct-2507-q4_K_M --seeds 3 --out results/qwen3-4b-instruct-2507` asks the model only for replies that are not stored in `replies/`, so on this folder it regrades and rewrites `trials.jsonl` without a model; I checked that the file comes out byte for byte the same. First replies use a 4096-token window and stop at 3500 tokens, and repair turns use an 8192-token window. No stored reply was cut off. An earlier run capped replies at 2400 tokens and the repair window at 4096; those limits damaged two first replies and several repair replies, so I raised them and regenerated, and the numbers above are from the second run.

## What this does not show

- It does not grade design quality. Whether an output looks right is the part that needs a judge calibrated against human labels, and this repo has none.
- It reads syntax, not types or rendering. It does not run tsc, install packages or draw the page, so a file can pass all 13 rules and still fail to compile or render.
- The rules follow the published skill text, not Magic Patterns' own pipeline, which may check more or less.
- Icon names are checked against lucide-react 1.70.0. I do not know which version Magic Patterns pins, so a name added or removed between versions would be misjudged.
- named-exports reads "named exports only" broadly: it also fails a default export of plain data. runtime-stripped covers the six patterns listed, not tRPC, database or auth code. absolute-image-urls reads only `img` elements with a string `src`. css-vars-defined says nothing when the output imports a package stylesheet. imports-resolve does not check `@import` paths in CSS. token-coverage checks that a color or font name is present, not that it is applied to the right element.
- The experiment is one 4B model, six tasks of my own and three seeds, so the intervals are wide, and the repair is one turn.
