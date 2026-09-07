import { describe, expect, test } from "vitest";
import type { HeatmapData } from "../src/heatmap/bucket.js";
import { renderHeatmapHtml } from "../src/heatmap/render.js";
import type { SummaryMeta } from "../src/types.js";

const meta: SummaryMeta = {
  tool: "har-bench",
  version: "0.1.0",
  browser: "chromium",
  headless: true,
  runs: "unlimited",
  until: "2026-09-08T00:00:00.000Z",
  interval: 0,
  startedAt: "2026-09-06T00:00:00.000Z",
  finishedAt: "2026-09-07T12:00:00.000Z",
  stopReason: "until",
};

const data: HeatmapData = {
  metric: "run-errors",
  tz: "utc",
  dates: ["2026-09-06", "2026-09-07"],
  cells: [
    { date: "2026-09-06", hour: 10, runs: 4, value: 0 },
    { date: "2026-09-06", hour: 11, runs: 4, value: 3 },
    { date: "2026-09-07", hour: 0, runs: 2, value: 1 },
  ],
  max: 3,
};

function render(overrides: Partial<{ data: HeatmapData; meta: SummaryMeta }> = {}) {
  return renderHeatmapHtml({
    data: overrides.data ?? data,
    meta: overrides.meta ?? meta,
    sourcePath: "/tmp/out/summary.json",
  });
}

describe("renderHeatmapHtml", () => {
  test("日付数 × 24 のセルを描く", () => {
    const html = render();
    const cells = html.match(/<rect class="cell/g) ?? [];
    expect(cells).toHaveLength(2 * 24);
    const empty = html.match(/<rect class="cell empty"/g) ?? [];
    expect(empty).toHaveLength(2 * 24 - 3);
  });

  test("ツールチップに日付・時間帯・値・実行回数が入る", () => {
    const html = render();
    expect(html).toContain("2026-09-06 11:00–11:59");
    expect(html).toContain("エラー実行: 3 回");
    expect(html).toContain("実行: 4 回");
    expect(html).toContain("実行なし");
  });

  test("凡例に最大値が出る", () => {
    expect(render()).toContain("最大 3");
  });

  test("計測中（stopReason が null）なら注記を出す", () => {
    expect(render({ meta: { ...meta, stopReason: null, finishedAt: null } })).toContain(
      "計測中のデータ",
    );
    expect(render()).not.toContain("計測中のデータ");
  });

  test("failed-requests のラベルになる", () => {
    const html = render({ data: { ...data, metric: "failed-requests" } });
    expect(html).toContain("失敗リクエスト");
  });

  test("外部リソースを参照しない", () => {
    const html = render();
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
  });

  test("HTML エスケープする", () => {
    const html = renderHeatmapHtml({ data, meta, sourcePath: "/tmp/<x>/summary.json" });
    expect(html).toContain("&lt;x&gt;");
    expect(html).not.toContain("/tmp/<x>/");
  });
});
