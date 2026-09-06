import type { RunSummary } from "../src/types.js";

export function makeRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    index: 1,
    startedAt: "2026-09-06T10:00:00.000Z",
    endedAt: "2026-09-06T10:00:01.000Z",
    durationMs: 1000,
    harPath: "run-000001.har",
    requestCount: 10,
    failedRequestCount: 0,
    transferBytes: 5000,
    status: "ok",
    error: null,
    ...overrides,
  };
}
