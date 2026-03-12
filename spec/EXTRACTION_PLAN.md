# Astronomy Engine Standalone Extraction Implementation Plan

## Overview
This plan converts the imported `SpacePrince` repository into a standalone Cairo astronomy-engine repository. The target state keeps the Cairo workspace, the TypeScript oracle/evaluation tooling, and only the specs/docs that still describe chart construction or astronomy-engine parity work.

## Goals
- Remove all game/client/product-specific material from the repository.
- Preserve the active Cairo astronomy-engine workspace and its supporting oracle/eval tooling.
- Rewrite repo-facing docs and metadata so the project reads as a standalone astronomy-engine project.
- Keep only spec material that still informs engine implementation or validation.

## Non-Goals
- Reorganizing the Cairo crate architecture beyond cleanup needed for extraction.
- Tuning or changing astronomy algorithms as part of the cleanup.
- Preserving historical SpacePrince design, lore, NFT, client, or gameplay documentation.

## Assumptions and Constraints
- `astro/` remains because it is the active oracle/parity/evaluation harness for Cairo work.
- `cairo/` remains as the primary implementation workspace.
- Historical engine versions under `cairo/crates/astronomy_engine_v1` through `v5` are worth preserving because they document the parity track.
- `spec/CHART.md` and `spec/CHART_PLAN.md` are directly relevant and should remain.
- `spec/ASTROLOGY.md` and `spec/v1/CONTRACTS.md` may be worth keeping only if you still want astrology-domain reference material in this repo; they are not required for the core engine itself.
- Destructive deletion should happen only after the keep list is confirmed.

## Requirements

### Functional
- Delete SpacePrince game/client assets and docs.
- Update root docs and package metadata to remove SpacePrince naming.
- Ensure remaining scripts, manifests, and READMEs refer to astronomy-engine work only.
- Leave the repo in a buildable/testable state for the retained engine/tooling.

### Non-Functional
- Preserve current astronomy parity artifacts unless explicitly trimmed later.
- Avoid deleting engine-facing reference material accidentally.
- Keep the cleanup easy to review by separating deletion, doc rewrite, and verification.

## Technical Design

### Data Model
No schema or contract-state changes are required. This is a repository composition cleanup:

- Keep:
  - `astro/`
  - `cairo/`
  - selected `spec/`
  - `AGENTS.md`
  - root `.gitignore`
- Delete:
  - `client/`
  - `img/`
  - game/product-facing `spec/` files
  - root `README.md` contents that describe SpacePrince

### API Design
No external API changes. CLI/script names may stay as-is initially, but package metadata and documentation should be renamed away from SpacePrince.

### Architecture
Post-cleanup repo shape:

```text
/
  AGENTS.md
  README.md
  PLAN.md
  astro/
  cairo/
  spec/
    CHART.md
    CHART_PLAN.md
    [optional domain refs]
```

### UX Flow (if applicable)
Not applicable.

---

## Implementation Plan

### Serial Dependencies (Must Complete First)

These tasks create foundations that other work depends on. Complete in order.

#### Phase 0: Confirm Retention Boundaries
**Prerequisite for:** All subsequent phases

| Task | Description | Output |
|------|-------------|--------|
| 0.1 | Confirm the final keep list for `spec/` and any historical artifacts. | Locked deletion scope |
| 0.2 | Snapshot current repo state with `git status` and repo tree review. | Safe starting point |

---

### Parallel Workstreams

These workstreams can be executed independently after Phase 0.

#### Workstream A: Remove SpacePrince Surface Area
**Dependencies:** Phase 0
**Can parallelize with:** Workstreams B, C

| Task | Description | Output |
|------|-------------|--------|
| A.1 | Delete `client/`. | Game client removed |
| A.2 | Delete `img/`. | SpacePrince screenshots/assets removed |
| A.3 | Delete non-engine `spec/` files. | Spec directory reduced to engine-relevant docs |

#### Workstream B: Rewrite Repo Metadata and Docs
**Dependencies:** Phase 0
**Can parallelize with:** Workstreams A, C

| Task | Description | Output |
|------|-------------|--------|
| B.1 | Replace root `README.md` with astronomy-engine project documentation. | Standalone repo landing page |
| B.2 | Rename `astro/package.json` metadata and descriptions away from SpacePrince. | Neutral package metadata |
| B.3 | Review `astro/README.md` and `cairo/README.md` for stale game references; rewrite as needed. | Consistent engine-facing docs |

#### Workstream C: Tighten Ignore/Reference Hygiene
**Dependencies:** Phase 0
**Can parallelize with:** Workstreams A, B

| Task | Description | Output |
|------|-------------|--------|
| C.1 | Remove `.gitignore` entries that only exist for deleted surfaces, if any. | Clean ignore file |
| C.2 | Search for `Space Prince` / `SpacePrince` references in retained files and remove or rewrite them. | No stale branding in kept surfaces |

---

### Merge Phase

After parallel workstreams complete, these tasks integrate the work.

#### Phase N: Verification and Final Trimming
**Dependencies:** Workstreams A, B, C

| Task | Description | Output |
|------|-------------|--------|
| N.1 | Run repo-wide search for deleted surface references. | No broken references to removed paths |
| N.2 | Run retained test suites or targeted smoke tests. | Verified standalone engine repo |
| N.3 | Review final tree for any remaining non-engine artifacts. | Clean final structure |

---

## Testing and Validation

- Run Node tests in `astro/`.
- Run Cairo tests in `cairo/`.
- Run a repo-wide text search for `Space Prince`, `SpacePrince`, `client/`, and deleted spec names.
- Manually inspect top-level tree after deletion.

## Rollout and Migration

- This is a one-step repository cleanup on the current branch.
- Rollback is straightforward via git if the deletion scope is too aggressive.

## Verification Checklist

- `git status --short`
- `find . -maxdepth 2 -mindepth 1 | sort`
- `rg -n "Space Prince|SpacePrince" .`
- `cd astro && npm test`
- `cd cairo && scarb test`

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Deleting a spec file that still captures engine constraints | Med | Med | Lock the `spec/` keep list before removal |
| Leaving stale SpacePrince naming in retained docs or manifests | High | Low | Run repo-wide text search after edits |
| Keeping too many legacy artifacts and ending with a half-clean repo | Med | Low | Use an explicit keep list and review final tree |
| Breaking retained tooling through deleted path references | Low | Med | Search for deleted paths and run smoke tests |

## Open Questions

- [ ] Keep only `spec/CHART.md` and `spec/CHART_PLAN.md`, or also keep `spec/ASTROLOGY.md` and `spec/v1/CONTRACTS.md` as domain reference?
- [ ] Keep all historical eval artifacts under `astro/evals/`, or trim them in a second pass?
- [ ] Keep older Cairo engine versions (`v1`-`v4`) in the standalone repo, or narrow to the active `v5` track plus shared crates?

## Decision Log

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Keep `astro/` | It is the active oracle and parity harness for Cairo work | Rebuild tooling elsewhere later |
| Keep `cairo/` | It is the core implementation target | None |
| Delete `client/` | Pure game/presentation surface, not astronomy-engine core | Archive it elsewhere first |
| Delete `img/` | Current contents are product screenshots/gifs, not engine assets | Move selected images into docs if needed |
| Rewrite root docs | Current root landing page misrepresents the repo | Leave stale branding temporarily |
