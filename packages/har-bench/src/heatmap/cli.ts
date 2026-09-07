import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Summary } from "../types.js";
import { bucketRuns, type HeatmapData, type HeatmapMetric, type HeatmapTz } from "./bucket.js";
import { renderHeatmapHtml } from "./render.js";

export class HeatmapInputError extends Error {
  override name = "HeatmapInputError";
}

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

async function readSummary(inputPath: string): Promise<Summary> {
  let raw: string;
  try {
    raw = await readFile(inputPath, "utf8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new HeatmapInputError(`summary.json を読み込めません: ${inputPath}\n${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HeatmapInputError(`summary.json が JSON として不正です: ${inputPath}`);
  }
  const s = parsed as Partial<Summary> | null;
  if (!s || typeof s !== "object" || s.meta?.tool !== "har-bench") {
    throw new HeatmapInputError(
      `har-bench の summary.json ではありません（meta.tool が違います）: ${inputPath}`,
    );
  }
  if (!Array.isArray(s.runs) || s.runs.length === 0) {
    throw new HeatmapInputError(
      `runs が空です。実行結果のない summary.json は描画できません: ${inputPath}`,
    );
  }
  return s as Summary;
}
