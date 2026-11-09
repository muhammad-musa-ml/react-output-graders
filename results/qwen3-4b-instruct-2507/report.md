| run | passed | rate | 95% Wilson | per seed |
| --- | --- | --- | --- | --- |
| bare | 0/18 | 0.0% | 0.0% to 17.6% | 0/6, 0/6, 0/6 |
| contract | 0/18 | 0.0% | 0.0% to 17.6% | 0/6, 0/6, 0/6 |
| contract+feedback | 7/18 | 38.9% | 20.3% to 61.4% | 3/6, 2/6, 2/6 |

Trials that failed each rule:

| rule | bare | contract | contract+feedback |
| --- | --- | --- | --- |
| css-import-order | 18 | 0 | 0 |
| icon-names-exist | 0 | 6 | 4 |
| imports-resolve | 9 | 4 | 3 |
| named-exports | 18 | 18 | 7 |
| one-component-per-file | 0 | 2 | 1 |
| react-in-scope | 0 | 1 | 0 |

Repair turn: 7 of 18 failing contract replies passed every rule after one round of the grader's findings.

Replies cut off at the length limit or the context window: bare 0, contract 0, contract+feedback 0.
