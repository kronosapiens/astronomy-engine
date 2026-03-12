import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChunkPoints,
  collectMismatchRowsForChunk,
  createInitialState,
  defaultRunConfig,
  samplePointForIndex,
  validateResumeState,
} from "../src/cli/eval-random-cairo-engine.js";

test("samplePointForIndex is deterministic for seed and sample index", () => {
  const a = samplePointForIndex({ seed: 42, startYear: 1, endYear: 4000, sampleIndex: 1234 });
  const b = samplePointForIndex({ seed: 42, startYear: 1, endYear: 4000, sampleIndex: 1234 });
  assert.deepEqual(a, b);
});

test("buildChunkPoints is composable across chunk boundaries", () => {
  const whole = buildChunkPoints({ seed: 7, startYear: 1, endYear: 4000, chunkStart: 10, chunkEnd: 15 });
  const parts = [
    ...buildChunkPoints({ seed: 7, startYear: 1, endYear: 4000, chunkStart: 10, chunkEnd: 12 }),
    ...buildChunkPoints({ seed: 7, startYear: 1, endYear: 4000, chunkStart: 12, chunkEnd: 15 }),
  ];
  assert.deepEqual(parts, whole);
});

test("validateResumeState rejects config mismatches", () => {
  const config = defaultRunConfig({
    engine: "v5",
    seed: 5,
    points: 1000,
    startYear: 1,
    endYear: 4000,
    includePassingRows: false,
    batchPoints: 500,
  });
  const state = createInitialState(config);
  validateResumeState(state, config);
  assert.throws(
    () => validateResumeState(state, { ...config, seed: 6 }),
    /Resume state config mismatch/,
  );
});

test("collectMismatchRowsForChunk isolates only failing points", () => {
  const chunkPoints = Array.from({ length: 8 }, (_, sampleIndex) => ({
    sampleIndex,
    minutePg: sampleIndex,
    latBin: 0,
    lonBin: 0,
    expectedSigns: [0, 0, 0, 0, 0, 0, 0, 0],
    yearBucket: "0001-0200",
    latStratum: 0,
    year: 1,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
  }));
  const failing = new Set([2, 6]);
  const packedPoints = chunkPoints.flatMap((p) => [p.minutePg, p.latBin, p.lonBin]);
  const expectedPacked = chunkPoints.flatMap((p) => p.expectedSigns);

  const rows = collectMismatchRowsForChunk({
    engineId: 5,
    engine: "v5",
    seed: 9,
    chunkPoints,
    packedPoints,
    expectedPacked,
    rootBreakdown: { failCount: failing.size },
    noBuild: true,
    runCairoBatchFn: ({ packedPoints: subset }) => ({
      failCount: subset.filter((_, idx) => idx % 3 === 0 && failing.has(subset[idx])).length,
    }),
    runCairoPointMismatchDetailFn: ({ minutePg }) => ({
      mask: failing.has(minutePg) ? 1 : 0,
      actualSigns: [0, 0, 0, 0, 0, 0, 0, 0],
      actualLongitudes1e9: [0, 0, 0, 0, 0, 0, 0],
    }),
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.sampleIndex).sort((a, b) => a - b), [2, 6]);
});
