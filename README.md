# Cairo Astronomy Engine

Standalone Cairo astronomy-engine workspace with a JavaScript oracle and parity harness.

## Repository Layout

- `cairo/`: active Cairo workspace for the astronomy engine, API surface, and eval runner
- `astro/`: TypeScript oracle, corpus generation, mismatch analysis, and parity evaluation tooling
- `spec/`: retained engine-facing design notes and chart-construction references

## Scope

This repository focuses on deterministic chart-computation infrastructure:

- astronomy-engine parity work
- time/frame/transform correctness
- seven-body longitude computation
- ascendant computation
- sign-level chart derivation and evaluation

Game, NFT, client, and presentation-layer material from the earlier import has been removed.

## Key Docs

- [`cairo/README.md`](./cairo/README.md)
- [`cairo/crates/README.md`](./cairo/crates/README.md)
- [`spec/CHART.md`](./spec/CHART.md)
- [`spec/CHART_PLAN.md`](./spec/CHART_PLAN.md)
- [`spec/EVALS.md`](./spec/EVALS.md)
- [`spec/ASTROLOGY.md`](./spec/ASTROLOGY.md)

## Verification

From `astro/`:

```bash
npm test
```

From `cairo/`:

```bash
scarb test
```
