import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { ConfigError, loadConfigFile, parseUntil, resolveConfig } from "../src/config.js";
import type { HarBenchConfig } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenario = async () => {};
const base: HarBenchConfig = { scenario };

describe("parseUntil", () => {
  // ローカル時刻 2026-09-06 10:00:00 を「今」とする
  const now = new Date(2026, 8, 6, 10, 0, 0);

  test("HH:mm が今日の未来なら今日", () => {
    const d = parseUntil("15:30", now);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 8, 6, 15, 30,
    ]);
  });

  test("HH:mm が今日すでに過ぎていれば翌日", () => {
    const d = parseUntil("09:00", now);
    expect([d.getDate(), d.getHours()]).toEqual([7, 9]);
  });

  test("HH:mm がちょうど今なら翌日", () => {
    expect(parseUntil("10:00", now).getDate()).toBe(7);
  });

  test("ISO 8601 の未来はそのまま", () => {
    expect(parseUntil("2026-09-07T03:00:00+09:00", now).toISOString()).toBe(
      "2026-09-06T18:00:00.000Z",
    );
  });

  test("過去の ISO は ConfigError", () => {
    expect(() => parseUntil("2020-01-01T00:00:00Z", now)).toThrow(ConfigError);
  });

  test("解釈できない文字列や範囲外の HH:mm は ConfigError", () => {
    expect(() => parseUntil("そのうち", now)).toThrow(ConfigError);
    expect(() => parseUntil("25:00", now)).toThrow(ConfigError);
  });
});

describe("resolveConfig", () => {
  test("既定値が入る", () => {
    const c = resolveConfig(base);
    expect(c).toMatchObject({
      runs: 1,
      until: null,
      interval: 0,
      browser: "chromium",
      headless: true,
      outDir: "./har-bench-out",
      harContent: "omit",
    });
    expect(c.scenario).toBe(scenario);
  });

  test("CLI が設定ファイルより優先される", () => {
    const c = resolveConfig(
      { ...base, runs: 3, browser: "firefox", outDir: "./a", interval: 100 },
      { runs: "7", browser: "webkit", out: "./b", interval: "250", headed: true },
    );
    expect(c).toMatchObject({
      runs: 7,
      browser: "webkit",
      outDir: "./b",
      interval: 250,
      headless: false,
    });
  });

  test("runs は unlimited を受け付ける", () => {
    expect(resolveConfig({ ...base, runs: "unlimited" }).runs).toBe("unlimited");
    expect(resolveConfig(base, { runs: "unlimited" }).runs).toBe("unlimited");
  });

  test("until は CLI 文字列でも設定ファイル文字列でも Date になる", () => {
    const now = new Date(2026, 8, 6, 10, 0, 0);
    expect(resolveConfig({ ...base, until: "12:00" }, {}, now)?.until?.getHours()).toBe(12);
    expect(resolveConfig(base, { until: "13:00" }, now)?.until?.getHours()).toBe(13);
  });

  test("har.content を harContent に写す", () => {
    expect(resolveConfig({ ...base, har: { content: "embed" } }).harContent).toBe("embed");
  });

  test("不正値は ConfigError", () => {
    expect(() => resolveConfig({ ...base, runs: 0 })).toThrow(ConfigError);
    expect(() => resolveConfig(base, { runs: "many" })).toThrow(ConfigError);
    expect(() => resolveConfig(base, { runs: "1.5" })).toThrow(ConfigError);
    expect(() => resolveConfig(base, { browser: "opera" })).toThrow(ConfigError);
    expect(() => resolveConfig({ ...base, interval: -1 })).toThrow(ConfigError);
    expect(() => resolveConfig(base, { interval: "abc" })).toThrow(ConfigError);
    expect(() => resolveConfig({ scenario: undefined as never })).toThrow(ConfigError);
  });
});

describe("loadConfigFile", () => {
  test("指定パスの TS 設定を読み込む", async () => {
    const config = await loadConfigFile(path.join(here, "fixtures/basic.config.ts"), process.cwd());
    expect(config.runs).toBe(3);
    expect(config.browser).toBe("firefox");
    expect(typeof config.scenario).toBe("function");
  });

  test("相対パスは cwd 基準", async () => {
    const config = await loadConfigFile("fixtures/basic.config.ts", here);
    expect(config.runs).toBe(3);
  });

  test("見つからなければ ConfigError", async () => {
    await expect(loadConfigFile(undefined, here)).rejects.toThrow(ConfigError);
    await expect(loadConfigFile("nope.config.ts", here)).rejects.toThrow(ConfigError);
  });
});
