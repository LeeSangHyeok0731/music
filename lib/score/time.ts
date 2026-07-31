import { PPQ } from "./types";

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm);
}

export function secondsToTicks(seconds: number, bpm: number): number {
  return ((seconds * bpm) / 60) * PPQ;
}

export function ticksPerBar(ts: [number, number]): number {
  const [beatsPerBar, beatUnit] = ts;
  const ticksPerBeat = PPQ * (4 / beatUnit);
  return ticksPerBeat * beatsPerBar;
}

/** 1부터 세는 마디와 박을 돌려준다. */
export function ticksToBarBeat(
  ticks: number,
  ts: [number, number],
): { bar: number; beat: number } {
  const [, beatUnit] = ts;
  const ticksPerBeat = PPQ * (4 / beatUnit);
  const perBar = ticksPerBar(ts);
  const clamped = Math.max(0, ticks);

  return {
    bar: Math.floor(clamped / perBar) + 1,
    beat: Math.floor((clamped % perBar) / ticksPerBeat) + 1,
  };
}
