import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let resolvedScarbBin = null;

function compareVersionLike(a, b) {
  const aParts = a.split(".").map((part) => Number.parseInt(part, 10));
  const bParts = b.split(".").map((part) => Number.parseInt(part, 10));
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i += 1) {
    const av = Number.isFinite(aParts[i]) ? aParts[i] : 0;
    const bv = Number.isFinite(bParts[i]) ? bParts[i] : 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function resolveScarbBin() {
  if (resolvedScarbBin) return resolvedScarbBin;
  if (process.env.SCARB_BIN) {
    resolvedScarbBin = process.env.SCARB_BIN;
    return resolvedScarbBin;
  }

  try {
    const asdfScarb = execFileSync("/opt/homebrew/bin/asdf", ["which", "scarb"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (asdfScarb.length > 0 && fs.existsSync(asdfScarb)) {
      resolvedScarbBin = asdfScarb;
      return resolvedScarbBin;
    }
  } catch {
    // Fall back to other resolution strategies below.
  }

  const homeDir = process.env.HOME;
  if (homeDir) {
    const installsDir = path.join(homeDir, ".asdf", "installs", "scarb");
    if (fs.existsSync(installsDir)) {
      const versions = fs.readdirSync(installsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(compareVersionLike);
      for (let i = versions.length - 1; i >= 0; i -= 1) {
        const candidate = path.join(installsDir, versions[i], "bin", "scarb");
        if (fs.existsSync(candidate)) {
          resolvedScarbBin = candidate;
          return resolvedScarbBin;
        }
      }
    }
  }

  resolvedScarbBin = "scarb";
  return resolvedScarbBin;
}

export function runScarb(args, cwd) {
  const scarbBin = resolveScarbBin();
  return execFileSync(scarbBin, args.map(String), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function makeUtcDate(year, month, day, hour = 0, minute = 0) {
  const dt = new Date(Date.UTC(0, month - 1, day, hour, minute, 0));
  dt.setUTCFullYear(year);
  return dt;
}

export const EPOCH_PG_MS = makeUtcDate(1, 1, 1).getTime();

export function minuteSincePg(unixMs) {
  return Math.floor((unixMs - EPOCH_PG_MS) / 60_000);
}

export function parseReturnArray(rawOutput) {
  const marker = "returning";
  const idx = rawOutput.lastIndexOf(marker);
  if (idx < 0) {
    throw new Error(`Could not parse cairo-run output: missing '${marker}' marker`);
  }
  const start = rawOutput.indexOf("[", idx);
  const end = rawOutput.lastIndexOf("]");
  if (start < 0 || end < 0 || end < start) {
    throw new Error("Could not parse cairo-run output array");
  }
  return JSON.parse(rawOutput.slice(start, end + 1));
}

function writeTempArgsFile(prefix, payload) {
  const tmpPath = path.join(
    os.tmpdir(),
    `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}.json`,
  );
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload)}\n`, "utf8");
  return tmpPath;
}

export function runCairoBatch({
  engineId,
  packedPoints,
  expectedPacked,
  noBuild,
  cairoDir,
}) {
  const argsPayload = [engineId, packedPoints, expectedPacked];
  const tmpPath = writeTempArgsFile("eval_batch", argsPayload);

  try {
    const cmdArgs = [
      "cairo-run",
      "-p",
      "astronomy_engine_eval_runner",
      "--function",
      "eval_batch_fail_breakdown",
      "--arguments-file",
      tmpPath,
    ];
    if (noBuild) cmdArgs.push("--no-build");
    const out = runScarb(cmdArgs, cairoDir);
    const values = parseReturnArray(out).map((x) => Number(x));
    if (values.length !== 10) {
      throw new Error(`Unexpected cairo-run return shape: expected 10 values, got ${values.length}`);
    }
    return {
      failCount: values[0],
      planetFailCount: values[1],
      ascFailCount: values[2],
      sunFailCount: values[3],
      moonFailCount: values[4],
      mercuryFailCount: values[5],
      venusFailCount: values[6],
      marsFailCount: values[7],
      jupiterFailCount: values[8],
      saturnFailCount: values[9],
    };
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

export function runCairoPointMismatchDetail({
  engineId,
  minutePg,
  latBin,
  lonBin,
  expectedSigns,
  noBuild,
  cairoDir,
  tempPrefix = "eval_point_detail",
}) {
  const argsPayload = [engineId, minutePg, latBin, lonBin, expectedSigns];
  const tmpPath = writeTempArgsFile(tempPrefix, argsPayload);

  try {
    const cmdArgs = [
      "cairo-run",
      "-p",
      "astronomy_engine_eval_runner",
      "--function",
      "eval_point_mismatch_detail",
      "--arguments-file",
      tmpPath,
    ];
    if (noBuild) cmdArgs.push("--no-build");
    const out = runScarb(cmdArgs, cairoDir);
    const values = parseReturnArray(out).map((x) => Number(x));
    if (values.length !== 16) {
      throw new Error(`Unexpected point detail return shape: expected 16 values, got ${values.length}`);
    }
    return {
      mask: values[0],
      actualSigns: values.slice(1, 9),
      actualLongitudes1e9: values.slice(9, 16),
    };
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

export function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function appendJsonLine(filePath, row) {
  if (!filePath) return;
  ensureParentDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

export function atomicWriteJson(filePath, value) {
  ensureParentDir(filePath);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function resolveOptionalPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

export function emitJsonLine(stream, row) {
  stream.write(`${JSON.stringify(row)}\n`);
}
