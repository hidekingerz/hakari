import type { StopReason } from "./types.js";

export interface StopState {
  completedRuns: number;
  runs: number | "unlimited";
  until: Date | null;
  signalReceived: boolean;
}

/** 次の実行を始める前に呼ぶ。止めるべきなら理由を、続行なら null を返す。判定順は signal → count → until。 */
export function shouldStop(state: StopState, now: Date): StopReason | null {
  if (state.signalReceived) return "signal";
  if (state.runs !== "unlimited" && state.completedRuns >= state.runs) return "count";
  if (state.until !== null && now.getTime() >= state.until.getTime()) return "until";
  return null;
}
