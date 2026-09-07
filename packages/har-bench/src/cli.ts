#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command, InvalidArgumentError } from "commander";
import { type CliOverrides, ConfigError, loadConfigFile, resolveConfig } from "./config.js";
import { collectFailures } from "./failures/cli.js";
import { formatJson, formatText } from "./failures/format.js";
import type { HeatmapMetric, HeatmapTz } from "./heatmap/bucket.js";
import { generateHeatmap } from "./heatmap/cli.js";
import { SummaryInputError } from "./read-summary.js";
import { BrowserLaunchError, run } from "./runner.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command()
  .name("hakari-har-bench")
  .description(
    "Playwright シナリオを繰り返し実行し、HAR と summary.json、ヒートマップ、失敗一覧を出力する",
  )
  .version(version);

program
  .command("run")
  .description("設定ファイルのシナリオを繰り返し実行し、HAR と summary.json を出力する")
  .option("--config <path>", "設定ファイルのパス（既定: ./har-bench.config.ts）")
  .option("--runs <n|unlimited>", "実行回数。unlimited で無制限")
  .option("--until <ISO|HH:mm>", "この時刻に達したら停止する")
  .option("--interval <ms>", "実行と実行の間に待つミリ秒")
  .option("--browser <name>", "chromium | firefox | webkit")
  .option("--headed", "ブラウザを表示して実行する")
  .option("--out <dir>", "出力ディレクトリ")
  .action(async (opts: CliOverrides) => {
    const file = await loadConfigFile(opts.config, process.cwd());
    const config = resolveConfig(file, opts);

    const controller = new AbortController();
    let signalCount = 0;
    const onSignal = (name: string) => {
      signalCount += 1;
      if (signalCount >= 2) {
        console.error("強制終了します");
        process.exit(130);
      }
      console.error(
        `${name} を受信しました。実行中のシナリオを終えてから停止します（もう一度で強制終了）`,
      );
      controller.abort();
    };
    process.on("SIGINT", () => onSignal("SIGINT"));
    process.on("SIGTERM", () => onSignal("SIGTERM"));

    console.error(
      `har-bench ${version}: ${config.browser}${config.headless ? " (headless)" : ""}, ` +
        `runs=${config.runs}${config.until ? `, until=${config.until.toISOString()}` : ""}` +
        `${config.interval ? `, interval=${config.interval}ms` : ""}`,
    );
    const result = await run({ config, version, signal: controller.signal, log: console.error });
    const { stopReason } = result.summary.meta;
    const { okRuns, errorRuns } = result.summary.aggregate;
    console.error(
      `完了: ok ${okRuns} / error ${errorRuns}, 停止理由 ${stopReason}\n出力先: ${result.outDir}`,
    );

    if (stopReason === "fatal") process.exitCode = 2;
    else if (errorRuns > 0) process.exitCode = 1;
  });

program
  .command("heatmap")
  .description("summary.json から日付×時間帯のエラー回数ヒートマップ HTML を生成する")
  .argument("<summary>", "summary.json のパス")
  .option("--out <html>", "出力先 HTML（既定: summary.json と同じディレクトリの heatmap.html）")
  .option(
    "--metric <metric>",
    "run-errors | failed-requests",
    choice(["run-errors", "failed-requests"]),
    "run-errors",
  )
  .option("--tz <tz>", "local | utc", choice(["local", "utc"]), "local")
  .action(async (summary: string, opts: { out?: string; metric: HeatmapMetric; tz: HeatmapTz }) => {
    const { outPath, data } = await generateHeatmap({
      input: summary,
      out: opts.out,
      metric: opts.metric,
      tz: opts.tz,
    });
    console.error(
      `ヒートマップを書き出しました: ${outPath}（${data.dates.length} 日, 最大 ${data.max}）`,
    );
  });

program
  .command("failures")
  .description("summary.json と HAR から、error になった実行と失敗リクエストを一覧する")
  .argument("<summary>", "summary.json のパス")
  .option("--json", "テキストではなく JSON で出力する")
  .option("--no-requests", "HAR を走査せず、error になった実行だけを出す")
  .action(async (summary: string, opts: { json?: boolean; requests: boolean }) => {
    const report = await collectFailures({
      input: summary,
      requests: opts.requests,
      warn: (message) => console.error(`警告: ${message}`),
    });
    process.stdout.write(opts.json ? formatJson(report) : formatText(report));
  });

function choice<T extends string>(choices: readonly T[]) {
  return (value: string): T => {
    if (!choices.includes(value as T)) {
      throw new InvalidArgumentError(`次のいずれかを指定してください: ${choices.join(", ")}`);
    }
    return value as T;
  };
}

program.parseAsync(process.argv).catch((e: unknown) => {
  if (
    e instanceof ConfigError ||
    e instanceof BrowserLaunchError ||
    e instanceof SummaryInputError
  ) {
    console.error(`エラー: ${e.message}`);
    process.exit(2);
  }
  console.error(e);
  process.exit(2);
});
