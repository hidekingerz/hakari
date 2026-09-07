import { describe, expect, test } from "vitest";
import { summarizeHar } from "../src/har-summary.js";

function har(entries: unknown[]) {
  return { log: { version: "1.2", creator: { name: "Playwright", version: "1.63.0" }, entries } };
}

describe("summarizeHar", () => {
  test("件数・失敗数・転送バイト数を集計する", () => {
    const result = summarizeHar(
      har([
        { response: { status: 200, bodySize: 100, _transferSize: 120 } },
        { response: { status: 404, bodySize: 10, _transferSize: 30 } },
        { response: { status: 500, bodySize: 5, _transferSize: 25 } },
        {
          response: { status: 0, bodySize: -1, _transferSize: -1, _failureText: "net::ERR_FAILED" },
        },
      ]),
    );
    expect(result).toEqual({ requestCount: 4, failedRequestCount: 3, transferBytes: 175 });
  });

  test("_transferSize が無ければ bodySize を使い、どちらも無ければ 0", () => {
    const result = summarizeHar(
      har([{ response: { status: 200, bodySize: 40 } }, { response: { status: 200 } }]),
    );
    expect(result.transferBytes).toBe(40);
  });

  test("entries が空なら全部 0", () => {
    expect(summarizeHar(har([]))).toEqual({
      requestCount: 0,
      failedRequestCount: 0,
      transferBytes: 0,
    });
  });

  test("log.entries が無い入力は例外", () => {
    expect(() => summarizeHar({})).toThrow(/log\.entries/);
    expect(() => summarizeHar(null)).toThrow(/log\.entries/);
  });
});
