# @hakari/har-bench

Playwright のシナリオを繰り返し実行し、実行ごとの HAR ファイルと `summary.json`、日付×時間帯のエラー回数ヒートマップを出力する計測ツールです。

## セットアップ

```bash
pnpm install
pnpm --filter @hakari/har-bench exec playwright install chromium   # firefox / webkit も同様
pnpm build
```

## 設定ファイル

カレントディレクトリの `har-bench.config.ts` を読みます（`--config` で変更可）。

```ts
import { defineConfig } from "@hakari/har-bench";

export default defineConfig({
  runs: 5,                              // 回数。"unlimited" で無制限。既定 1
  until: "2026-09-07T03:00:00+09:00",   // 任意。ISO 8601 か "HH:mm"（今日、過ぎていれば翌日）
  interval: 0,                          // 任意。実行間の待機 ms
  browser: "chromium",                  // chromium | firefox | webkit
  headless: true,
  outDir: "./har-bench-out",
  har: { content: "omit" },             // omit | embed（レスポンス本文を HAR に含めるか）
  scenario: async (page) => {
    await page.goto("https://example.com", { waitUntil: "networkidle" });
  },
});
```

`runs` と `until` を両方指定したときは、先に到達したほうで止まります。

## 実行

```bash
hakari-har-bench run [--config <path>] [--runs <n|unlimited>] [--until <ISO|HH:mm>] \
                     [--interval <ms>] [--browser <name>] [--headed] [--out <dir>]
```

CLI オプションは設定ファイルより優先されます。Ctrl+C を押すと実行中のシナリオを終えてから停止します（もう一度押すと強制終了）。

毎回新しいブラウザコンテキストで実行するため、キャッシュや Cookie は持ち越されません。

## 出力

```
har-bench-out/2026-09-06T13-05-22.123Z/
  run-000001.har
  run-000002.har
  summary.json
```

`summary.json` は毎実行後に上書きされるので、長時間実行の途中でも読めます。`meta.stopReason` が `null` なら実行中です。

- `meta`: ブラウザ、停止条件、開始・終了時刻、停止理由（`count` / `until` / `signal` / `fatal`）
- `runs[]`: 実行ごとの開始・終了時刻、所要時間 (ms)、HAR パス、リクエスト数、失敗リクエスト数（ネットワークエラーまたは HTTP 4xx/5xx）、転送バイト数、ステータス
- `aggregate`: `ok` の実行に対する所要時間・リクエスト数・転送バイト数の min / max / mean / median / p95

終了コード: 正常 0、`error` の実行があれば 1、設定エラー・ブラウザ起動失敗・致命的エラーは 2。

## ヒートマップ

```bash
hakari-har-bench heatmap <summary.json> [--out <html>] [--metric run-errors|failed-requests] [--tz local|utc]
```

縦に日付、横に 0〜23 時を並べ、色の濃さでエラー回数を表す HTML を 1 ファイル出力します（既定は `summary.json` と同じディレクトリの `heatmap.html`）。セルにマウスを乗せると値と実行回数が見えます。灰色は実行がなかった時間帯です。

- `run-errors`（既定）: シナリオが例外で終わった実行の回数
- `failed-requests`: 失敗リクエストの合計

## 開発

```bash
pnpm test        # 統合テストは Chromium が必要
pnpm typecheck
pnpm lint
```
