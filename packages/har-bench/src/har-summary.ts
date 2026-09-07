export interface HarMetrics {
  requestCount: number;
  failedRequestCount: number;
  transferBytes: number;
}

interface HarResponse {
  status?: number;
  bodySize?: number;
  _transferSize?: number;
  _failureText?: string;
}

interface HarEntry {
  response?: HarResponse;
}

/** HAR（JSON.parse 済み）からリクエスト数・失敗数・転送バイト数を集計する。 */
export function summarizeHar(har: unknown): HarMetrics {
  const entries = extractEntries(har);
  let failedRequestCount = 0;
  let transferBytes = 0;
  for (const entry of entries) {
    const response = entry.response ?? {};
    if (isFailed(response)) failedRequestCount += 1;
    transferBytes += bytesOf(response);
  }
  return { requestCount: entries.length, failedRequestCount, transferBytes };
}

function extractEntries(har: unknown): HarEntry[] {
  const log = (har as { log?: { entries?: unknown } } | null)?.log;
  if (!log || !Array.isArray(log.entries)) {
    throw new Error("HAR の形式が不正です: log.entries がありません");
  }
  return log.entries as HarEntry[];
}

function isFailed(response: HarResponse): boolean {
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
