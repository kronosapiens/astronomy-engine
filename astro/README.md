# `astro` package

Oracle and evaluation tooling for the Cairo astronomy-engine workspace.

- Active: `astronomy-engine` wrappers, corpus generation, mismatch analysis, and Cairo parity tooling.
- Legacy: older archive/Chebyshev/parity experiments under `src/legacy/`.

## CLI

Build sign-level oracle corpus (7 planets + ascendant sign):

```bash
npm run build:sign-corpus -- \
  --start 2026-01-01T00:00:00Z \
  --end 2026-01-02T00:00:00Z \
  --step-minutes 60 \
  --lat-bins 377 \
  --lon-bins -1224 \
  --out results/corpus/2026.sign-corpus.json
```

Evaluate Cairo v5 runner:

```bash
npm run eval:light
npm run eval:heavy
```

Run resumable random evaluation with chunk summaries and cursor state:

```bash
node src/cli/eval-random-cairo-engine.js \
  --engine v5 \
  --points 100000 \
  --seed 20260310 \
  --include-passes false \
  --summary-file evals/v5-random-summary.ndjson \
  --state-file evals/v5-random-state.json \
  --mismatch-file evals/v5-random-mismatches.ndjson
```

Resume the same run later:

```bash
node src/cli/eval-random-cairo-engine.js \
  --engine v5 \
  --points 100000 \
  --seed 20260310 \
  --include-passes false \
  --summary-file evals/v5-random-summary.ndjson \
  --state-file evals/v5-random-state.json \
  --mismatch-file evals/v5-random-mismatches.ndjson \
  --resume true
```

Compare generated Cairo v5 tests against oracle signs:

```bash
node ../cairo/scripts/compare-v5-chart-parity.js \
  --start 2026-01-01T00:00:00Z \
  --end 2026-01-02T00:00:00Z
```

Legacy scripts remain available via `npm run legacy:*`.
