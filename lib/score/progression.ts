import type { Chord, ChordSegment, Song } from "./model";
import { ticksPerBar } from "./time";

/** 새 곡의 진행: 곡 전체가 C maj 한 구간이다. */
export function defaultProgression(
  bars: number,
  timeSignature: Song["timeSignature"],
): ChordSegment[] {
  return [
    {
      start: 0,
      length: bars * ticksPerBar(timeSignature),
      chord: { root: 0, quality: "maj" },
    },
  ];
}

/**
 * `tick`이 속한 구간의 인덱스. 구간은 start 오름차순으로 곡을 덮는다는
 * 불변식에 기댄다(이분 탐색). 어느 구간에도 속하지 않으면 RangeError —
 * 검증된 곡에서는 일어나지 않는다.
 */
export function segmentIndexAt(
  progression: readonly ChordSegment[],
  tick: number,
): number {
  let lo = 0;
  let hi = progression.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = progression[mid];
    if (tick < seg.start) hi = mid - 1;
    else if (tick >= seg.start + seg.length) lo = mid + 1;
    else return mid;
  }
  throw new RangeError(`코드 진행이 이 틱을 덮지 않습니다: ${tick}`);
}

export function chordAt(
  progression: readonly ChordSegment[],
  tick: number,
): Chord {
  return progression[segmentIndexAt(progression, tick)].chord;
}
