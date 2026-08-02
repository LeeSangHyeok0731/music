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

/** 반음. 건반의 검은건. 값은 옥타브 안에서의 반음 위치(0~11)이고, 배열
 * 순서 자체에는 의미가 없다 — 검은건이 어느 흰건 이음매에 걸치는지는
 * 값별로 따로 표를 둬서 판단한다(NotePickerModal의 SHARP_SEAM_INDEX). */
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

/** 옥타브와 반음 위치로 MIDI 번호를 만든다. 4옥타브 도 → 60.
 * semitone을 midiToName과 같은 방식으로 정규화한다 — 안 하면
 * midiOf(octaveOf(n), n % 12)가 n < 0에서 깨진다. JS의 %는 부호를
 * 유지해서 n % 12가 음수가 될 수 있고, 그러면 이 함수가 실제 반음
 * 위치가 아닌 값을 그대로 더해 버린다. 지금은 음수 MIDI 값이 나올
 * 경로가 없어 드러나지 않지만, 두 함수가 서로 다른 규칙을 쓰는 채로
 * 남겨두면 나중에 이 비대칭에 걸려 넘어지기 쉽다. */
export function midiOf(octave: number, semitone: number): number {
  return (octave + 1) * 12 + (((semitone % 12) + 12) % 12);
}
