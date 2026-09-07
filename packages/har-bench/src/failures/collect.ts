import { extractEntries, isFailedResponse } from "../har-summary.js";
import type { RunSummary } from "../types.js";

export interface ErrorRun {
  index: number;
  startedAt: string;
  harPath: string;
  /** 1 行に整えたエラーメッセージ。無ければ空文字 */
  error: string;
}

export interface FailedRequest {
  /** 実行番号（RunSummary.index） */
  run: number;
  startedDateTime: string;
  method: string;
  url: string;
  status: number;
  failureText: string | null;
}

/** ANSI エスケープ（ESC [ ... 文字）にマッチする。Playwright のエラーメッセージに含まれる装飾を落とすため。 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC 文字そのものを検出する必要がある
const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;

/** 先頭行だけを残し、ANSI エスケープを除去して前後の空白を落とす。 */
export function firstLine(message: string): string {
  const line = message.split("\n")[0] ?? "";
  return line.replace(ANSI_PATTERN, "").trim();
}

/** status が error の実行を、表示用に整えて返す。 */
export function collectErrorRuns(runs: RunSummary[]): ErrorRun[] {
  return runs
    .filter((run) => run.status === "error")
    .map((run) => ({
      index: run.index,
      startedAt: run.startedAt,
      harPath: run.harPath,
      error: firstLine(run.error ?? ""),
    }));
}

/** HAR（JSON.parse 済み）から失敗リクエストだけを抜き出す。判定は summarizeHar と同じ。 */
export function extractFailedRequests(har: unknown, runIndex: number): FailedRequest[] {
  return extractEntries(har)
    .filter((entry) => isFailedResponse(entry.response ?? {}))
    .map((entry) => ({
      run: runIndex,
      startedDateTime: entry.startedDateTime ?? "",
      method: entry.request?.method ?? "",
      url: entry.request?.url ?? "",
      status: entry.response?.status ?? 0,
      failureText: entry.response?._failureText ?? null,
    }));
}
