# Astronomy Engine Evaluation Spec

This document defines how astronomy-engine correctness is measured in this repository.

Its purpose is to make evaluation work:

- reproducible
- composable
- resumable
- useful for diagnosis, not just pass/fail reporting

This spec is a reference for `astro/` tooling, Cairo eval runners, and any future CI or milestone gates.

---

## 1. Principles

### 1.1 Upstream Fidelity First

The primary goal of evaluation is to measure fidelity to the upstream `astronomy-engine` computational pipeline.

Evaluation should prefer:

- algorithm-stage parity
- transform/time-scale correctness
- broad-range validation
- deterministic regression gates

Evaluation should not optimize for:

- narrow benchmark-window wins
- hand-tuned spot corrections
- silent benchmark exclusions

### 1.2 Observability Is Part of Correctness Work

A long-running evaluation that produces no progress signal is operationally weak, even if its final result is technically correct.

All substantial eval harnesses should emit enough information to answer:

- what is running
- how far it has progressed
- whether it can be resumed
- what exact configuration produced the result

This requirement applies to the operational surface of the harness, not to the scientific meaning of any single result row.

Progress/cursor metadata may describe the state of a particular process.
Result rows must remain valid and reusable even if the originating process is interrupted, resumed, split into multiple smaller runs, or never emits a final "done" event.

### 1.3 Determinism

All evaluation modes must be deterministic from explicit inputs:

- engine version
- date range
- location set
- seed
- sample count
- batch/chunk size
- oracle definition

If a run cannot be reproduced from its recorded inputs, it is not a valid baseline artifact.

---

## 2. Evaluation Layers

We use multiple layers of evaluation. No single layer is sufficient by itself.

### 2.1 Unit Tests

Purpose:

- validate arithmetic primitives
- validate time conversions
- validate transform helpers
- validate fixed regression snapshots

Examples:

- `scarb test`
- `node --test`

These should be fast and local.

### 2.2 Corpus Gates

Purpose:

- enforce deterministic regression checks on known-hotspot points
- catch reintroductions of previously fixed failures

Properties:

- small enough to run frequently
- fixed inputs
- zero ambiguity about expected outputs

Corpus gates are the first hard correctness gate after local code changes.

### 2.3 Structured Window Sweeps

Purpose:

- measure engine behavior over bounded year windows and fixed location sets
- support milestone reporting
- compare versions under controlled sampling density

Examples:

- `eval-light`
- `eval-heavy`

These runs produce summary rows by year window and are used for milestone baselines.

### 2.4 Random Differential Evaluation

Purpose:

- probe for unexpected failures outside curated corpora
- sample across broad temporal and geographic ranges
- stress the engine against varied conditions

Random evaluation is exploratory coverage, not a substitute for deterministic corpus gates.

Because these runs can be long, they must support:

- chunk-level progress summaries
- durable cursor/state files
- resumability
- mismatch detail artifacts separate from summary artifacts

### 2.5 Diagnostic Mismatch Analysis

Purpose:

- explain failures, not just count them
- localize drift by planet, region, year bucket, or cusp distance

Examples:

- mismatch logs
- mismatch corpus generation
- point-level detail probes
- frame/planet debug probes

This layer is for root-cause analysis after failures are discovered elsewhere.

---

## 3. Oracle Policy

### 3.1 Primary Oracle

The primary correctness oracle is the TypeScript `astronomy-engine` package used in `astro/`.

### 3.2 Secondary Cross-Checks

Other implementations may be used only as secondary references when diagnosing ambiguity.

They must not silently replace the primary oracle in reporting.

### 3.3 Expected Output Domain

The current primary correctness domain is sign-level output for:

- Sun
- Moon
- Mercury
- Venus
- Mars
- Jupiter
- Saturn
- Ascendant

Unless explicitly stated otherwise, evaluation refers to exact sign equality against the oracle.

---

## 4. Evaluation Modes

## 4.1 Light Eval

Purpose:

- fast sanity gate
- developer-loop validation

Requirements:

- deterministic
- bounded runtime
- representative multi-era coverage

Use:

- before and after targeted fixes
- before broader heavy runs

## 4.2 Heavy Eval

Purpose:

- milestone baseline
- broad structured coverage across large date ranges

Requirements:

- deterministic year-window summaries
- explicit engine/profile/date-range metadata
- one heavy run at a time

Operational rule:

- do not run multiple heavy eval processes concurrently in the same workspace

## 4.3 Random Eval

Purpose:

- wide exploratory coverage
- long unattended validation

Requirements:

- deterministic sample generation from `(seed, sampleIndex)`
- chunk summaries
- resumable state file
- optional mismatch detail file

Random eval must be composable:

- a chunk can be rerun independently
- a run can be resumed from a saved cursor
- outputs can be merged or analyzed without reinterpreting raw console logs

---

## 5. Output Contracts

Output artifacts should be append-only NDJSON or stable JSON state files.

Every entry in these output files should be a stand-alone piece of data.
It should be possible to aggregate, splice, recombine outputs accurately, using only the data stored on the NDJSON entries.

It should also be possible to scan a results file, determine gaps in coverage, and run the evaluation script only to fill those gaps.
We must never require a job to run to completion for the intermediate results to be valid, and should assume that long-running evaluation jobs may be killed at any time.

This is the primary rule for NDJSON artifacts:

- every result row must be self-contained and process-boundary-independent

In practice, that means a row must not depend on:

- a final completion marker
- cumulative totals from prior rows
- a separate state file
- assumptions about whether the run was executed as one job or many jobs

### 5.1 Summary Rows

Long-running evals should emit summary rows at chunk or window granularity.

Minimum fields:

- `type`
- `engine`
- `seed` or date-window identity
- `chunkStart` / `chunkEnd` or `yearStart` / `yearEnd`
- `pointCount`
- `failCount`
- per-planet fail counters where relevant
- elapsed time
- timestamp

Summary rows may include operational metadata such as cumulative progress, but such fields are optional and must not be required to interpret the row.

### 5.2 Mismatch Rows

Mismatch rows should be point-specific and diagnostic.

Minimum fields:

- `sampleIndex` or equivalent point identity
- timestamp/date components
- `latBin`
- `lonBin`
- expected signs
- actual signs
- mismatch mask

Recommended fields:

- actual longitudes
- year bucket
- latitude stratum

### 5.3 State Files

Resumable evals should persist state after each completed chunk.

Minimum fields:

- state format version
- full run config
- `nextChunkStart`
- processed point count
- completed chunk count
- cumulative mismatch count
- `completed`
- timestamps

State files are operational aids only.
They may help a process resume efficiently, but they must not be required to interpret, trust, splice, or merge NDJSON result rows.
---

## 6. Pass/Fail Semantics

### 6.1 Corpus Gate

Corpus gates are strict.

Default expectation:

- `0` sign mismatches

If a corpus gate fails, the engine is not baseline-clean.

### 6.2 Light and Heavy Structured Sweeps

These are used both as hard gates and as measurement tools.

For milestone baselines, report:

- total pass/fail counts
- per-body fail counts
- date window
- sampling density
- location set

### 6.3 Random Eval

Random eval is primarily a discovery mechanism.

Its result should be interpreted as:

- `0` mismatches: no discovered failures in sampled space
- `>0` mismatches: at least one discovered counterexample, requiring triage

Random eval should not hide discovered mismatches behind aggregate percentages alone.

---

## 7. Operational Rules

### 7.1 Preserve One-Command Reproducibility

Any reported eval artifact should be reproducible from a single documented command plus its versioned inputs.

### 7.2 Prefer Bounded Diagnostics Before Full Sweeps

When debugging:

- use mismatch corpora first
- then hotspot windows
- then broader heavy sweeps

Do not default to full-range heavy reruns for every hypothesis.

### 7.3 Separate Summary From Detail

Do not mix progress reporting and mismatch detail into a single hard-to-parse stream.

Preferred pattern:

- summary NDJSON
- mismatch NDJSON
- state JSON

### 7.4 Make Interrupted Runs Useful

If a run is stopped midway, the partial outputs should still answer:

- what chunks completed
- how many points were processed
- whether mismatches were found
- where to resume

That information should be derivable from the emitted rows themselves, not from the existence of a special terminal row.

### 7.5 Record Configuration Explicitly

The output location alone is not enough.

Every resumable or long-running eval must record:

- engine
- seed
- point count
- year range
- include-passes mode
- chunk size

---

## 8. Current Repository Mapping

Current tooling in this repository maps to this spec as follows:

- `astro/src/cli/eval-cairo-engine.js`
  - structured light/heavy window sweeps
- `astro/src/cli/eval-random-cairo-engine.js`
  - resumable random evaluation with chunk summaries, state, and mismatch artifacts
- `astro/src/cli/eval-mismatch-corpus.js`
  - deterministic regression corpus gate
- `astro/src/cli/build-mismatch-corpus.js`
  - corpus construction from discovered failures
- `astro/src/cli/analyze-mismatch-log.js`
  - mismatch aggregation and diagnostic reporting
- `cairo/scripts/compare-v5-chart-parity.js`
  - targeted parity checks against oracle-generated expectations

---

## 9. Recommended Workflow

For most engine changes:

1. Run local unit tests.
2. Run corpus gate.
3. Run light eval.
4. Run targeted hotspot or mismatch-window checks if needed.
5. Run heavy or random eval only when the earlier gates are clean or when doing milestone measurement.

For long unattended validation:

1. Start random or heavy evaluation with explicit artifact paths.
2. Ensure chunk/window summaries are being written early.
3. Confirm state/cursor artifacts are updating.
4. Resume rather than restart when interrupted.
5. Treat the run as complete only if a completion marker is present.

---

## 10. Future Extensions

Likely future additions:

- CI-specific reduced eval profile
- standardized artifact naming convention
- machine-readable manifest for milestone baselines
- chunk-merging utilities for distributed or multi-session runs
- explicit stage-level diagnostic schema for vector/frame drift analysis

Until then, new eval tooling should conform to the principles in this document rather than inventing ad hoc output formats.
