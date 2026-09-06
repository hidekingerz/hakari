import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { makeRun } from "./helpers.js";

const execFileAsync = promisify(execFile);
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(pkgDir, "src/cli.ts");
// cwd が一時ディレクトリでも tsx を見つけられるよう、パッケージから解決した絶対パスを file URL で渡す
const tsxLoader = pathToFileURL(
  createRequire(path.join(pkgDir, "package.json")).resolve("tsx"),
).href;

async function cli(args: string[], cwd = pkgDir) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", tsxLoader, cliPath, ...args],
      { cwd },
    );
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "har-bench-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("hakari-har-bench heatmap", () => {
  test("summary.json から heatmap.html を作る", async () => {
    const summaryPath = path.join(dir, "summary.json");
    await writeFile(
      summaryPath,
      JSON.stringify({
        meta: {
          tool: "har-bench",
          version: "0.1.0",
          browser: "chromium",
          headless: true,
          runs: 1,
          until: null,
          interval: 0,
          startedAt: "2026-09-06T10:00:00.000Z",
          finishedAt: "2026-09-06T10:00:01.000Z",
          stopReason: "count",
        },
        runs: [makeRun()],
        aggregate: {
          okRuns: 1,
          errorRuns: 0,
          durationMs: { min: 0, max: 0, mean: 0, median: 0, p95: 0 },
          requestCount: { min: 0, max: 0, mean: 0, median: 0, p95: 0 },
          transferBytes: { min: 0, max: 0, mean: 0, median: 0, p95: 0 },
        },
      }),
    );
    const result = await cli(["heatmap", summaryPath, "--tz", "utc"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("heatmap.html");
    await expect(readFile(path.join(dir, "heatmap.html"), "utf8")).resolves.toContain("<svg");
  });

  test("存在しないファイルは終了コード 2", async () => {
    const result = await cli(["heatmap", path.join(dir, "nope.json")]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("エラー");
  });

  test("--metric の不正値は commander がはじく", async () => {
    const result = await cli(["heatmap", "x.json", "--metric", "bogus"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("run-errors");
  });
});

describe("hakari-har-bench run", () => {
  test("設定ファイルが無ければ終了コード 2", async () => {
    const result = await cli(["run"], dir);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("設定ファイルが見つかりません");
  });

  test("--help でサブコマンドが見える", async () => {
    const result = await cli(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("run");
    expect(result.stdout).toContain("heatmap");
  });
});
