import { readFile } from "node:fs/promises";
import type { Summary } from "./types.js";

/** summary.json が読めない・形式が不正なときのエラー。CLI では終了コード 2 になる。 */
export class SummaryInputError extends Error {
  override name = "SummaryInputError";
}

/** summary.json を読み込み、har-bench の出力であることと runs が空でないことを検証する。 */
export async function readSummary(inputPath: string): Promise<Summary> {
  let raw: string;
  try {
    raw = await readFile(inputPath, "utf8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new SummaryInputError(`summary.json を読み込めません: ${inputPath}\n${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SummaryInputError(`summary.json が JSON として不正です: ${inputPath}`);
  }
  const s = parsed as Partial<Summary> | null;
  if (!s || typeof s !== "object" || s.meta?.tool !== "har-bench") {
    throw new SummaryInputError(
      `har-bench の summary.json ではありません（meta.tool が違います）: ${inputPath}`,
    );
  }
  if (!Array.isArray(s.runs) || s.runs.length === 0) {
    throw new SummaryInputError(`runs が空です。実行結果のない summary.json です: ${inputPath}`);
  }
  return s as Summary;
}
