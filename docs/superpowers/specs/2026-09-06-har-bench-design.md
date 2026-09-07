# har-bench 設計書

日付: 2026-09-06
状態: 承認済み

## 1. 目的

ウェブサイトのネットワーク処理が適切に行えているかを確認するため、ブラウザを自動操作し、通信記録を HAR 形式で保存する計測ツール。任意の Playwright シナリオを、指定回数・無制限・指定時刻までのいずれかの条件で繰り返し実行し、実行ごとのサマリーと、日付 × 時間帯のエラー回数ヒートマップを出力する。

hakari リポジトリに入る最初の計測ツールであり、リポジトリは今後複数ツールを収める pnpm workspace モノレポとする。

## 2. 要件

- Playwright でブラウザを自動操作する。Chromium / Firefox / WebKit をフラグで選べる。
- 通信記録はミリ秒単位で記録される（HAR の `startedDateTime` と `timings`）。
- 通信時の HAR ファイルが実行ごとに取得できる。
- 停止条件を「指定回数」「無制限」「指定時刻まで」から選べる。
- 実行ごとのサマリーを JSON で出力する。
- サマリーから日付 × 1 時間ごとのエラー回数ヒートマップ（単一 HTML）を生成できる。

## 3. 実現方式

Playwright の `browser.newContext({ recordHar })` を薄くラップする。HAR は Playwright が生成し、コンテキストを閉じたときに書き出される。サマリーは書き出された HAR を読み込んで算出する。

不採用案:

- CDP から HAR を自前構築する案。マイクロ秒精度は得られるが Chromium 限定になり、3 ブラウザ対応と衝突する。
- `@playwright/test` の `repeatEach` に乗せる案。出力ファイル名やサマリー生成の制御がしづらく、計測ツールとしての体裁にならない。

## 4. リポジトリ構成

```
hakari/
  package.json            # private。pnpm workspace ルート
  pnpm-workspace.yaml     # packages/*
  tsconfig.base.json      # 共通 TS 設定（strict, NodeNext, ES2022）
  biome.json              # lint + format
  docs/superpowers/specs/ # 設計書
  packages/
    har-bench/
      package.json        # name: @hakari/har-bench, bin: hakari-har-bench
      src/
        cli.ts            # サブコマンド振り分け（run / heatmap）
        config.ts         # defineConfig、設定ファイル読込、CLI マージ、検証
        stop.ts           # 停止判定 shouldStop（純粋関数）
        runner.ts         # ブラウザ起動、繰り返しループ、HAR 保存、summary.json 書込
        har-summary.ts    # HAR JSON → 1 実行分のサマリー（純粋関数）
        aggregate.ts      # 実行サマリー配列 → 統計（純粋関数）
        heatmap/
          bucket.ts       # runs[] → 日付 × 時の集計（純粋関数）
          render.ts       # 集計結果 → HTML 文字列（純粋関数）
          cli.ts          # heatmap サブコマンドの入出力
        types.ts          # 設定・サマリーの型
      test/
      README.md
```

ツールチェーン: Node 24、pnpm、TypeScript、vitest、Biome。設定ファイル（TS）の読込には `jiti` を使う。CLI 引数解析は `commander`。

## 5. 設定ファイルと CLI

設定ファイル `har-bench.config.ts` をカレントディレクトリから探す。`--config` で明示もできる。

```ts
import { defineConfig } from "@hakari/har-bench";

export default defineConfig({
  runs: 5,                              // 数値 または "unlimited"。省略時 1
  until: "2026-09-07T03:00:00+09:00",   // 任意。ISO 8601 または "HH:mm"
  interval: 0,                          // 任意。実行間の待機 ms。省略時 0
  browser: "chromium",                  // "chromium" | "firefox" | "webkit"。省略時 chromium
  headless: true,                       // 省略時 true
  outDir: "./har-bench-out",            // 省略時 "./har-bench-out"
  har: { content: "omit" },             // "omit" | "embed"。省略時 omit
  scenario: async (page) => {           // 必須
    await page.goto("https://example.com", { waitUntil: "networkidle" });
  },
});
```

`scenario` は Playwright の `Page` を受け取る非同期関数。ツールがブラウザ・コンテキスト・HAR 記録を用意し、各実行でこの関数を呼ぶ。

停止条件のルール:

- `runs` は 1 以上の整数、または `"unlimited"`。
- `until` は ISO 8601 の日時、または `HH:mm`。`HH:mm` は今日のその時刻を指し、すでに過ぎていれば翌日。
- `runs` と `until` を両方指定したときは先に到達したほうで停止する。
- `runs: "unlimited"` で `until` 無しのときは SIGINT / SIGTERM が唯一の停止手段。

CLI:

```
hakari-har-bench run [--config <path>] [--runs <n|unlimited>] [--until <ISO|HH:mm>]
                     [--interval <ms>] [--browser <name>] [--headed] [--out <dir>]
hakari-har-bench heatmap <summary.json> [--out <html>] [--metric run-errors|failed-requests] [--tz local|utc]
```

CLI オプションは設定ファイルの値を上書きする。優先順位は CLI > 設定ファイル > 既定値。

設定エラー（即時終了、終了コード 2）:

- 設定ファイルが見つからない、`scenario` が関数でない
- `runs` が 0 以下・非整数・`"unlimited"` 以外の文字列
- `until` が解釈できない、または過去の日時
- `browser` が 3 種以外
- `interval` が負

## 6. 実行フロー（run）

1. 設定を読み込み検証する。出力ディレクトリ `outDir/<ISO タイムスタンプ（コロンをハイフンに置換）>/` を作る。
2. 指定ブラウザを 1 回だけ起動する。毎回起動すると計測が起動時間に引きずられるため。
3. ループ先頭で `shouldStop` を評価する。回数上限、`until` 超過、シグナル受信のいずれかなら抜ける。
4. `browser.newContext({ recordHar: { path: run-NNNNNN.har, content } })` で新しいコンテキストを作る。キャッシュ・Cookie は持ち越さない。
5. ページを開き `scenario(page)` を呼ぶ。開始・終了を壁時計（`Date.now()`）と `performance.now()` で記録する。
6. `context.close()` で HAR を確定させる。
7. HAR を読み込んで実行サマリーを算出し、`aggregate` を再計算して `summary.json` を上書き保存する。
8. `interval` があれば待ってから 3 に戻る。
9. ループ終了後、`stopReason` を確定して `summary.json` を最終保存し、ブラウザを閉じる。

HAR ファイル名は `run-000001.har` のように 6 桁ゼロ埋めとする。

シグナル処理: SIGINT / SIGTERM を受けたら実行中のシナリオは完了させ、その HAR とサマリーを書いてから終了する。2 回目のシグナルは即時終了とする。

ブラウザクラッシュ: 1 回だけ再起動を試みて継続する。再起動も失敗したら `stopReason: "fatal"` で終了する。定期的な再起動は行わない。

## 7. 出力形式

```
har-bench-out/2026-09-06T13-05-22.123Z/
  run-000001.har
  run-000002.har
  summary.json
```

`summary.json`:

```ts
interface Summary {
  meta: {
    tool: "har-bench";
    version: string;
    browser: "chromium" | "firefox" | "webkit";
    headless: boolean;
    runs: number | "unlimited";
    until: string | null;          // ISO 8601
    interval: number;
    startedAt: string;             // ISO 8601（ms 含む）
    finishedAt: string | null;     // 実行中は null
    stopReason: "count" | "until" | "signal" | "fatal" | null;  // 実行中は null
  };
  runs: RunSummary[];
  aggregate: Aggregate;
}

interface RunSummary {
  index: number;                   // 1 始まり
  startedAt: string;               // ISO 8601（ms 含む）
  endedAt: string;
  durationMs: number;              // performance.now() 差分
  harPath: string;                 // 出力ディレクトリからの相対パス
  requestCount: number;
  failedRequestCount: number;      // ネットワークエラー、または HTTP 4xx/5xx
  transferBytes: number;           // entries[].response._transferSize の合計。無ければ bodySize
  status: "ok" | "error";
  error: string | null;            // status が error のときのメッセージ
}

interface Aggregate {
  okRuns: number;
  errorRuns: number;
  durationMs: Stats;
  requestCount: Stats;
  transferBytes: Stats;
}

interface Stats { min: number; max: number; mean: number; median: number; p95: number; }  // ok の実行のみ対象。0 件なら全て 0
```

## 8. エラー処理（run）

- シナリオが例外を投げた実行は `status: "error"` として記録し、HAR はそのまま保存して残りの実行を続行する。
- 全実行終了後、1 件でも `error` があれば終了コード 1。
- ブラウザ起動失敗・設定エラーは終了コード 2。
- Playwright のブラウザ未インストール時は `pnpm exec playwright install <browser>` を案内するメッセージを出す。

## 9. ヒートマップ生成（heatmap）

入力は `summary.json`。追加のデータ収集は不要で、`runs[]` の `startedAt`・`status`・`failedRequestCount` だけを使う。

集計: 各実行の `startedAt` を `--tz`（既定 `local`）で日付と時 (0〜23) に丸め、日付 × 時のセルに積み上げる。

- `--metric run-errors`（既定）: `status: "error"` の実行数
- `--metric failed-requests`: `failedRequestCount` の合計

描画: 外部ライブラリなしの自己完結 HTML を 1 ファイル出力する（既定の出力先は入力と同じディレクトリの `heatmap.html`）。縦に日付、横に 0〜23 時のセルを SVG で並べ、色の濃さで値を表す。セルにホバーすると日付・時間帯・値・その時間帯の実行回数をツールチップで表示する。実行がなかった時間帯は灰色の空セルとし、値 0 と区別する。凡例に最大値を示す。`stopReason` が `null` のファイルはヘッダに「計測中のデータ」と注記する。

エラー処理: `summary.json` が読めない、`meta.tool` が `"har-bench"` でない、`runs` が空のときはメッセージを出して終了コード 2。

## 10. テスト

単体（vitest）:

- `har-summary.ts`: 固定 HAR フィクスチャから件数・失敗数・バイト数を算出する。
- `aggregate.ts`: min / max / mean / median / p95、0 件時の挙動。
- `config.ts`: CLI 上書きの優先順位、`HH:mm` の解釈（今日/翌日）、`runs` と `until` の併用、各種不正値。
- `stop.ts`: 回数・時刻・シグナルの各条件と組み合わせ。
- `heatmap/bucket.ts`: 日付境界（23:59 → 0:00）、タイムゾーン差、空データ、両メトリクス。
- `heatmap/render.ts`: 出力 HTML にセル数・凡例・計測中注記が含まれる。

統合（vitest、Chromium headless 必須）:

- `node:http` でページと数個のリソースを配信し、`runs: 2` で実行。HAR が 2 つ生成され `entries[].timings` が数値で入っていること、`summary.json` の構造を検証する。
- `until` を「現在 + 数秒」に設定して実行し、複数回走って時刻超過で止まること、途中で `summary.json` が更新されることを検証する。
- `run` の出力を `heatmap` に渡して HTML が生成されることを検証する。

シグナル停止は統合テストでは扱わず、`stop.ts` の単体テストでカバーする。

## 11. スコープ外

- ブラウザの定期再起動
- 同一コンテキストの使い回し（ウォームキャッシュ計測）
- PNG / SVG 単体でのグラフ出力
- リクエスト単位のタイムライン出力（HAR で代替）
