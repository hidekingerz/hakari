export interface HarMetrics {
  requestCount: number;
  failedRequestCount: number;
  transferBytes: number;
}

export interface HarResponse {
  status?: number;
  bodySize?: number;
  _transferSize?: number;
  _failureText?: string;
}

export interface HarEntry {
  startedDateTime?: string;
  request?: { method?: string; url?: string };
  response?: HarResponse;
}

/** HAR（JSON.parse 済み）からリクエスト数・失敗数・転送バイト数を集計する。 */
export function summarizeHar(har: unknown): HarMetrics {
  const entries = extractEntries(har);
  let failedRequestCount = 0;
  let transferBytes = 0;
  for (const entry of entries) {
    const response = entry.response ?? {};
    if (isFailedResponse(response)) failedRequestCount += 1;
    transferBytes += bytesOf(response);
  }
  return { requestCount: entries.length, failedRequestCount, transferBytes };
}

/** HAR（JSON.parse 済み）から entries を取り出す。無ければ例外。 */
export function extractEntries(har: unknown): HarEntry[] {
  const log = (har as { log?: { entries?: unknown } } | null)?.log;
  if (!log || !Array.isArray(log.entries)) {
    throw new Error("HAR の形式が不正です: log.entries がありません");
  }
  return log.entries as HarEntry[];
}

/** 失敗リクエストの判定: ネットワークエラー（_failureText）、未完了（status<=0）、HTTP 4xx/5xx。 */
export function isFailedResponse(response: HarResponse): boolean {
  if (typeof response._failureText === "string") return true;
  const status = response.status ?? 0;
  return status <= 0 || status >= 400;
}

function bytesOf(response: HarResponse): number {
  if (typeof response._transferSize === "number" && response._transferSize >= 0) {
    return response._transferSize;
  }
  if (typeof response.bodySize === "number" && response.bodySize >= 0) {
    return response.bodySize;
  }
  return 0;
}
