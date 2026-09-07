import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readSummary, SummaryInputError } from "../src/read-summary.js";
import { makeRun } from "./helpers.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "har-bench-read-summary-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const meta = {
  tool: "har-bench",
  version: "0.1.0",
  browser: "chromium",
  headless: true,
  runs: 1,
  until: null,
  interval: 0,
  startedAt: "2026-09-06T10:00:00.000Z",
  finishedAt: "2026-09-06T10:00:01.000Z",
  stopReason: "count",
};

async function write(name: string, content: string) {
  const p = path.join(dir, name);
  await writeFile(p, content, "utf8");
  return p;
}

describe("readSummary", () => {
  test("正しい summary.json を Summary として返す", async () => {
    const p = await write(
      "summary.json",
      JSON.stringify({ meta, runs: [makeRun()], aggregate: {} }),
    );
    const summary = await readSummary(p);
    expect(summary.meta.tool).toBe("har-bench");
    expect(summary.runs).toHaveLength(1);
  });

  test("読めないファイルは SummaryInputError（読み込めません）", async () => {
    await expect(readSummary(path.join(dir, "nope.json"))).rejects.toThrow(/読み込めません/);
    await expect(readSummary(path.join(dir, "nope.json"))).rejects.toThrow(SummaryInputError);
  });

  test("JSON でない・tool が違う・runs が空は SummaryInputError", async () => {
    await expect(readSummary(await write("a.json", "{{{"))).rejects.toThrow(/JSON として不正/);
    await expect(
      readSummary(
        await write("b.json", JSON.stringify({ meta: { ...meta, tool: "x" }, runs: [] })),
      ),
    ).rejects.toThrow(/har-bench の summary\.json ではありません/);
    await expect(
      readSummary(await write("c.json", JSON.stringify({ meta, runs: [] }))),
    ).rejects.toThrow(/runs が空/);
  });
});
