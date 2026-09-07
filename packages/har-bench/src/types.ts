import type { Page } from "playwright";

export type BrowserName = "chromium" | "firefox" | "webkit";
export type HarContent = "omit" | "embed";
export type StopReason = "count" | "until" | "signal" | "fatal";
export type Scenario = (page: Page) => Promise<void>;

/** har-bench.config.ts で利用者が書く設定。省略可能な項目は resolveConfig で既定値が入る。 */
export interface HarBenchConfig {
  runs?: number | "unlimited";
  until?: string;
  interval?: number;
  browser?: BrowserName;
  headless?: boolean;
  outDir?: string;
  har?: { content?: HarContent };
  scenario: Scenario;
}

/** 検証・既定値適用済みの設定。runner はこれだけを見る。 */
export interface ResolvedConfig {
  runs: number | "unlimited";
  until: Date | null;
  interval: number;
  browser: BrowserName;
  headless: boolean;
  outDir: string;
  harContent: HarContent;
  scenario: Scenario;
}

export interface Stats {
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
}

export interface Aggregate {
  okRuns: number;
  errorRuns: number;
  durationMs: Stats;
  requestCount: Stats;
  transferBytes: Stats;
}

export interface RunSummary {
  index: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  harPath: string;
  requestCount: number;
  failedRequestCount: number;
  transferBytes: number;
  status: "ok" | "error";
  error: string | null;
}

export interface SummaryMeta {
  tool: "har-bench";
  version: string;
  browser: BrowserName;
  headless: boolean;
  runs: number | "unlimited";
  until: string | null;
  interval: number;
  startedAt: string;
  finishedAt: string | null;
  stopReason: StopReason | null;
}

export interface Summary {
  meta: SummaryMeta;
  runs: RunSummary[];
  aggregate: Aggregate;
}
