import type { SummaryMeta } from "../types.js";
import type { HeatmapCell, HeatmapData } from "./bucket.js";

export interface RenderOptions {
  data: HeatmapData;
  meta: SummaryMeta;
  sourcePath: string;
}

const CELL = 28;
const GAP = 2;
const LEFT = 96; // 日付ラベル幅
const TOP = 28; // 時ラベル高さ

const METRIC_LABEL = {
  "run-errors": "エラー実行",
  "failed-requests": "失敗リクエスト",
} as const;

/** 日付 × 時のヒートマップを自己完結の HTML 文字列として返す。 */
export function renderHeatmapHtml({ data, meta, sourcePath }: RenderOptions): string {
  const label = METRIC_LABEL[data.metric];
  const cellByKey = new Map(data.cells.map((c) => [`${c.date}#${c.hour}`, c]));
  const width = LEFT + 24 * (CELL + GAP);
  const height = TOP + data.dates.length * (CELL + GAP);

  const hourLabels = Array.from({ length: 24 }, (_, h) => {
    const x = LEFT + h * (CELL + GAP) + CELL / 2;
    return `<text class="axis" x="${x}" y="${TOP - 8}" text-anchor="middle">${h}</text>`;
  }).join("");

  const rows = data.dates
    .map((date, row) => {
      const y = TOP + row * (CELL + GAP);
      const dateLabel = `<text class="axis" x="${LEFT - 8}" y="${y + CELL / 2 + 4}" text-anchor="end">${date}</text>`;
      const cells = Array.from({ length: 24 }, (_, hour) => {
        const x = LEFT + hour * (CELL + GAP);
        return renderCell(cellByKey.get(`${date}#${hour}`), date, hour, x, y, data.max, label);
      }).join("");
      return dateLabel + cells;
    })
    .join("");

  const period =
    data.dates.length === 0 ? "-" : `${data.dates[0]} 〜 ${data.dates[data.dates.length - 1]}`;
  const inProgress = meta.stopReason === null;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>har-bench ヒートマップ ${escapeHtml(period)}</title>
<style>
  :root { --bg: #fbfaf7; --fg: #26231f; --muted: #6b665e; --empty: #e6e2da; --accent: 178, 52, 40; --line: #d8d3ca; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1c1b19; --fg: #ece8e0; --muted: #a29c92; --empty: #33312d; --accent: 235, 96, 80; --line: #3d3a35; }
  }
  body { margin: 0; padding: 32px; background: var(--bg); color: var(--fg); font: 14px/1.6 system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: var(--muted); font-size: 13px; margin: 0 0 16px; display: flex; flex-wrap: wrap; gap: 4px 16px; }
  .notice { display: inline-block; border: 1px solid rgb(var(--accent)); color: rgb(var(--accent)); border-radius: 4px; padding: 2px 8px; font-size: 12px; margin-bottom: 16px; }
  .chart { overflow-x: auto; }
  svg { display: block; font-variant-numeric: tabular-nums; }
  .axis { fill: var(--muted); font-size: 11px; }
  .cell { fill: rgb(var(--accent)); stroke: var(--bg); stroke-width: 1; }
  .cell.empty { fill: var(--empty); }
  .legend { display: flex; align-items: center; gap: 8px; margin-top: 16px; color: var(--muted); font-size: 12px; }
  .legend .bar { width: 160px; height: 12px; border: 1px solid var(--line); background: linear-gradient(to right, rgba(var(--accent), 0.12), rgb(var(--accent))); }
</style>
</head>
<body>
<h1>har-bench ヒートマップ</h1>
<p class="meta">
  <span>期間: ${escapeHtml(period)}</span>
  <span>値: ${label}数</span>
  <span>時刻: ${data.tz === "utc" ? "UTC" : "ローカル"}</span>
  <span>ブラウザ: ${escapeHtml(meta.browser)}${meta.headless ? " (headless)" : ""}</span>
  <span>実行数: ${data.cells.reduce((n, c) => n + c.runs, 0)}</span>
  <span>元ファイル: ${escapeHtml(sourcePath)}</span>
</p>
${inProgress ? '<p class="notice">計測中のデータ（summary.json は更新途中です）</p>' : ""}
<div class="chart">
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="日付と時間帯ごとの${label}数">
${hourLabels}
${rows}
</svg>
</div>
<p class="legend"><span>0</span><span class="bar"></span><span>最大 ${data.max}</span><span>（灰色は実行なし）</span></p>
</body>
</html>
`;
}

function renderCell(
  cell: HeatmapCell | undefined,
  date: string,
  hour: number,
  x: number,
  y: number,
  max: number,
  label: string,
): string {
  const hh = String(hour).padStart(2, "0");
  const range = `${date} ${hh}:00–${hh}:59`;
  if (!cell) {
    return `<rect class="cell empty" x="${x}" y="${y}" width="${CELL}" height="${CELL}"><title>${range}\n実行なし</title></rect>`;
  }
  const ratio = max === 0 ? 0 : cell.value / max;
  const opacity = (0.12 + 0.88 * ratio).toFixed(3);
  return (
    `<rect class="cell" x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill-opacity="${opacity}">` +
    `<title>${range}\n${label}: ${cell.value} 回\n実行: ${cell.runs} 回</title></rect>`
  );
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
