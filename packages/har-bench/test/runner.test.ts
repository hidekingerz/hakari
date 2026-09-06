import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { resolveConfig } from "../src/config.js";
import { run } from "../src/runner.js";
import type { HarBenchConfig, Summary } from "../src/types.js";

let server: Server;
let baseUrl: string;
let tmpDir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        '<!doctype html><html><head><link rel="icon" href="data:,"></head>' +
          '<body><img src="/a.png"><script src="/b.js"></script>' +
          '<script>fetch("/missing")</script></body></html>',
      );
    } else if (req.url === "/a.png") {
      res.setHeader("content-type", "image/png");
      res.end(Buffer.alloc(100));
    } else if (req.url === "/b.js") {
      res.setHeader("content-type", "text/javascript");
      res.end("window.loaded = true;");
    } else {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "har-bench-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function config(overrides: Partial<HarBenchConfig> = {}) {
  return resolveConfig({
    runs: 2,
    outDir: tmpDir,
    scenario: async (page) => {
      await page.goto(baseUrl, { waitUntil: "networkidle" });
    },
    ...overrides,
  });
}

describe("run", () => {
  test("指定回数だけ実行し、HAR と summary.json を出力する", async () => {
    const result = await run({ config: config(), version: "0.0.0-test" });

    expect(result.summary.runs).toHaveLength(2);
    expect(result.summary.meta.stopReason).toBe("count");
    expect(result.summary.meta.finishedAt).not.toBeNull();
    expect(result.summary.aggregate.okRuns).toBe(2);

    const first = result.summary.runs[0];
    expect(first.index).toBe(1);
    expect(first.status).toBe("ok");
    expect(first.harPath).toBe("run-000001.har");
    // html, png, js, missing の 4 件。ブラウザが favicon 等を追加要求しても壊れないよう下限で見る
    expect(first.requestCount).toBeGreaterThanOrEqual(4);
    expect(first.failedRequestCount).toBeGreaterThanOrEqual(1); // /missing が 404
    expect(first.durationMs).toBeGreaterThan(0);
    expect(new Date(first.startedAt).getTime()).toBeLessThanOrEqual(
      new Date(first.endedAt).getTime(),
    );

    const files = (await readdir(result.outDir)).sort();
    expect(files).toEqual(["run-000001.har", "run-000002.har", "summary.json"]);

    const har = JSON.parse(await readFile(path.join(result.outDir, "run-000001.har"), "utf8"));
    expect(har.log.entries.length).toBeGreaterThanOrEqual(4);
    for (const entry of har.log.entries) {
      expect(typeof entry.startedDateTime).toBe("string");
      expect(typeof entry.timings.wait).toBe("number");
      expect(typeof entry.timings.receive).toBe("number");
    }

    const onDisk = JSON.parse(await readFile(path.join(result.outDir, "summary.json"), "utf8"));
    expect(onDisk).toEqual(result.summary);
  });

  test("シナリオが例外を投げても記録して残りを続行する", async () => {
    const result = await run({
      config: config({
        scenario: async (page) => {
          await page.goto(baseUrl);
          throw new Error("わざと失敗");
        },
      }),
      version: "0.0.0-test",
    });

    expect(result.summary.runs).toHaveLength(2);
    expect(result.summary.runs.map((r) => r.status)).toEqual(["error", "error"]);
    expect(result.summary.runs[0].error).toBe("わざと失敗");
    expect(result.summary.aggregate.errorRuns).toBe(2);
    const files = await readdir(result.outDir);
    expect(files).toContain("run-000002.har");
  });

  test("until に達したら止まり、途中でも summary.json が更新されている", async () => {
    const until = new Date(Date.now() + 2500);
    const midway: Summary[] = [];
    const result = await run({
      config: config({
        runs: "unlimited",
        until: until.toISOString(),
        scenario: async (page) => {
          // 各実行の開始時点で、前回までの結果が summary.json に書かれていることを記録する
          const [dirName] = await readdir(tmpDir);
          const onDisk = await readFile(path.join(tmpDir, dirName, "summary.json"), "utf8");
          midway.push(JSON.parse(onDisk) as Summary);
          await page.goto(baseUrl);
        },
      }),
      version: "0.0.0-test",
    });

    expect(result.summary.meta.stopReason).toBe("until");
    expect(result.summary.runs.length).toBeGreaterThanOrEqual(1);
    expect(result.summary.meta.until).toBe(until.toISOString());
    // 初回は runs 0 件・stopReason null の途中ファイルがあり、2 回目以降は前回分が増えている
    expect(midway).toHaveLength(result.summary.runs.length);
    expect(midway[0]).toMatchObject({ runs: [], meta: { stopReason: null, finishedAt: null } });
    if (midway.length > 1) {
      expect(midway[1].runs).toHaveLength(1);
      expect(midway[1].meta.stopReason).toBeNull();
    }
  });

  test("AbortSignal で停止すると実行中の回は完了させてから signal で止まる", async () => {
    const controller = new AbortController();
    const result = await run({
      config: config({
        runs: "unlimited",
        scenario: async (page) => {
          controller.abort();
          await page.goto(baseUrl, { waitUntil: "networkidle" });
        },
      }),
      version: "0.0.0-test",
      signal: controller.signal,
    });

    expect(result.summary.runs).toHaveLength(1);
    expect(result.summary.runs[0].status).toBe("ok");
    expect(result.summary.meta.stopReason).toBe("signal");
  });

  test("interval の分だけ実行間隔が空く", async () => {
    const started: number[] = [];
    await run({
      config: config({
        runs: 2,
        interval: 500,
        scenario: async (page) => {
          started.push(Date.now());
          await page.goto(baseUrl);
        },
      }),
      version: "0.0.0-test",
    });
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(500);
  });
});
