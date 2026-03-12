#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, getNumberArg, getStringArg } from "./args.js";
import { oracleAscSign, oraclePlanetSign } from "../engine.js";
import {
  EPOCH_PG_MS,
  appendJsonLine,
  atomicWriteJson,
  emitJsonLine,
  makeUtcDate,
  minuteSincePg,
  parseReturnArray,
  resolveOptionalPath,
  runCairoBatch,
  runCairoPointMismatchDetail,
  runScarb,
} from "./lib/eval-core.js";
import {
  makeRandomChunkSummaryRow,
  makeRandomPointResultRow,
} from "./lib/eval-rows.js";

const ENGINE_CONFIG = {
  v5: { id: 5, startYear: 1, endYear: 4000 },
};

const CLI_PATH = fileURLToPath(import.meta.url);
const CLI_DIR = path.dirname(CLI_PATH);
const REPO_ROOT = path.resolve(CLI_DIR, "..", "..", "..");
const CAIRO_DIR = path.join(REPO_ROOT, "cairo");

const LAT_STRATA = [
  [-900, -601],
  [-600, -301],
  [-300, 300],
  [301, 600],
  [601, 900],
];
const YEAR_BUCKET_COUNT = 20;
const BATCH_POINTS = 500;
const STATE_VERSION = 1;

export function encodePointArrays(points) {
  const packedPoints = [];
  const expectedPacked = [];
  for (const p of points) {
    packedPoints.push(p.minutePg, p.latBin, p.lonBin);
    expectedPacked.push(...p.expectedSigns);
  }
  return { packedPoints, expectedPacked };
}

export function sliceEncodedPayload(packedPoints, expectedPacked, startIdx, endIdxExclusive) {
  return {
    packedPoints: packedPoints.slice(startIdx * 3, endIdxExclusive * 3),
    expectedPacked: expectedPacked.slice(startIdx * 8, endIdxExclusive * 8),
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function derivePointSeed(seed, sampleIndex) {
  return (
    (seed >>> 0)
    ^ Math.imul((sampleIndex + 1) >>> 0, 0x9e3779b1)
    ^ Math.imul((sampleIndex ^ 0x85ebca6b) >>> 0, 0xc2b2ae35)
  ) >>> 0;
}

function randIntInclusive(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function daysInMonth(year, month) {
  return makeUtcDate(year, month + 1, 0).getUTCDate();
}

function expectedSignsForPoint(unixMs, latBin, lonBin) {
  return [
    oraclePlanetSign("Sun", unixMs),
    oraclePlanetSign("Moon", unixMs),
    oraclePlanetSign("Mercury", unixMs),
    oraclePlanetSign("Venus", unixMs),
    oraclePlanetSign("Mars", unixMs),
    oraclePlanetSign("Jupiter", unixMs),
    oraclePlanetSign("Saturn", unixMs),
    oracleAscSign(unixMs, latBin, lonBin),
  ];
}

export function samplePointForIndex({
  seed,
  startYear,
  endYear,
  sampleIndex,
}) {
  const totalYears = endYear - startYear + 1;
  const bucketCount = Math.min(YEAR_BUCKET_COUNT, Math.max(1, totalYears));
  const yearBucketSize = Math.ceil(totalYears / bucketCount);
  const bucketIdx = sampleIndex % bucketCount;
  const bucketStart = startYear + bucketIdx * yearBucketSize;
  const bucketEnd = Math.min(endYear, bucketStart + yearBucketSize - 1);

  const rng = mulberry32(derivePointSeed(seed, sampleIndex));
  const year = randIntInclusive(rng, bucketStart, bucketEnd);
  const month = randIntInclusive(rng, 1, 12);
  const day = randIntInclusive(rng, 1, daysInMonth(year, month));
  const minuteOfDay = randIntInclusive(rng, 0, 1439);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;

  const latStratum = sampleIndex % LAT_STRATA.length;
  const latRange = LAT_STRATA[latStratum];
  const latBin = randIntInclusive(rng, latRange[0], latRange[1]);
  const lonBin = randIntInclusive(rng, -1800, 1800);

  const unixMs = makeUtcDate(year, month, day, hour, minute).getTime();
  const minutePg = minuteSincePg(unixMs);
  const sampleUnixMs = EPOCH_PG_MS + minutePg * 60_000;

  return {
    sampleIndex,
    latStratum,
    yearBucket: `${String(bucketStart).padStart(4, "0")}-${String(bucketEnd).padStart(4, "0")}`,
    year,
    month,
    day,
    hour,
    minute,
    minutePg,
    sampleUnixMs,
    latBin,
    lonBin,
    expectedSigns: expectedSignsForPoint(sampleUnixMs, latBin, lonBin),
  };
}

function getBooleanArg(args, key, fallback) {
  const value = args[key];
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`Invalid boolean argument --${key}=${value}`);
}

export function defaultRunConfig(raw) {
  return {
    engine: raw.engine,
    seed: raw.seed,
    points: raw.points,
    startYear: raw.startYear,
    endYear: raw.endYear,
    includePassingRows: raw.includePassingRows,
    batchPoints: raw.batchPoints,
  };
}

export function createInitialState(config) {
  return {
    version: STATE_VERSION,
    config,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nextChunkStart: 0,
    processedPoints: 0,
    completedChunks: 0,
    mismatchCount: 0,
    completed: false,
  };
}

export function validateResumeState(state, expectedConfig) {
  if (!state || typeof state !== "object") {
    throw new Error("Invalid resume state: expected object");
  }
  if (state.version !== STATE_VERSION) {
    throw new Error(`Unsupported state version ${state.version}; expected ${STATE_VERSION}`);
  }
  const entries = Object.entries(expectedConfig);
  for (const [key, expected] of entries) {
    if (state.config?.[key] !== expected) {
      throw new Error(
        `Resume state config mismatch for '${key}': state=${state.config?.[key]} expected=${expected}`,
      );
    }
  }
}

function loadState(stateFile, expectedConfig, resume) {
  if (!stateFile || !fs.existsSync(stateFile)) {
    return createInitialState(expectedConfig);
  }
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  validateResumeState(state, expectedConfig);
  if (!resume && state.completed) {
    return createInitialState(expectedConfig);
  }
  return state;
}

function updateStateAfterChunk(state, chunkEnd, mismatchCountDelta) {
  const next = { ...state };
  next.nextChunkStart = chunkEnd;
  next.processedPoints = chunkEnd;
  next.completedChunks += 1;
  next.mismatchCount += mismatchCountDelta;
  next.updatedAt = new Date().toISOString();
  return next;
}

function markStateCompleted(state, points) {
  const next = { ...state };
  next.nextChunkStart = points;
  next.processedPoints = points;
  next.completed = true;
  next.updatedAt = new Date().toISOString();
  next.completedAt = new Date().toISOString();
  return next;
}

function pointRowFromDetail(engine, seed, p, detail) {
  const mask = detail.mask;
  return makeRandomPointResultRow({
    engine,
    seed,
    runStartYear: p.runStartYear,
    runEndYear: p.runEndYear,
    runPointCount: p.runPointCount,
    batchPoints: p.batchPoints,
    includePassingRows: p.includePassingRows,
    sampleIndex: p.sampleIndex,
    yearBucket: p.yearBucket,
    latStratum: p.latStratum,
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: p.minute,
    minutePg: p.minutePg,
    latBin: p.latBin,
    lonBin: p.lonBin,
    expectedSigns: p.expectedSigns,
    actualSigns: detail.actualSigns,
    mismatchMask: mask,
    actualLongitudes1e9: detail.actualLongitudes1e9,
  });
}

export function collectMismatchRowsForChunk({
  engineId,
  engine,
  seed,
  chunkPoints,
  packedPoints,
  expectedPacked,
  rootBreakdown,
  noBuild,
  runCairoBatchFn = runCairoBatch,
  runCairoPointMismatchDetailFn = runCairoPointMismatchDetail,
}) {
  const rows = [];
  const cache = new Map();
  cache.set(`0:${chunkPoints.length}`, rootBreakdown);

  const getBreakdown = (startIdx, endIdxExclusive) => {
    const key = `${startIdx}:${endIdxExclusive}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const sliced = sliceEncodedPayload(packedPoints, expectedPacked, startIdx, endIdxExclusive);
    const breakdown = runCairoBatchFn({
      engineId,
      packedPoints: sliced.packedPoints,
      expectedPacked: sliced.expectedPacked,
      noBuild,
      cairoDir: CAIRO_DIR,
    });
    cache.set(key, breakdown);
    return breakdown;
  };

  const recurse = (startIdx, endIdxExclusive) => {
    const count = endIdxExclusive - startIdx;
    if (count <= 0) return;
    const breakdown = getBreakdown(startIdx, endIdxExclusive);
    if (breakdown.failCount === 0) return;
    if (count === 1) {
      const p = chunkPoints[startIdx];
      const detail = runCairoPointMismatchDetailFn({
        engineId,
        minutePg: p.minutePg,
        latBin: p.latBin,
        lonBin: p.lonBin,
        expectedSigns: p.expectedSigns,
        noBuild,
        cairoDir: CAIRO_DIR,
        tempPrefix: "eval_random_point_detail",
      });
      if (detail.mask !== 0) {
        rows.push(pointRowFromDetail(engine, seed, p, detail));
      }
      return;
    }
    const mid = startIdx + Math.floor(count / 2);
    recurse(startIdx, mid);
    recurse(mid, endIdxExclusive);
  };

  recurse(0, chunkPoints.length);
  return rows;
}

export function buildChunkPoints({ seed, startYear, endYear, chunkStart, chunkEnd }) {
  const points = [];
  for (let sampleIndex = chunkStart; sampleIndex < chunkEnd; sampleIndex += 1) {
    points.push({
      ...samplePointForIndex({ seed, startYear, endYear, sampleIndex }),
      runStartYear: startYear,
      runEndYear: endYear,
    });
  }
  return points;
}

export function runRandomEval({
  engine,
  seed,
  points,
  startYear,
  endYear,
  includePassingRows,
  batchPoints = BATCH_POINTS,
  mismatchFile = null,
  summaryFile = null,
  stateFile = null,
  resume = false,
  maxChunks = null,
}) {
  const capability = ENGINE_CONFIG[engine];
  const config = defaultRunConfig({
    engine,
    seed,
    points,
    startYear,
    endYear,
    includePassingRows,
    batchPoints,
  });
  let state = loadState(stateFile, config, resume);
  const noBuild = true;

  runScarb(["build", "-p", "astronomy_engine_eval_runner"], CAIRO_DIR);

  let chunkCount = 0;
  for (let chunkStart = state.nextChunkStart; chunkStart < points; chunkStart += batchPoints) {
    if (maxChunks !== null && chunkCount >= maxChunks) break;
    const chunkEnd = Math.min(chunkStart + batchPoints, points);
    const chunkStartedAtMs = Date.now();
    const chunkPoints = buildChunkPoints({ seed, startYear, endYear, chunkStart, chunkEnd });
    for (const point of chunkPoints) {
      point.runPointCount = points;
      point.batchPoints = batchPoints;
      point.includePassingRows = includePassingRows;
    }
    const { packedPoints, expectedPacked } = encodePointArrays(chunkPoints);
    const chunkBreakdown = runCairoBatch({
      engineId: capability.id,
      packedPoints,
      expectedPacked,
      noBuild,
      cairoDir: CAIRO_DIR,
    });

    let emittedRows = 0;
    if (includePassingRows) {
      for (const p of chunkPoints) {
        const detail = runCairoPointMismatchDetail({
          engineId: capability.id,
          minutePg: p.minutePg,
          latBin: p.latBin,
          lonBin: p.lonBin,
          expectedSigns: p.expectedSigns,
          noBuild,
          cairoDir: CAIRO_DIR,
          tempPrefix: "eval_random_point_detail",
        });
        const row = pointRowFromDetail(engine, seed, p, detail);
        if (mismatchFile) {
          appendJsonLine(mismatchFile, row);
        } else {
          emitJsonLine(process.stdout, row);
        }
        emittedRows += 1;
      }
    } else if (chunkBreakdown.failCount > 0) {
      const rows = collectMismatchRowsForChunk({
        engineId: capability.id,
        engine,
        seed,
        chunkPoints,
        packedPoints,
        expectedPacked,
        rootBreakdown: chunkBreakdown,
        noBuild,
      });
      for (const row of rows) {
        if (mismatchFile) {
          appendJsonLine(mismatchFile, row);
        } else {
          emitJsonLine(process.stdout, row);
        }
      }
      emittedRows = rows.length;
    }

    state = updateStateAfterChunk(state, chunkEnd, chunkBreakdown.failCount);
    if (stateFile) {
      atomicWriteJson(stateFile, state);
    }

    const summaryRow = makeRandomChunkSummaryRow({
      tsUtc: state.updatedAt,
      engine,
      seed,
      runStartYear: startYear,
      runEndYear: endYear,
      runPointCount: points,
      batchPoints,
      includePassingRows,
      chunkIndex: state.completedChunks - 1,
      chunkStart,
      chunkEnd,
      pointCount: chunkEnd - chunkStart,
      failCount: chunkBreakdown.failCount,
      planetFailCount: chunkBreakdown.planetFailCount,
      ascFailCount: chunkBreakdown.ascFailCount,
      sunFailCount: chunkBreakdown.sunFailCount,
      moonFailCount: chunkBreakdown.moonFailCount,
      mercuryFailCount: chunkBreakdown.mercuryFailCount,
      venusFailCount: chunkBreakdown.venusFailCount,
      marsFailCount: chunkBreakdown.marsFailCount,
      jupiterFailCount: chunkBreakdown.jupiterFailCount,
      saturnFailCount: chunkBreakdown.saturnFailCount,
      emittedRows,
      elapsedMs: Date.now() - chunkStartedAtMs,
    });

    if (summaryFile) {
      appendJsonLine(summaryFile, summaryRow);
    } else {
      emitJsonLine(process.stderr, summaryRow);
    }

    chunkCount += 1;
  }

  if (state.nextChunkStart >= points) {
    state = markStateCompleted(state, points);
    if (stateFile) {
      atomicWriteJson(stateFile, state);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const engine = getStringArg(args, "engine", "v5").toLowerCase();
  const points = getNumberArg(args, "points", 1000);
  const seed = getNumberArg(args, "seed", 1);
  const includePassingRows = getBooleanArg(args, "include-passes", true);
  const batchPoints = getNumberArg(args, "batch-points", BATCH_POINTS);
  const resume = getBooleanArg(args, "resume", false);
  const maxChunksArg = getNumberArg(args, "max-chunks", -1);

  if (!ENGINE_CONFIG[engine]) {
    throw new Error(`Unsupported --engine=${engine}; expected one of ${Object.keys(ENGINE_CONFIG).join(", ")}`);
  }
  if (!Number.isInteger(points) || points <= 0) {
    throw new Error(`Invalid --points=${points}; expected positive integer`);
  }
  if (!Number.isInteger(seed)) {
    throw new Error(`Invalid --seed=${seed}; expected integer`);
  }
  if (!Number.isInteger(batchPoints) || batchPoints <= 0) {
    throw new Error(`Invalid --batch-points=${batchPoints}; expected positive integer`);
  }

  const capability = ENGINE_CONFIG[engine];
  const startYear = getNumberArg(args, "start-year", capability.startYear);
  const endYear = getNumberArg(args, "end-year", capability.endYear);

  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear) {
    throw new Error(`Invalid year range start=${startYear} end=${endYear}`);
  }
  if (startYear < capability.startYear || endYear > capability.endYear) {
    throw new Error(
      `Engine ${engine} supports years [${capability.startYear}, ${capability.endYear}] (inclusive); requested [${startYear}, ${endYear}]`,
    );
  }

  runRandomEval({
    engine,
    seed,
    points,
    startYear,
    endYear,
    includePassingRows,
    batchPoints,
    mismatchFile: resolveOptionalPath(typeof args["mismatch-file"] === "string" ? args["mismatch-file"] : ""),
    summaryFile: resolveOptionalPath(typeof args["summary-file"] === "string" ? args["summary-file"] : ""),
    stateFile: resolveOptionalPath(typeof args["state-file"] === "string" ? args["state-file"] : ""),
    resume,
    maxChunks: maxChunksArg >= 0 ? maxChunksArg : null,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === CLI_PATH) {
  main();
}
