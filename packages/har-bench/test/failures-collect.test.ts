import { describe, expect, test } from "vitest";
import { collectErrorRuns, extractFailedRequests, firstLine } from "../src/failures/collect.js";
import { makeRun } from "./helpers.js";

const ESC = "\u001b";

describe("collectErrorRuns", () => {
  test("status が error の実行だけを、メッセージを 1 行に整えて返す", () => {
    const runs = [
      makeRun({ index: 1 }),
      makeRun({
        index: 2,
        startedAt: "2026-09-07T02:09:07.330Z",
        harPath: "run-000002.har",
        status: "error",
        error: `locator.waitFor: Timeout 1500ms exceeded.\nCall log:\n${ESC}[2m  - waiting${ESC}[22m`,
      }),
      makeRun({ index: 3, status: "error", error: null }),
    ];
    expect(collectErrorRuns(runs)).toEqual([
      {
        index: 2,
        startedAt: "2026-09-07T02:09:07.330Z",
        harPath: "run-000002.har",
        error: "locator.waitFor: Timeout 1500ms exceeded.",
      },
      { index: 3, startedAt: runs[2].startedAt, harPath: runs[2].harPath, error: "" },
    ]);
  });
});

describe("firstLine", () => {
  test("先頭行だけを残し ANSI エスケープを除去する", () => {
    expect(firstLine(`${ESC}[31mfail${ESC}[0m here\nsecond`)).toBe("fail here");
    expect(firstLine("   ")).toBe("");
  });
});

describe("extractFailedRequests", () => {
  const har = {
    log: {
      entries: [
        {
          startedDateTime: "2026-09-07T02:09:03.213Z",
          request: { method: "GET", url: "http://x/" },
          response: { status: 200 },
        },
        {
          startedDateTime: "2026-09-07T02:09:03.236Z",
          request: { method: "GET", url: "http://x/missing.js" },
          response: { status: 404, _failureText: "net::ERR_ABORTED" },
        },
        {
          startedDateTime: "2026-09-07T02:09:03.240Z",
          request: { method: "POST", url: "http://x/api" },
          response: { status: 500 },
        },
        {
          startedDateTime: "2026-09-07T02:09:03.250Z",
          request: { method: "GET", url: "http://x/pending" },
          response: { status: -1 },
        },
      ],
    },
  };

  test("失敗したリクエストだけを実行番号付きで返す", () => {
    expect(extractFailedRequests(har, 7)).toEqual([
      {
        run: 7,
        startedDateTime: "2026-09-07T02:09:03.236Z",
        method: "GET",
        url: "http://x/missing.js",
        status: 404,
        failureText: "net::ERR_ABORTED",
      },
      {
        run: 7,
        startedDateTime: "2026-09-07T02:09:03.240Z",
        method: "POST",
        url: "http://x/api",
        status: 500,
        failureText: null,
      },
      {
        run: 7,
        startedDateTime: "2026-09-07T02:09:03.250Z",
        method: "GET",
        url: "http://x/pending",
        status: -1,
        failureText: null,
      },
    ]);
  });

  test("形式が不正な HAR は例外", () => {
    expect(() => extractFailedRequests({}, 1)).toThrow(/log\.entries/);
  });
});
