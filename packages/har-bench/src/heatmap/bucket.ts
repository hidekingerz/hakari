import type { RunSummary } from "../types.js";

export type HeatmapMetric = "run-errors" | "failed-requests";
export type HeatmapTz = "local" | "utc";

export interface HeatmapCell {
  /** YYYY-MM-DD */
  date: string;
  /** 0〜23 */
  hour: number;
  /** この枠で始まった実行数 */
  runs: number;
  /** metric に応じた合計値 */
  value: number;
}

export interface HeatmapData {
  metric: HeatmapMetric;
  tz: HeatmapTz;
  /** 昇順。実行があった日付のみ */
  dates: string[];
  /** 実行があった枠のみ。日付・時の昇順 */
  cells: HeatmapCell[];
  max: number;
}

/** 実行サマリーを日付 × 時の枠に集計する。 */
export function bucketRuns(runs: RunSummary[], metric: HeatmapMetric, tz: HeatmapTz): HeatmapData {
  const cellsByKey = new Map<string, HeatmapCell>();
  for (const run of runs) {
    const { date, hour } = bucketOf(new Date(run.startedAt), tz);
    const key = `${date}#${hour}`;
    const cell = cellsByKey.get(key) ?? { date, hour, runs: 0, value: 0 };
    cell.runs += 1;
    cell.value += getMetricValue(run, metric);
    cellsByKey.set(key, cell);
  }
  const cells = [...cellsByKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.hour - b.hour,
  );
  const dates = [...new Set(cells.map((c) => c.date))];
  const max = cells.reduce((m, c) => Math.max(m, c.value), 0);
  return { metric, tz, dates, cells, max };
}

function getMetricValue(run: RunSummary, metric: HeatmapMetric): number {
  if (metric === "run-errors") return run.status === "error" ? 1 : 0;
  return run.failedRequestCount;
}

function bucketOf(d: Date, tz: HeatmapTz): { date: string; hour: number } {
  if (tz === "utc") {
    return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return { date: `${y}-${m}-${day}`, hour: d.getHours() };
}
