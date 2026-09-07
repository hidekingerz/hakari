import { describe, expect, test } from "vitest";
import { aggregate, computeStats } from "../src/aggregate.js";
import { makeRun } from "./helpers.js";

describe("computeStats", () => {
  test("空配列はすべて 0", () => {
    expect(computeStats([])).toEqual({ min: 0, max: 0, mean: 0, median: 0, p95: 0 });
  });

  test("奇数個の中央値は真ん中の値", () => {
    expect(computeStats([5, 1, 3])).toEqual({ min: 1, max: 5, mean: 3, median: 3, p95: 5 });
  });

  test("偶数個の中央値は中央 2 値の平均", () => {
    expect(computeStats([1, 2, 3, 4]).median).toBe(2.5);
  });

  test("p95 は nearest-rank 法", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(computeStats(values).p95).toBe(95);
  });
});

describe("aggregate", () => {
  test("ok の実行だけを統計対象にする", () => {
    const runs = [
      makeRun({ index: 1, durationMs: 100, requestCount: 2, transferBytes: 10 }),
      makeRun({ index: 2, durationMs: 300, requestCount: 4, transferBytes: 30 }),
      makeRun({ index: 3, status: "error", error: "boom", durationMs: 9999 }),
    ];
    const result = aggregate(runs);
    expect(result.okRuns).toBe(2);
    expect(result.errorRuns).toBe(1);
    expect(result.durationMs).toEqual({ min: 100, max: 300, mean: 200, median: 200, p95: 300 });
    expect(result.requestCount.max).toBe(4);
    expect(result.transferBytes.mean).toBe(20);
  });

  test("実行が 0 件なら統計はすべて 0", () => {
    const result = aggregate([]);
    expect(result.okRuns).toBe(0);
    expect(result.durationMs.p95).toBe(0);
  });
});
