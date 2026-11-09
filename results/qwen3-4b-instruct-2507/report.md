| run | passed | rate | 95% Wilson | per seed |
| --- | --- | --- | --- | --- |
| bare | 0/18 | 0.0% | 0.0% to 17.6% | 0/6, 0/6, 0/6 |
| contract | 0/18 | 0.0% | 0.0% to 17.6% | 0/6, 0/6, 0/6 |
| contract+feedback | 0/18 | 0.0% | 0.0% to 17.6% | 0/6, 0/6, 0/6 |

Trials that failed each rule:

| rule | bare | contract | contract+feedback |
| --- | --- | --- | --- |
| css-import-order | 18 | 0 | 0 |
| icon-names-exist | 0 | 6 | 3 |
| imports-resolve | 12 | 6 | 13 |
| named-exports | 18 | 18 | 8 |
| one-component-per-file | 0 | 2 | 0 |
| react-in-scope | 5 | 3 | 9 |

Failed rules per reply, mean: bare 2.94, contract 1.94, contract+feedback 1.83.

Repair turn: 0 of 18 failing contract replies passed every rule after one round of the grader's findings.

Replies cut off at the length limit or the context window: bare 0, contract 0, contract+feedback 0.
