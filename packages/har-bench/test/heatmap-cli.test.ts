import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { generateHeatmap, HeatmapInputError } from "../src/heatmap/cli.js";
import type { Summary } from "../src/types.js";
import { makeRun } from "./helpers.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "har-bench-heatmap-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    meta: {
      tool: "har-bench",
      version: "0.1.0",
      browser: "chromium",
      headless: true,
      runs: 2,
      until: null,
      interval: 0,
      startedAt: "2026-09-06T10:00:00.000Z",
      finishedAt: "2026-09-06T10:00:05.000Z",
      stopReason: "count",
    },
    runs: [
      makeRun({ index: 1, startedAt: "2026-09-06T10:00:00.000Z" }),
      makeRun({ index: 2, startedAt: "2026-09-06T10:00:02.000Z", status: "error", error: "x" }),
    ],
    aggregate: {
      okRuns: 1,
      errorRuns: 1,
      durationMs: { min: 1000, max: 1000, mean: 1000, median: 1000, p95: 1000 },
      requestCount: { min: 10, max: 10, mean: 10, median: 10, p95: 10 },
      transferBytes: { min: 5000, max: 5000, mean: 5000, median: 5000, p95: 5000 },
    },
    ...overrides,
  };
}

async function writeSummary(s: unknown, name = "summary.json") {
  const p = path.join(dir, name);
  await writeFile(p, JSON.stringify(s), "utf8");
  return p;
}

describe("generateHeatmap", () => {
  test("既定では summary.json と同じディレクトリに heatmap.html を書く", async () => {
    const input = await writeSummary(summary());
    const { outPath, data } = await generateHeatmap({ input, metric: "run-errors", tz: "utc" });
    expect(outPath).toBe(path.join(dir, "heatmap.html"));
    expect(data.max).toBe(1);
    const html = await readFile(outPath, "utf8");
    expect(html).toContain("<svg");
    expect(html).toContain("2026-09-06");
  });

  test("--out で出力先を変えられる", async () => {
    const input = await writeSummary(summary());
    const out = path.join(dir, "sub", "x.html");
    const { outPath } = await generateHeatmap({ input, out, metric: "run-errors", tz: "utc" });
    expect(outPath).toBe(out);
    await expect(readFile(out, "utf8")).resolves.toContain("<svg");
  });

  test("読めないファイルは HeatmapInputError", async () => {
    await expect(
      generateHeatmap({ input: path.join(dir, "nope.json"), metric: "run-errors", tz: "utc" }),
    ).rejects.toThrow(HeatmapInputError);
  });

  test("JSON でない・tool が違う・runs が空 は HeatmapInputError", async () => {
    const notJson = path.join(dir, "a.json");
    await writeFile(notJson, "{{{", "utf8");
    await expect(
      generateHeatmap({ input: notJson, metric: "run-errors", tz: "utc" }),
    ).rejects.toThrow(/JSON/);
    const wrongTool = await writeSummary(
      { ...summary(), meta: { ...summary().meta, tool: "other" } },
      "b.json",
    );
    await expect(
      generateHeatmap({ input: wrongTool, metric: "run-errors", tz: "utc" }),
    ).rejects.toThrow(/har-bench/);
    const empty = await writeSummary(summary({ runs: [] }), "c.json");
    await expect(
      generateHeatmap({ input: empty, metric: "run-errors", tz: "utc" }),
    ).rejects.toThrow(/runs が空/);
  });
});
