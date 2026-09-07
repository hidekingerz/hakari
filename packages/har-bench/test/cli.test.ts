import { execFile, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Summary } from "../src/types.js";
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

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end("<!doctype html><html><body>ok</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

  test("SIGINT を受けると実行中の回を終えてから summary.json を確定して終了する", async () => {
    await writeFile(
      path.join(dir, "har-bench.config.ts"),
      `export default {
  runs: "unlimited",
  outDir: ${JSON.stringify(dir)},
  scenario: async (page) => {
    await page.goto(${JSON.stringify(baseUrl)}, { waitUntil: "networkidle" });
  },
};
`,
    );

    const child = spawn(process.execPath, ["--import", tsxLoader, cliPath, "run"], { cwd: dir });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // 1 回目の実行が完了したことを示すログが出るまで待ってから SIGINT を送る
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        if (stderr.includes("run 1:")) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
      child.once("exit", (code) => {
        clearInterval(timer);
        reject(new Error(`run 1 のログが出る前に終了しました（code=${code}）\n${stderr}`));
      });
    });
    child.kill("SIGINT");

    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
    });
    expect(exitCode).toBe(0);

    const entries = await readdir(dir);
    const outSubDir = entries.find((name) => name !== "har-bench.config.ts");
    if (!outSubDir) throw new Error(`出力ディレクトリが見つかりません: ${entries.join(", ")}`);
    const summary = JSON.parse(
      await readFile(path.join(dir, outSubDir, "summary.json"), "utf8"),
    ) as Summary;

    expect(summary.meta.stopReason).toBe("signal");
    expect(summary.meta.finishedAt).not.toBeNull();
    expect(summary.runs.length).toBeGreaterThanOrEqual(1);
    for (const r of summary.runs) {
      expect(r.status).toBe("ok");
    }
  });
});
