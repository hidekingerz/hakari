import { access } from "node:fs/promises";
import path from "node:path";
import { createJiti } from "jiti";
import type { BrowserName, HarBenchConfig, ResolvedConfig } from "./types.js";

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** 設定ファイルで型補完を効かせるためのヘルパー。値はそのまま返す。 */
export function defineConfig(config: HarBenchConfig): HarBenchConfig {
  return config;
}

/** CLI オプション。commander から渡る生の文字列を受ける。 */
export interface CliOverrides {
  config?: string;
  runs?: string;
  until?: string;
  interval?: string;
  browser?: string;
  headed?: boolean;
  out?: string;
}

const BROWSERS: readonly BrowserName[] = ["chromium", "firefox", "webkit"];
const CONFIG_CANDIDATES = [
  "har-bench.config.ts",
  "har-bench.config.mts",
  "har-bench.config.js",
  "har-bench.config.mjs",
];

/**
 * until の文字列を Date にする。
 * "HH:mm" は now の日付のその時刻（過ぎていれば翌日）。それ以外は ISO 8601 として解釈し、過去なら例外。
 */
export function parseUntil(input: string, now: Date): Date {
  const hhmm = /^(\d{2}):(\d{2})$/.exec(input);
  if (hhmm) {
    const hours = Number(hhmm[1]);
    const minutes = Number(hhmm[2]);
    if (hours > 23 || minutes > 59) {
      throw new ConfigError(`until の時刻が不正です: ${input}`);
    }
    const d = new Date(now);
    d.setHours(hours, minutes, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new ConfigError(`until を日時として解釈できません: ${input}（ISO 8601 か HH:mm で指定）`);
  }
  if (d.getTime() <= now.getTime()) {
    throw new ConfigError(`until が過去の日時です: ${input}`);
  }
  return d;
}

function parseRuns(value: number | string): number | "unlimited" {
  if (value === "unlimited") return value;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new ConfigError(`runs は 1 以上の整数か "unlimited" を指定してください: ${value}`);
  }
  return n;
}

function parseInterval(value: number | string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ConfigError(`interval は 0 以上のミリ秒で指定してください: ${value}`);
  }
  return n;
}

function parseBrowser(value: string): BrowserName {
  if (!BROWSERS.includes(value as BrowserName)) {
    throw new ConfigError(
      `browser は ${BROWSERS.join(" | ")} のいずれかを指定してください: ${value}`,
    );
  }
  return value as BrowserName;
}

/** 設定ファイルの値に CLI の値を上書きし、検証と既定値の適用を行う。優先順位は CLI > ファイル > 既定値。 */
export function resolveConfig(
  file: HarBenchConfig,
  cli: CliOverrides = {},
  now: Date = new Date(),
): ResolvedConfig {
  if (typeof file.scenario !== "function") {
    throw new ConfigError("設定に scenario 関数がありません");
  }
  const untilRaw = cli.until ?? file.until;
  return {
    runs: parseRuns(cli.runs ?? file.runs ?? 1),
    until: untilRaw === undefined ? null : parseUntil(untilRaw, now),
    interval: parseInterval(cli.interval ?? file.interval ?? 0),
    browser: parseBrowser(cli.browser ?? file.browser ?? "chromium"),
    headless: cli.headed ? false : (file.headless ?? true),
    outDir: cli.out ?? file.outDir ?? "./har-bench-out",
    harContent: file.har?.content ?? "omit",
    scenario: file.scenario,
  };
}

/** 設定ファイルを探して読み込む。configPath 未指定なら cwd の har-bench.config.{ts,mts,js,mjs} を順に探す。 */
export async function loadConfigFile(
  configPath: string | undefined,
  cwd: string,
): Promise<HarBenchConfig> {
  const candidates = configPath
    ? [path.resolve(cwd, configPath)]
    : CONFIG_CANDIDATES.map((name) => path.resolve(cwd, name));
  let found: string | undefined;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      found = candidate;
      break;
    } catch {
      // 次の候補を試す
    }
  }
  if (!found) {
    throw new ConfigError(`設定ファイルが見つかりません: ${candidates.join(", ")}`);
  }
  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(found)) as { default?: unknown };
  const config = mod.default ?? mod;
  if (typeof config !== "object" || config === null) {
    throw new ConfigError(`設定ファイルが設定オブジェクトを export していません: ${found}`);
  }
  return config as HarBenchConfig;
}
