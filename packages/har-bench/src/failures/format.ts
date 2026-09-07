import type { ErrorRun, FailedRequest } from "./collect.js";

export interface FailuresReport {
  totalRuns: number;
  errorRuns: ErrorRun[];
  failedRequests: FailedRequest[];
  /** 走査した HAR ファイル数。HAR を走査しなかった場合は null */
  scannedHars: number | null;
}

/** 人が読むためのテキスト。実行の節と、走査したときだけリクエストの節を出す。 */
export function formatText(report: FailuresReport): string {
  const lines: string[] = [];
  lines.push(`error の実行: ${report.errorRuns.length} / ${report.totalRuns}`);
  for (const run of report.errorRuns) {
    lines.push(`  #${run.index}\t${run.startedAt}\t${run.harPath}\t${run.error}`);
  }
  if (report.scannedHars !== null) {
    lines.push("");
    lines.push(
      `失敗リクエスト: ${report.failedRequests.length} 件（HAR ${report.scannedHars} ファイルを走査）`,
    );
    for (const req of report.failedRequests) {
      lines.push(
        `  #${req.run}\t${req.startedDateTime}\t${req.status}\t${req.failureText ?? ""}\t${req.method} ${req.url}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/** 他ツールに渡すための JSON。末尾に改行を付ける。 */
export function formatJson(report: FailuresReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
