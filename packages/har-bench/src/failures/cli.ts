import { readFile } from "node:fs/promises";
import path from "node:path";
import { readSummary } from "../read-summary.js";
import { collectErrorRuns, extractFailedRequests, type FailedRequest } from "./collect.js";
import type { FailuresReport } from "./format.js";

export interface CollectFailuresOptions {
  /** summary.json のパス */
  input: string;
  /** true なら各実行の HAR を読んで失敗リクエストも集める */
  requests: boolean;
  /** 読めない HAR があったときの警告先 */
  warn: (message: string) => void;
}

/** summary.json（と HAR）から error 実行と失敗リクエストを集める。 */
export async function collectFailures(options: CollectFailuresOptions): Promise<FailuresReport> {
  const inputPath = path.resolve(options.input);
  const summary = await readSummary(inputPath);
  const errorRuns = collectErrorRuns(summary.runs);

  if (!options.requests) {
    return { totalRuns: summary.runs.length, errorRuns, failedRequests: [], scannedHars: null };
  }

  const baseDir = path.dirname(inputPath);
  const failedRequests: FailedRequest[] = [];
  let scannedHars = 0;
  for (const run of summary.runs) {
    const harPath = path.resolve(baseDir, run.harPath);
    let har: unknown;
    try {
      har = JSON.parse(await readFile(harPath, "utf8"));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      options.warn(
        `HAR を読めないため実行 #${run.index} を飛ばします: ${run.harPath}（${message}）`,
      );
      continue;
    }
    try {
      failedRequests.push(...extractFailedRequests(har, run.index));
      scannedHars += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      options.warn(
        `HAR の形式が不正なため実行 #${run.index} を飛ばします: ${run.harPath}（${message}）`,
      );
    }
  }
  return { totalRuns: summary.runs.length, errorRuns, failedRequests, scannedHars };
}
