import { describe, expect, test } from "vitest";
import { shouldStop } from "../src/stop.js";

const now = new Date("2026-09-06T10:00:00Z");
const later = new Date("2026-09-06T11:00:00Z");

describe("shouldStop", () => {
  test("回数に達していなければ続行", () => {
    expect(
      shouldStop({ completedRuns: 2, runs: 3, until: null, signalReceived: false }, now),
    ).toBeNull();
  });

  test("回数に達したら count", () => {
    expect(shouldStop({ completedRuns: 3, runs: 3, until: null, signalReceived: false }, now)).toBe(
      "count",
    );
  });

  test("unlimited は回数では止まらない", () => {
    expect(
      shouldStop(
        { completedRuns: 100000, runs: "unlimited", until: null, signalReceived: false },
        now,
      ),
    ).toBeNull();
  });

  test("until に達したら until", () => {
    const state = {
      completedRuns: 0,
      runs: "unlimited" as const,
      until: later,
      signalReceived: false,
    };
    expect(shouldStop(state, now)).toBeNull();
    expect(shouldStop(state, later)).toBe("until");
    expect(shouldStop(state, new Date(later.getTime() + 1))).toBe("until");
  });

  test("runs と until の併用は先に到達したほう", () => {
    expect(
      shouldStop({ completedRuns: 3, runs: 3, until: later, signalReceived: false }, now),
    ).toBe("count");
    expect(
      shouldStop({ completedRuns: 1, runs: 3, until: later, signalReceived: false }, later),
    ).toBe("until");
  });

  test("シグナルは他の条件より優先", () => {
    expect(
      shouldStop({ completedRuns: 3, runs: 3, until: later, signalReceived: true }, later),
    ).toBe("signal");
    expect(
      shouldStop({ completedRuns: 0, runs: "unlimited", until: null, signalReceived: true }, now),
    ).toBe("signal");
  });
});
