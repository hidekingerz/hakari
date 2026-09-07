import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readSummary } from "../read-summary.js";
import { bucketRuns, type HeatmapData, type HeatmapMetric, type HeatmapTz } from "./bucket.js";
import { renderHeatmapHtml } from "./render.js";

export interface HeatmapOptions {
  input: string;
  /** 省略時は input と同じディレクトリの heatmap.html */
  out?: string;
  metric: HeatmapMetric;
  tz: HeatmapTz;
}

/** summary.json を読み、ヒートマップ HTML を書き出す。 */
export async function generateHeatmap(
  options: HeatmapOptions,
): Promise<{ outPath: string; data: HeatmapData }> {
  const inputPath = path.resolve(options.input);
  const summary = await readSummary(inputPath);
  const data = bucketRuns(summary.runs, options.metric, options.tz);
  const html = renderHeatmapHtml({ data, meta: summary.meta, sourcePath: inputPath });
  const outPath = options.out
    ? path.resolve(options.out)
    : path.join(path.dirname(inputPath), "heatmap.html");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");
  return { outPath, data };
}
