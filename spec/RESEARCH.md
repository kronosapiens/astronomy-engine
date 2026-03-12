# v5 Engine Research Context

This document is the persistent working context for improving `astronomy_engine_v5`.

## Primary Goal

- Achieve **>= 99.99% chart-level accuracy** in the `1001-3000` heavy evaluation window.
- At current heavy sampling density (`48,000` points for `1001-3000`), this means roughly **<= 5 chart fails**.

## Non-Negotiable Process Rules

- Never run more than **one heavy eval process at a time**.
- Before starting a new heavy eval, ensure no other heavy eval is running.
- Prefer smaller targeted windows for diagnostics; use full sweeps only for milestone checks.
- Keep this file updated as part of the work in every agent session.
- Keep the `# Research Notes` section current while working: log short-term actions, medium-term plan, and outcomes after each significant change.

# Research Notes

## Current Focus (2026-03-07)

- Move v5 planet apparent pipeline closer to upstream `astronomy-engine` semantics.
- Prioritize algorithm-stage parity over constant-precision tuning.
- Target first wins on Saturn/Jupiter cusp timing (highest current mismatch contributors).

## Short-Term Plan

1. Add explicit v5 parity toggles for:
   - extra explicit ecliptic aberration term (on/off)
   - frame-time sign handling in EQJ -> ecliptic-of-date conversion
2. Run deterministic A/B checks on:
   - `v5-heavy-planet-regression-corpus.ndjson`
   - existing hotspot windows (`3081-3140`, `3461-3500`)
3. Select the better semantic branch and keep only the winning behavior.
4. Record fail deltas (total + per-planet) here before moving to broader sweeps.

## Session Update (2026-03-07)

- Implemented parity toggles in `cairo/crates/astronomy_engine_v5/src/planets.cairo`:
  - `ENABLE_EXPLICIT_ECLIPTIC_ABERRATION_TERM`
  - `ECLIPTIC_FRAME_TIME_SIGN`
- A/B outcome: `ECLIPTIC_FRAME_TIME_SIGN=+1` caused systemic regression on corpus
  (`68/68` fail with large Sun-side failures), so this branch is rejected.
- Restoring `ECLIPTIC_FRAME_TIME_SIGN=-1` returns prior behavior on corpus:
  - `68/68` fail
  - per-planet fail counts match prior baseline (`Mercury 10`, `Venus 10`, `Mars 12`, `Jupiter 10`, `Saturn 26`).
- A/B outcome: toggling `ENABLE_EXPLICIT_ECLIPTIC_ABERRATION_TERM` produced no corpus change.
- Regional heavy checks (fast milestone sanity):
  - `3081-3100`: `464/480` pass (`16` fail; planet-only; Saturn-led)
  - `3101-3120`: `474/480` pass (`6` fail; planet-only)
  - `3121-3140`: `466/480` pass (`14` fail; planet-only)
  - `3461-3480`: `462/480` pass (`18` fail; planet-only; Saturn-led)
  - `3481-3500`: `458/480` pass (`22` fail; planet-only)
- Added mismatch-diagnostics plumbing:
  - `eval-cairo-engine --mismatch-log` rows now include `expectedSigns` and `actualSigns`.
  - mismatch rows now also include `actualLongitudes1e9` (Cairo) and `oracleLongitudesDeg`.
  - `analyze-mismatch-log --with-cusp` now emits:
    - signed cusp-side offset stats
    - signed sign-delta lead/lag stats + histogram
    - signed longitude-delta stats (Cairo - oracle)
- Smoke diagnostic (`3461-3462`, heavy, mismatch-log):
  - `44/48` pass, `4` fail
  - all mismatches were one-sign lag (`delta=-1`) on Jupiter/Saturn in this slice.
  - longitude drift in this slice is consistent and negative:
    - overall mean signed delta: `-0.137955°`
    - Jupiter mean signed delta: `-0.138517°`
    - Saturn mean signed delta: `-0.137392°`
- Broader diagnostic (`3461-3500`, heavy, mismatch-log):
  - `40` mismatch rows
  - signed sign delta is uniform lag: `40/40` at `delta=-1`
  - signed longitude delta is consistently negative:
    - overall mean signed delta: `-0.139186°` (all `40/40` within `<0.5°`)
    - Mercury: `-0.122256°` (`n=6`)
    - Venus: `-0.144987°` (`n=8`)
    - Mars: `-0.135666°` (`n=6`)
    - Jupiter: `-0.142106°` (`n=6`)
    - Saturn: `-0.143383°` (`n=14`)
- Added stage probe path:
  - Cairo/API debug probes for Mercury..Saturn EQJ vector + frame lon/lat:
    - `debug_planet_geocentric_eqj_pg_1e9`
    - `debug_planet_frame_lon_lat_pg_1e9`
    - eval runner function `eval_point_planet_debug_frame`
  - JS probe tool: `astro/src/cli/probe-v5-planet-frame.js`
- Probe snapshot (`3461-3462` mismatch rows):
  - frame lon delta remains at the same lag scale (`~ -0.138°`)
  - TT delta is near zero (`~1e-10` days)
  - EQJ vector deltas are small in absolute AU terms (`~1e-6 AU` order in dominant axis)
  - indicates the sign-lag is likely tied to frame/projection-side behavior (or coherent EQJ phase drift),
    not a gross light-time timestamp error.
- Full probe (`3461-3500` mismatch rows, `n=40`) confirms the same pattern:
  - mean frame lon delta by planet (deg):
    - Mercury `-0.122256`
    - Venus `-0.144987`
    - Mars `-0.135667`
    - Jupiter `-0.142106`
    - Saturn `-0.143383`
  - mean TT deltas remain negligible (`~1e-10` days scale)
  - mean absolute EQJ component deltas remain around `1e-6 AU` scale.
- Source-isolation split from probe (`3461-3500`, `n=40`):
  - total mean |lon delta|: `0.139186°`
  - EQJ-only contribution (projecting Cairo EQJ through upstream frame): `0.000055°`
  - frame-projection residual contribution: `0.139163°`
  - implication: mismatch is overwhelmingly in the frame-projection stage, not EQJ solve.
- Direct Cairo projection of **oracle EQJ** confirms the same:
  - projecting with `+tt` gives catastrophic mismatch (`~41.509°` mean abs lon delta)
  - projecting with `-tt` gives the observed residual (`~0.139163°` mean abs lon delta)
  - implication: v5 frame path currently requires `-tt` convention but still carries a stable
    ~`0.139°` projection bias.
- Tested a rounded frame-longitude substitution (`eqj_to_ecliptic_of_date_longitude_1e9_round`)
  in the no-aberration branch:
  - corpus outcome unchanged (`68/68` fail, identical per-planet breakdown)
  - reverted (no measurable improvement).
- Direct standard-vs-rounded frame projection test on **oracle EQJ** (`3461-3500` probe):
  - `+tt` path stays catastrophic for both standard and rounded (`~41.509°` mean abs lon delta)
  - `-tt` path gives the stable residual for both standard and rounded
    (`~0.139163°` mean abs lon delta)
  - rounded frame longitude does not materially reduce residual bias.
- Conclusion: this toggle pass improved branch clarity but did not reduce mismatch counts.
- Next action: focus directly on frame-projection internals (`frames.cairo`) since the probe split
  localizes almost all drift there. Priorities:
  - audit `eqj_to_ecliptic_of_date_lon_lat_1e9` math vs upstream rotation path
  - verify `atan2_deg_1e9`/trig-table interpolation bias under current ranges
  - run point-level frame A/B probes before touching the full planet pipeline again.

## Session Recovery Update (2026-03-07)

- Crash-recovery audit of live branch shows current `planets.cairo` has:
  - `ECLIPTIC_FRAME_TIME_SIGN = +1`
  - `ENABLE_EXPLICIT_ECLIPTIC_ABERRATION_TERM = false`
- Direct frame-projection sanity (single-point, low memory) confirms `frames.cairo` expects `+tt`:
  - For a unit EQJ vector at year 3461 TT, Cairo `eqj_to_ecliptic_of_date` with `+tt` matches
    upstream `Astronomy.Ecliptic` closely.
  - Using `-tt` is the catastrophic branch for direct frame projection.
- Corpus gate (deterministic, `68` points):
  - `v5-heavy-planet-regression-corpus.ndjson`: `68/68` pass, `0` fail.
- Hotspot smoke checks (bounded):
  - `3461`: `24/24` pass
  - `3462`: `24/24` pass
- Regional bounded heavy check (`3461-3500`, `batch-size=5`, `max-batch=128`):
  - All eight 5-year buckets are `120/120` pass (`0` fail each), i.e. `960/960` pass overall.
- Additional bounded checkpoint (`1001-1200`, `batch-size=5`, `max-batch=128`):
  - All forty 5-year buckets are `120/120` pass (`0` fail each), i.e. `4,800/4,800` pass overall.
- Heavy baseline regeneration started with `batch-size=20` (staged files):
  - `astro/evals/v5-heavy-baseline-1001-1100-20260307T180928Z.ndjson` (`5` rows, all pass)
  - `astro/evals/v5-heavy-baseline-1101-1200-20260307T180928Z.ndjson` (`5` rows, all pass)
  - Combined staged subtotal (`1001-1200`): `4,800/4,800` pass, `0` fail.
- Long unattended regeneration scaffolded (sequential, one heavy process at a time):
  - Script: `astro/evals/scripts/run_v5_heavy_baseline_full_20260307T180928Z.sh`
  - Planned order:
    1. `1201-4000` in 100-year slices (`batch-size=20`)
    2. `0001-1000` in 100-year slices (`batch-size=20`)
  - Master progress log: `astro/evals/logs/v5-heavy-baseline-full-20260307T180928Z.log`
  - First active output target: `astro/evals/v5-heavy-baseline-1201-1300-20260307T180928Z.ndjson`
- Completed staged full-range run (`stamp=20260307T180928Z`):
  - `1201-4000` followed by `0001-1000`, all 100-year slices completed.
  - Aggregate across `40` staged files: `96,000/96,000` pass, `0` fail (`0001-4000` heavy grid).
  - `1001-3000` rollup from staged files: `48,000/48,000` pass, `0` fail.
  - Marked partial file `astro/evals/v5-heavy-baseline-1001-3000-20260307T180928Z.ndjson` as aborted/ignore.

## Cleanup Update (2026-03-09)

- Production cleanup pass removed stale R&D toggles and dead branches:
  - Removed `ENABLE_EXPLICIT_ECLIPTIC_ABERRATION_TERM` toggle path from `v5` runtime.
  - Removed `ECLIPTIC_FRAME_TIME_SIGN` toggle and kept the winning production semantics (`obs_tt_1e9` directly).
  - Removed unused rounded frame-projection lane (`*_round`) and compare plumbing in API/eval-runner.
- Regression verification after cleanup:
  - `eval-mismatch-corpus`: `68/68` pass, `0` fail.
  - heavy sentinel windows (`batch-size=20`): `0001-0020`, `1001-1020`, `3981-4000` all `480/480` pass.
  - Cairo verification: `scarb build` for `astronomy_engine_v5`, `astronomy_engine_api`, `astronomy_engine_eval_runner` passed.
  - `scarb test -p astronomy_engine_v5`: `25` passed, `0` failed.
- Interpretation:
  - The earlier `~0.139°` lag narrative in this file is stale relative to the current live branch.
  - Current branch behavior indicates the `+tt` frame-time convention is the winning branch.
- RAM-safe continuation loop:
  1. Keep all exploratory runs bounded with `--batch-size 1..5` and `--max-batch 64..128`.
  2. Use corpus eval first as the deterministic gate.
  3. Use 20-40 year regional heavy windows only after corpus stays green.

## Medium-Term Plan

1. Add stage-level diagnostics around mismatch points:
   - post-light-time geocentric EQJ vector
   - post-frame ecliptic lon/lat
2. Use those diagnostics to isolate residual drift source:
   - light-time solve semantics
   - frame-time usage
   - projection/rounding near cusps
3. After stage-parity stabilization, run regional heavy windows in 20-100 year slices, then milestone `1001-3000` heavy.
4. Keep a rolling list here of validated parity decisions and reverted dead-end experiments.

## Current Evaluation Pipeline

## Core runner

- Script: `astro/src/cli/eval-cairo-engine.js`
- Key flags:
  - `--profile heavy|light`
  - `--start-year <inclusive>`
  - `--end-year <inclusive>`
  - `--batch-size <years>`
  - `--max-batch <points per batch guard>`
  - `--mismatch-log <path>` (slow path; logs only failed points)

## Current output row format

Each summary row is year-range scoped (no batch index), e.g.:

```json
{"tsUtc":"...","engine":"v5","profile":"heavy","yearStart":1001,"yearEnd":1020,"passCount":476,"failCount":4,"planetFailCount":4,"ascFailCount":0,"sunFailCount":0,"moonFailCount":0,"mercuryFailCount":0,"venusFailCount":0,"marsFailCount":0,"jupiterFailCount":0,"saturnFailCount":4,"elapsedMs":...}
```

## Analyzer / corpus tools

- `astro/src/cli/analyze-mismatch-log.js`
  - Aggregates masks, planets, locations, year buckets.
  - `--with-cusp` computes distance to nearest sign boundary for mismatched planet bits.
- `astro/src/cli/build-mismatch-corpus.js`
  - Builds deduplicated regression corpus from mismatch logs.
- `astro/src/cli/eval-mismatch-corpus.js`
  - Deterministic gate over corpus; reports total + per-planet fails and failed point masks.

## Useful commands

```bash
# Fast regional profiling (preferred default)
node astro/src/cli/eval-cairo-engine.js --profile heavy --engine v5 --start-year 2801 --end-year 3200 --batch-size 20 --quiet

# Targeted mismatch details (slow)
node astro/src/cli/eval-cairo-engine.js --profile heavy --engine v5 --start-year 3461 --end-year 3500 --batch-size 20 --mismatch-log astro/evals/v5-heavy-mismatches-3461-3500.ndjson --quiet

# Analyze mismatch file
node astro/src/cli/analyze-mismatch-log.js --in astro/evals/v5-heavy-mismatches-3461-3500.ndjson --out-prefix astro/evals/v5-heavy-mismatches-3461-3500-summary --year-bucket 20 --with-cusp

# Build mismatch corpus
node astro/src/cli/build-mismatch-corpus.js --in astro/evals/v5-heavy-mismatches-1001-3000.ndjson,astro/evals/v5-heavy-mismatches-3461-3500.ndjson --out astro/evals/v5-heavy-planet-regression-corpus.ndjson

# Evaluate mismatch corpus
node astro/src/cli/eval-mismatch-corpus.js --corpus astro/evals/v5-heavy-planet-regression-corpus.ndjson --out astro/evals/v5-heavy-planet-regression-corpus-eval.json
```

## Baseline Results (So Far)

- Full `1-4000` heavy: `94,640` pass / `1,360` fail => `98.5833%`.
- `1001-3000` heavy: `47,814` pass / `186` fail => `99.6125%`.
- `1900-2100` heavy: `4,814` pass / `10` fail => `99.7927%`.

## Observed Failure Pattern

- In sampled hotspot windows, **ascendant fails are zero**.
- Current misses are planet-side and clustered near sign cusps.
- Combined mismatch analysis (`84` sampled rows):
  - Planet contributions: Saturn `32`, Mercury `14`, Jupiter `14`, Venus `12`, Mars `12`.
  - Cusp distance: `76/84` within `0.1°`, `84/84` within `0.5°`.
  - Strong indication: mostly **boundary timing/parity drift**, not large absolute-position failure.

## Approaches Tried and Outcome

1. Added split counters (`planetFailCount`, `ascFailCount`, per-planet counts)
- Outcome: successful; major visibility improvement.

2. Added full mismatch logging (`--mismatch-log`) with per-point masks
- Outcome: successful but slow on wide windows; useful only for targeted slices.

3. Added mismatch analyzer and cusp-distance mode
- Outcome: successful; showed cusp-edge dominance.

4. Added mismatch regression corpus and corpus evaluator
- Outcome: successful; enables deterministic gating.

5. Time-scale rounding tweak in v5 planet path (`T` conversion rounding)
- Outcome: no measurable fail reduction in hotspot A/B checks.

6. Started apparent-correction parity work (annual-aberration style correction + lon/lat helper)
- Status: in progress; requires follow-up validation and likely deeper upstream-parity alignment.

## Recommended Next Work

1. Continue apparent-position parity work for planets (especially Saturn/Jupiter path).
2. Use mismatch logs only on 20-100 year hotspot slices.
3. Gate each change on:
   - regional heavy summaries (fast)
   - mismatch corpus eval (deterministic)
4. Update this document after each significant change:
   - what changed
   - windows tested
   - before/after fail deltas (total + per-planet)
   - conclusion and next action.
