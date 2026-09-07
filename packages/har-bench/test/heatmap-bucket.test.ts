import { describe, expect, test } from "vitest";
import { bucketRuns } from "../src/heatmap/bucket.js";
import { makeRun } from "./helpers.js";

describe("bucketRuns", () => {
  test("同じ日付・時間帯の実行を 1 セルにまとめ、run-errors を数える", () => {
    const runs = [
      makeRun({ startedAt: "2026-09-06T10:05:00Z" }),
      makeRun({ startedAt: "2026-09-06T10:45:00Z", status: "error", error: "x" }),
      makeRun({ startedAt: "2026-09-06T11:00:00Z", status: "error", error: "y" }),
    ];
    const data = bucketRuns(runs, "run-errors", "utc");
    expect(data.dates).toEqual(["2026-09-06"]);
    expect(data.cells).toEqual([
      { date: "2026-09-06", hour: 10, runs: 2, value: 1 },
      { date: "2026-09-06", hour: 11, runs: 1, value: 1 },
    ]);
    expect(data.max).toBe(1);
    expect(data.metric).toBe("run-errors");
  });

  test("failed-requests は失敗リクエスト数を合計する", () => {
    const runs = [
      makeRun({ startedAt: "2026-09-06T10:05:00Z", failedRequestCount: 2 }),
      makeRun({ startedAt: "2026-09-06T10:45:00Z", failedRequestCount: 3 }),
    ];
    const data = bucketRuns(runs, "failed-requests", "utc");
    expect(data.cells[0].value).toBe(5);
    expect(data.max).toBe(5);
  });

  test("日付境界をまたぐと別の日付になる", () => {
    const runs = [
      makeRun({ startedAt: "2026-09-06T23:59:30Z" }),
      makeRun({ startedAt: "2026-09-07T00:00:30Z" }),
    ];
    const data = bucketRuns(runs, "run-errors", "utc");
    expect(data.dates).toEqual(["2026-09-06", "2026-09-07"]);
    expect(data.cells.map((c) => c.hour)).toEqual([23, 0]);
  });

  test("local はローカル時刻で日付・時を決める", () => {
    const local = new Date(2026, 8, 6, 23, 30); // ローカル 2026-09-06 23:30
    const data = bucketRuns([makeRun({ startedAt: local.toISOString() })], "run-errors", "local");
    expect(data.cells).toEqual([{ date: "2026-09-06", hour: 23, runs: 1, value: 0 }]);
  });

  test("順序は日付・時の昇順", () => {
    const runs = [
      makeRun({ startedAt: "2026-09-07T03:00:00Z" }),
      makeRun({ startedAt: "2026-09-06T20:00:00Z" }),
      makeRun({ startedAt: "2026-09-06T05:00:00Z" }),
    ];
    const data = bucketRuns(runs, "run-errors", "utc");
    expect(data.cells.map((c) => `${c.date}#${c.hour}`)).toEqual([
      "2026-09-06#5",
      "2026-09-06#20",
      "2026-09-07#3",
    ]);
  });

  test("空データは空の結果", () => {
    expect(bucketRuns([], "run-errors", "utc")).toEqual({
      metric: "run-errors",
      tz: "utc",
      dates: [],
      cells: [],
      max: 0,
    });
  });
});
