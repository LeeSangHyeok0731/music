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
 *
 * `degree`가 음수·소수·NaN이면 배열 밖을 읽어 `NaN` 음이 조용히 나오므로 던진다.
 */
export function chordPitch(chord: Chord, degree: number, octave: number): number {
  if (!Number.isInteger(degree) || degree < 0) {
    throw new RangeError(`degree는 0 이상의 정수여야 합니다: ${degree}`);
  }
  const tones = INTERVALS[chord.quality];
  const wraps = Math.floor(degree / tones.length);
  const tone = tones[degree % tones.length];
  return 12 * (octave + 1) + chord.root + tone + 12 * wraps;
}

/** 근음 이름(샤프 표기). 인덱스가 근음 번호(C=0). */
export const ROOT_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/** 코드 이름 뒤에 붙는 종류 접미. */
export const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: "",
  min: "m",
  dom7: "7",
  maj7: "maj7",
  min7: "m7",
};

/**
 * 화면에 보이는 코드 이름: `Am`, `G7`, `F#maj7`. 근음이 0..11의 정수가 아니면
 * 이름을 만들 수 없으므로 RangeError(`undefined`가 이름에 섞이지 않게 한다).
 */
export function chordLabel(chord: Chord): string {
  if (!Number.isInteger(chord.root) || chord.root < 0 || chord.root > 11) {
    throw new RangeError(`root는 0..11의 정수여야 합니다: ${chord.root}`);
  }
  return ROOT_NAMES[chord.root] + QUALITY_SUFFIX[chord.quality];
}

/**
 * 코드 구성음의 피치 클래스(0..11, 오름차순, 중복 없음). `chordPitch`와 같은 간격 표에서
 * 만든다 — 피아노롤이 코드 구성음 행을 칠하는 데 쓴다. 근음이 0..11의 정수가 아니면
 * RangeError(`chordLabel`과 같다).
 */
export function chordPitchClasses(chord: Chord): number[] {
  if (!Number.isInteger(chord.root) || chord.root < 0 || chord.root > 11) {
    throw new RangeError(`root는 0..11의 정수여야 합니다: ${chord.root}`);
  }
  const classes = new Set(INTERVALS[chord.quality].map((i) => (chord.root + i) % 12));
  return [...classes].sort((a, b) => a - b);
}
