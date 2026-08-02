/** 반음 포함 12음의 계이름. 인덱스가 옥타브 안에서의 위치다. */
const NAMES = [
  "도",
  "도#",
  "레",
  "레#",
  "미",
  "파",
  "파#",
  "솔",
  "솔#",
  "라",
  "라#",
  "시",
];

/** 반음이 아닌 7음. 건반의 흰건 순서다. */
export const NATURAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/** 반음. 건반의 검은건. 인덱스는 왼쪽 흰건 기준이다. */
export const SHARP_SEMITONES = [1, 3, 6, 8, 10] as const;

export const MIN_OCTAVE = 1;
export const MAX_OCTAVE = 7;

/** MIDI 60 → "도4". 타일과 음 선택기에 표시할 이름. */
export function midiToName(note: number): string {
  return `${NAMES[((note % 12) + 12) % 12]}${octaveOf(note)}`;
}

/** MIDI 60 → 4. 도가 옥타브의 시작이다. */
export function octaveOf(note: number): number {
  return Math.floor(note / 12) - 1;
}

/** 옥타브와 반음 위치로 MIDI 번호를 만든다. 4옥타브 도 → 60. */
export function midiOf(octave: number, semitone: number): number {
  return (octave + 1) * 12 + semitone;
}
