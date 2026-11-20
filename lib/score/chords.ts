import type { Chord, ChordQuality } from "./model";

/** 근음에서 각 구성음까지의 반음 간격. */
const INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
};

/**
 * 코드의 `degree`번째 구성음을 MIDI 번호로 바꾼다.
 *
 * `octave`는 C4=60 규약이다(`12 * (octave + 1) + root + 간격`).
 * `degree`가 구성음 수를 넘으면 한 옥타브씩 올려 감는다 — 3화음에서
 * degree 3은 한 옥타브 위 근음이다. 그래서 패턴 하나가 3화음과 7화음에
 * 모두 쓰인다.
 */
export function chordPitch(chord: Chord, degree: number, octave: number): number {
  const tones = INTERVALS[chord.quality];
  const wraps = Math.floor(degree / tones.length);
  const tone = tones[degree % tones.length];
  return 12 * (octave + 1) + chord.root + tone + 12 * wraps;
}
