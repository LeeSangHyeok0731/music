import { PPQ } from "./types";

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm);
}

export function secondsToTicks(seconds: number, bpm: number): number {
  return ((seconds * bpm) / 60) * PPQ;
}

/** 박 하나의 길이(틱). beatUnit이 4(4분음표)가 아니면 PPQ를 그만큼 환산한다. */
export function ticksPerBeat(ts: [number, number]): number {
  const [, beatUnit] = ts;
  return PPQ * (4 / beatUnit);
}

export function ticksPerBar(ts: [number, number]): number {
  const [beatsPerBar] = ts;
  return ticksPerBeat(ts) * beatsPerBar;
}

/** 1부터 세는 마디와 박을 돌려준다. */
export function ticksToBarBeat(
  ticks: number,
  ts: [number, number],
): { bar: number; beat: number } {
  const beat = ticksPerBeat(ts);
  const perBar = ticksPerBar(ts);
  const clamped = Math.max(0, ticks);

  return {
    bar: Math.floor(clamped / perBar) + 1,
    beat: Math.floor((clamped % perBar) / beat) + 1,
  };
}
