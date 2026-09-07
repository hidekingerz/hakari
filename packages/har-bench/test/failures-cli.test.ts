import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { collectFailures } from "../src/failures/cli.js";
import { SummaryInputError } from "../src/read-summary.js";
import { makeRun } from "./helpers.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "har-bench-failures-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function har(entries: unknown[]) {
  return JSON.stringify({ log: { version: "1.2", entries } });
}

async function writeFixture() {
  const summary = {
    meta: {
      tool: "har-bench",
      version: "0.1.0",
      browser: "chromium",
      headless: true,
      runs: 3,
      until: null,
      interval: 0,
      startedAt: "2026-09-07T02:09:02.791Z",
      finishedAt: "2026-09-07T02:09:22.000Z",
      stopReason: "count",
    },
    runs: [
      makeRun({ index: 1, harPath: "run-000001.har", failedRequestCount: 1 }),
      makeRun({
        index: 2,
        harPath: "run-000002.har",
        status: "error",
        error: "locator.waitFor: Timeout 1500ms exceeded.\nCall log:",
      }),
      makeRun({ index: 3, harPath: "run-000003.har" }), // HAR ファイルを置かない
    ],
    aggregate: {},
  };
  await writeFile(path.join(dir, "summary.json"), JSON.stringify(summary), "utf8");
  await writeFile(
    path.join(dir, "run-000001.har"),
    har([
      {
        startedDateTime: "t1",
        request: { method: "GET", url: "http://x/" },
        response: { status: 200 },
      },
      {
        startedDateTime: "t2",
        request: { method: "GET", url: "http://x/missing.js" },
        response: { status: 404, _failureText: "net::ERR_ABORTED" },
      },
    ]),
    "utf8",
  );
  await writeFile(
    path.join(dir, "run-000002.har"),
    har([
      {
        startedDateTime: "t3",
        request: { method: "GET", url: "http://x/" },
        response: { status: 500 },
      },
    ]),
    "utf8",
  );
  return path.join(dir, "summary.json");
}

describe("collectFailures", () => {
  test("summary.json と HAR から error 実行と失敗リクエストを集める。無い HAR は警告して続行", async () => {
    const input = await writeFixture();
    const warnings: string[] = [];
    const report = await collectFailures({ input, requests: true, warn: (m) => warnings.push(m) });

    expect(report.totalRuns).toBe(3);
    expect(report.errorRuns).toEqual([
      {
        index: 2,
        startedAt: expect.any(String),
        harPath: "run-000002.har",
        error: "locator.waitFor: Timeout 1500ms exceeded.",
      },
    ]);
    expect(report.failedRequests.map((r) => [r.run, r.status, r.url])).toEqual([
      [1, 404, "http://x/missing.js"],
      [2, 500, "http://x/"],
    ]);
    expect(report.scannedHars).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("run-000003.har");
  });

  test("requests: false なら HAR を読まず scannedHars は null", async () => {
    const input = await writeFixture();
    const warnings: string[] = [];
    const report = await collectFailures({ input, requests: false, warn: (m) => warnings.push(m) });
    expect(report.scannedHars).toBeNull();
    expect(report.failedRequests).toEqual([]);
    expect(report.errorRuns).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  test("summary.json が読めなければ SummaryInputError", async () => {
    await expect(
      collectFailures({ input: path.join(dir, "nope.json"), requests: true, warn: () => {} }),
    ).rejects.toThrow(SummaryInputError);
  });
});
