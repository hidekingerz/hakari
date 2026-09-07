import { describe, expect, test } from "vitest";
import type { ErrorRun, FailedRequest } from "../src/failures/collect.js";
import { formatJson, formatText } from "../src/failures/format.js";

const errorRuns: ErrorRun[] = [
  {
    index: 3,
    startedAt: "2026-09-07T02:09:07.330Z",
    harPath: "run-000003.har",
    error: "locator.waitFor: Timeout 1500ms exceeded.",
  },
];
const failedRequests: FailedRequest[] = [
  {
    run: 1,
    startedDateTime: "2026-09-07T02:09:03.236Z",
    method: "GET",
    url: "http://x/missing.js",
    status: 404,
    failureText: "net::ERR_ABORTED",
  },
  {
    run: 3,
    startedDateTime: "2026-09-07T02:09:07.378Z",
    method: "GET",
    url: "http://x/",
    status: 500,
    failureText: null,
  },
];

describe("formatText", () => {
  test("error の実行と失敗リクエストを見出し付きで並べる", () => {
    const text = formatText({ totalRuns: 10, errorRuns, failedRequests, scannedHars: 10 });
    expect(text).toContain("error の実行: 1 / 10");
    expect(text).toContain("#3");
    expect(text).toContain("run-000003.har");
    expect(text).toContain("locator.waitFor: Timeout 1500ms exceeded.");
    expect(text).toContain("失敗リクエスト: 2 件（HAR 10 ファイルを走査）");
    expect(text).toContain("404");
    expect(text).toContain("net::ERR_ABORTED");
    expect(text).toContain("GET http://x/missing.js");
    expect(text).toContain("500");
  });

  test("失敗が無ければその旨を出す", () => {
    const text = formatText({ totalRuns: 4, errorRuns: [], failedRequests: [], scannedHars: 4 });
    expect(text).toContain("error の実行: 0 / 4");
    expect(text).toContain("失敗リクエスト: 0 件");
  });

  test("scannedHars が null（HAR を走査しない）ならリクエストの節を出さない", () => {
    const text = formatText({ totalRuns: 4, errorRuns, failedRequests: [], scannedHars: null });
    expect(text).not.toContain("失敗リクエスト");
  });
});

describe("formatJson", () => {
  test("そのまま JSON 化できる構造を返す", () => {
    const json = formatJson({ totalRuns: 10, errorRuns, failedRequests, scannedHars: 10 });
    expect(JSON.parse(json)).toEqual({ totalRuns: 10, errorRuns, failedRequests, scannedHars: 10 });
    expect(json.endsWith("\n")).toBe(true);
  });
});
