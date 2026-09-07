import type { Aggregate, RunSummary, Stats } from "./types.js";

/** 数値列の統計。median は偶数個なら中央 2 値の平均、p95 は nearest-rank 法。 */
export function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, p95: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95 = sorted[Math.max(0, Math.ceil(n * 0.95) - 1)];
  return { min: sorted[0], max: sorted[n - 1], mean: sum / n, median, p95 };
}

/** status が ok の実行だけを統計対象にする。 */
export function aggregate(runs: RunSummary[]): Aggregate {
  const ok = runs.filter((r) => r.status === "ok");
  return {
    okRuns: ok.length,
    errorRuns: runs.length - ok.length,
    durationMs: computeStats(ok.map((r) => r.durationMs)),
    requestCount: computeStats(ok.map((r) => r.requestCount)),
    transferBytes: computeStats(ok.map((r) => r.transferBytes)),
  };
}
