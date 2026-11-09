# react-output-graders

Deterministic graders for the React and Tailwind files a UI agent writes, and a runner that scores a local model with them. I am not affiliated with Magic Patterns and have no access to their agent, their evals or their data.

## Why

The rules come from Magic Patterns' public `recreate-as-react` skill (magicpatterns/agent-plugins) and from a Langfuse customer story about their pipeline that lists three things the model gets wrong: invented icon names, conflicting libraries and forgotten React imports. I wanted to see how much of "does this output follow the contract" a script can grade without a model judge, and whether the findings are good enough to send back to the model. This repo grades the first and the third of those three. Conflicting libraries is not graded.

## Run it

```
npm ci
npm test
node src/cli.mjs fixtures/good --spec fixtures/good.spec.json
```

`src/cli.mjs <folder>` grades a folder, prints one line per rule with file and line, and exits 0 (pass), 1 (fail) or 2 (nothing was graded: no such folder, no source files, or a `--spec` file that is missing or is not JSON). `--spec` also takes the form `--spec=path`, and a spec that lists no colors and no fonts exits 2 as well. `--json` prints the whole result. A rule that needs a spec and gets none is printed as `skip` and counted, never reported as a pass.

`node run/inspect.mjs <reply.json> <task id>` prints the findings for one stored reply. `node scripts/mutate.mjs` copies the repo to a temp folder, breaks 206 guards one at a time and requires the tests to fail for each; it takes more than ten minutes.

## The rules

| rule | what it checks | where it comes from |
| --- | --- | --- |
| required-files | App.tsx, index.tsx, index.css and tailwind.config.js exist | skill, Output contract |
| syntax | every .ts, .tsx, .js, .jsx, .mjs and .cjs file parses | skill, Where this runs (the code must compile; syntax only here) |
| named-exports | no default export, in any of its three forms | skill, Where this runs |
| no-any | no `any` type, read from the syntax tree, so the word in text or a comment does not count | skill, Where this runs |
| one-component-per-file | at most one component: a capitalised function (an unnamed default export too), class (its `render` method or arrow) or memo/forwardRef wrapper, at any depth, that returns JSX: a return statement of its own, or an arrow's expression body, with JSX in it (so `items.map((i) => <li />)` and `createPortal(<div />, body)` count), or a local variable that was set to JSX. A function that builds JSX and hands it to another function without returning it, such as the statement `toast.custom(<span />)`, is not one; `return toast.custom(<span />)` is counted | skill, Where this runs |
| react-in-scope | a hook (14 names) is called, `React.x` or `ReactDOM.x` is used, or a JSX tag is used, and nothing in the file imports or declares that name. As in TypeScript, a tag that starts with a lower-case letter or has a hyphen is an HTML element and needs no name; for a dotted tag the root is checked (`motion` in `<motion.div />`) | Langfuse story; the tag and `ReactDOM` checks are mine |
| runtime-stripped | no fetch (also `window.fetch`), axios, XMLHttpRequest, `process.env`, `import.meta.env`, `'use server'` or `next/*` | skill, Step 3 names fetch, axios, server actions and environment variables; XMLHttpRequest and `next/*` (the skill says only "never next/font") are my additions |
| absolute-image-urls | an `img` src written as a string is an absolute URL (or `data:`) | skill, Where this runs |
| imports-resolve | a relative import names a file in the output and, when that file is code, a name it exports: a default import needs a default export, a named import needs that name, types and interfaces count. `./name.js` also finds `name.ts` or `name.tsx`. A path alias (`@/`, `~/`, `#/`) or a `node:` module fails, and `tailwind.config.js` is not read as a source. A package is one the skills name or one a package.json in the output declares | skill, Where this runs ("the code must compile") |
| icon-names-exist | every name imported from lucide-react is exported by lucide-react 1.70.0 | Langfuse story |
| css-import-order | font imports, then the three tailwindcss imports in order, then other imports. A remote stylesheet whose address the rule does not read as a font (Google, gstatic and Bunny font hosts, Typekit, Font Awesome, a `family=` query, a font file extension) may come first or last, not between. The `@tailwind base;` directive form fails on purpose, because the skill writes `@import 'tailwindcss/base'` | skill, Output contract |
| css-vars-defined | a `var(--x)` with no fallback has a definition; Tailwind's own `--tw-*` variables are exempt | skill, Step 2 |
| token-coverage | each color a spec lists appears in a css or code file, and each font in `index.css` or `tailwind.config.js` | skill, Fidelity checklist; Step 4 allows a font in either file |

How the rules read files: named-exports, no-any and one-component-per-file read `.ts` and `.tsx`; runtime-stripped, react-in-scope and absolute-image-urls read `.ts`, `.tsx` and `.jsx`; syntax, imports-resolve and icon-names-exist read `.js`, `.mjs` and `.cjs` too. react-in-scope does not work out scopes: a name declared anywhere in the file counts as bound. imports-resolve reads import declarations, `export ... from`, `import x = require()`, `require()` and `import()` for paths, but checks names only on import declarations, and says nothing about a target that has `export *`, `export =` or CommonJS exports (a file with no ES export that writes to `module.exports` or `exports`), or that is CSS or JSON. The packages it accepts are react, react-dom, lucide-react, react-router-dom, sonner, recharts, @xyflow/react and leaflet from `recreate-as-react`, @magicpatterns/cubed and @radix-ui/themes from its Step 2, and framer-motion from the `integrate-magic-patterns-design` skill.

## An experiment

One local model, qwen3:4b-instruct-2507-q4_K_M through Ollama (id 0edcdef34593), temperature 0.7, top_p 0.9, seeds 1 to 3, on a 6 GB laptop GPU that other jobs were also using. Six UI tasks (`tasks/tasks.json`), each with a color and a font to use, three seeds, three setups:

- bare: the task, the design tokens and the list of files to write
- contract: the same, plus ten rules in plain words, which are my paraphrase of the skill and the Langfuse story. They do not mention `import.meta.env`, `'use server'` or XMLHttpRequest, do not say that an import must name something the file exports (the skill says only that the code must compile), and do not say that JSX tags and `ReactDOM` need imports.
- contract+feedback: each failing contract reply gets one more turn that sends the grader's findings back

A reply passes only if all 13 rules pass. Each setup has 18 replies, six tasks times three seeds. The table is `results/qwen3-4b-instruct-2507/report.md`.

| run | passed | rate | 95% Wilson | per seed |
| --- | --- | --- | --- | --- |
| bare | 0/18 | 0.0% | 0.0% to 17.6% | 0/6, 0/6, 0/6 |
| contract | 0/18 | 0.0% | 0.0% to 17.6% | 0/6, 0/6, 0/6 |
| contract+feedback | 0/18 | 0.0% | 0.0% to 17.6% | 0/6, 0/6, 0/6 |

Replies that failed each rule:

| rule | bare | contract | contract+feedback |
| --- | --- | --- | --- |
| css-import-order | 18 | 0 | 0 |
| icon-names-exist | 0 | 6 | 3 |
| imports-resolve | 12 | 6 | 13 |
| named-exports | 18 | 18 | 8 |
| one-component-per-file | 0 | 2 | 0 |
| react-in-scope | 5 | 3 | 9 |

Failed rules per reply, mean: bare 2.94, contract 1.94, contract+feedback 1.83.

What I read in it:

- No reply in any setup passed all 13 rules. Putting the rules in the prompt did not make one reply pass, but it changed what failed: css-import-order went from 18 failures to 0 and the mean number of failed rules per reply from 2.94 to 1.94. named-exports stayed at 18 of 18, although the prompt says never to use `export default`.
- icon-names-exist caught 13 imports of six names that lucide-react does not export (ClearIcon, ErrorIcon, SortIcon, SuccessIcon, TeamIcon, WarningIcon), in 6 contract replies. No bare reply imported from lucide-react at all, so that rule had nothing to check there; the 0 is not a better result.
- The repair turn fixed none of the 18 failing contract replies. It moved the failures: named-exports fell from 18 replies to 8, icon-names-exist from 6 to 3 and one-component-per-file from 2 to 0, while imports-resolve rose from 6 to 13 and react-in-scope from 3 to 9, so the mean went only from 1.94 to 1.83. 13 repaired replies import a default from a file that has none. In 11 of them the file is `App.tsx`, and in 10 of those 11 the contract reply's `App.tsx` had a default export that the repair removed while `index.tsx` kept `import App from './App'`. 9 repaired replies use `ReactDOM` without importing it, against 1 contract reply.
- `passk compare results/qwen3-4b-instruct-2507/trials.jsonl --a contract --b contract+feedback --k 1 --margin 0.05`, with [passk-compare](https://github.com/muhammad-musa-ml/passk-compare) at its public commit b50469b, is stored in `results/qwen3-4b-instruct-2507/passk-compare.txt`. Both runs have a pass^1 of 0.0000 with an interval of 0.0000 to 0.0000, and the verdict is `non_inferior`. That tells you nothing about the repair: with no trial passing in either run, the bootstrap has nothing to resample.

How the numbers were made: `node run/experiment.mjs --model qwen3:4b-instruct-2507-q4_K_M --seeds 3 --out results/qwen3-4b-instruct-2507` asks the model only for replies that are not stored in `replies/`, so on this folder it regrades and rewrites `trials.jsonl` without a model; I checked that the file comes out byte for byte the same. `node run/report.mjs results/qwen3-4b-instruct-2507` turns `trials.jsonl` into `report.md`.

An earlier version of these graders passed 7 of the 18 repaired replies, although in all 7 `index.tsx` imported `App` as a default from a file that only has a named export (and in 5 it used `ReactDOM` without importing it). I fixed the rules and deleted and regenerated the 18 repair replies, since their prompts carry the findings; the numbers above are from that run. Of the 18 regenerated repair replies, 10 have the same text as the reply they replaced. In 5 the text differs although the prompt has the same token count, so a fixed seed did not reproduce those replies here; in the other 3 the prompt itself had changed, because the fixed graders gave different findings. The stored replies, not the seed, are the record. The 36 first replies are unchanged, and the settings they were written under differ, which the files and the history of `run/ollama.mjs` show:

- 15 first replies, written first, record only text, tokens, seconds and the done reason. They come from the first version of the runner: window 8192 tokens, cap 3500 tokens.
- 19 more also record `promptTokens`. They come from the next version: window 4096, cap 2400.
- 2 first replies (bare settings-sidebar seed 3 and contract stats-dashboard seed 2) were regenerated with the current runner, window 4096, cap 3500, and record `numCtx`.
- The 18 repair replies all record `numCtx` 8192, with the current cap of 3500, because a repair turn sends the first prompt and reply back.

All 54 replies ended with the done reason `stop`, so none was cut at the cap. The largest first reply has 2339 generated tokens, and the largest prompt plus reply I can see is 5062 tokens against an 8192 window.

## What this does not show

- It does not grade design quality. Whether an output looks right is the part that needs a judge calibrated against human labels, and this repo has none.
- It reads syntax, not types or rendering. It does not run tsc, install packages or draw the page, so a file can pass all 13 rules and still fail to compile or render.
- The rules follow the published skill text, not Magic Patterns' own pipeline, which may check more or less.
- Icon names are checked against lucide-react 1.70.0. I do not know which version Magic Patterns pins, so a name added or removed between versions would be misjudged.
- named-exports reads "named exports only" broadly: it also fails a default export of plain data. runtime-stripped covers the seven patterns listed, not tRPC, database or auth code. one-component-per-file does not follow a call into the function it calls: a function that returns `renderRows()`, or a variable set to such a call, is not counted, and a name that does not start with a capital letter is never a component. absolute-image-urls reads only `img` elements with a string `src`. css-vars-defined says nothing when the output imports a package stylesheet. imports-resolve does not check `@import` paths in CSS, or the names in a re-export or a `require`. token-coverage checks that a color or font name is present, not that it is applied to the right element.
- The experiment is one 4B model, six tasks of my own and three seeds. The Wilson intervals treat the 18 replies of a setup as independent, but the three seeds of a task share a prompt, so they are not, and the intervals are narrower than they should be. With 0 of 18 in every setup, all the experiment can say is that the pass rate of each setup could be as high as about 18%. The repair is one turn.
