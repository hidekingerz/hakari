import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { type Browser, type BrowserContext, chromium, firefox, webkit } from "playwright";
import { aggregate } from "./aggregate.js";
import { summarizeHar } from "./har-summary.js";
import { shouldStop } from "./stop.js";
import type { ResolvedConfig, RunSummary, StopReason, Summary } from "./types.js";

export class BrowserLaunchError extends Error {
  override name = "BrowserLaunchError";
}

export interface RunOptions {
  config: ResolvedConfig;
  version: string;
  /** abort されたら実行中のシナリオを終えてから停止する。 */
  signal?: AbortSignal;
  /** テストで時刻を差し替えるため。 */
  now?: () => Date;
  /** 進捗ログ。省略時は何も出さない。 */
  log?: (message: string) => void;
}

export interface RunResult {
  outDir: string;
  summary: Summary;
}

const launchers = { chromium, firefox, webkit } as const;

/** 設定に従ってシナリオを繰り返し実行し、HAR と summary.json を出力する。 */
export async function run(options: RunOptions): Promise<RunResult> {
  const { config, version, signal } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});

  const startedAt = now();
  const outDir = path.resolve(config.outDir, startedAt.toISOString().replace(/:/g, "-"));
  await mkdir(outDir, { recursive: true });

  const summary: Summary = {
    meta: {
      tool: "har-bench",
      version,
      browser: config.browser,
      headless: config.headless,
      runs: config.runs,
      until: config.until ? config.until.toISOString() : null,
      interval: config.interval,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      stopReason: null,
    },
    runs: [],
    aggregate: aggregate([]),
  };
  await writeSummary(outDir, summary);

  let browser: Browser | undefined;
  let relaunched = false;
  let stopReason: StopReason | null = null;

  try {
    browser = await launchBrowser(config);
    for (;;) {
      stopReason = shouldStop(
        {
          completedRuns: summary.runs.length,
          runs: config.runs,
          until: config.until,
          signalReceived: signal?.aborted ?? false,
        },
        now(),
      );
      if (stopReason) break;

      if (!browser.isConnected()) {
        if (relaunched) {
          log("ブラウザが再度切断されたため終了します");
          stopReason = "fatal";
          break;
        }
        log("ブラウザが切断されました。再起動します");
        browser = await launchBrowser(config);
        relaunched = true;
      }

      const index = summary.runs.length + 1;
      const runSummary = await executeRun(browser, config, outDir, index, now);
      summary.runs.push(runSummary);
      summary.aggregate = aggregate(summary.runs);
      await writeSummary(outDir, summary);
      log(
        `run ${index}: ${runSummary.status} ${Math.round(runSummary.durationMs)}ms ` +
          `${runSummary.requestCount} requests (${runSummary.failedRequestCount} failed)` +
          (runSummary.error ? ` - ${runSummary.error}` : ""),
      );

      // クラッシュから正常に復帰できたら、次のクラッシュでもまた 1 回だけ再起動できるようにする。
      if (browser.isConnected()) relaunched = false;

      if (config.interval > 0) {
        const next = shouldStop(
          {
            completedRuns: summary.runs.length,
            runs: config.runs,
            until: config.until,
            signalReceived: signal?.aborted ?? false,
          },
          now(),
        );
        // 次のループで止まるとわかっているなら、最後の実行の後に待つ意味はない。
        if (next === null) await sleep(config.interval, signal);
      }
    }
  } finally {
    summary.meta.finishedAt = now().toISOString();
    summary.meta.stopReason = stopReason ?? "fatal";
    await writeSummary(outDir, summary);
    if (browser?.isConnected()) await browser.close();
  }

  return { outDir, summary };
}

async function launchBrowser(config: ResolvedConfig): Promise<Browser> {
  try {
    return await launchers[config.browser].launch({
      headless: config.headless,
      // Playwright 自身の SIGINT/SIGTERM/SIGHUP ハンドラに任せると、runner の finally より先に
      // ブラウザを閉じて process.exit してしまい、summary.json を確定できない。CLI 側で処理する。
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new BrowserLaunchError(
      `ブラウザ ${config.browser} を起動できません。未インストールなら ` +
        `pnpm exec playwright install ${config.browser} を実行してください。\n${message}`,
    );
  }
}

async function executeRun(
  browser: Browser,
  config: ResolvedConfig,
  outDir: string,
  index: number,
  now: () => Date,
): Promise<RunSummary> {
  const harPath = `run-${String(index).padStart(6, "0")}.har`;
  const harAbsPath = path.join(outDir, harPath);
  const startedAt = now();
  const t0 = performance.now();

  // ループ先頭の isConnected() チェックと newContext の間で切断が起きても、例外を素通しせず
  // 通常のエラー実行として記録する。次のループ先頭で再起動判定が行われる。
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      recordHar: { path: harAbsPath, content: config.harContent },
    });
  } catch (e) {
    return {
      index,
      startedAt: startedAt.toISOString(),
      endedAt: now().toISOString(),
      durationMs: performance.now() - t0,
      harPath,
      requestCount: 0,
      failedRequestCount: 0,
      transferBytes: 0,
      status: "error",
      error: `コンテキストを作成できませんでした: ${errorMessage(e)}`,
    };
  }

  let status: RunSummary["status"] = "ok";
  let error: string | null = null;

  try {
    const page = await context.newPage();
    await config.scenario(page);
  } catch (e) {
    status = "error";
    error = errorMessage(e);
  }

  const durationMs = performance.now() - t0;
  const endedAt = now();

  try {
    await context.close(); // ここで HAR が書き出される
  } catch (e) {
    if (status === "ok") {
      status = "error";
      error = `コンテキストを閉じられませんでした: ${errorMessage(e)}`;
    }
  }

  let metrics = { requestCount: 0, failedRequestCount: 0, transferBytes: 0 };
  try {
    metrics = summarizeHar(JSON.parse(await readFile(harAbsPath, "utf8")));
  } catch (e) {
    if (status === "ok") {
      status = "error";
      error = `HAR を読み込めませんでした: ${errorMessage(e)}`;
    }
  }

  return {
    index,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs,
    harPath,
    ...metrics,
    status,
    error,
  };
}

/** 一時ファイルに書いてから rename し、途中で落ちても壊れた JSON を残さない。 */
async function writeSummary(outDir: string, summary: Summary): Promise<void> {
  const target = path.join(outDir, "summary.json");
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await rename(tmp, target);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
