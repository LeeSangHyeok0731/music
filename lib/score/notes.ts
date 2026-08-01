const NAMES = [
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
];

/** MIDI 60 → "C4". 타일에 표시할 이름을 만든다. */
export function midiToName(note: number): string {
  const octave = Math.floor(note / 12) - 1;
  return `${NAMES[((note % 12) + 12) % 12]}${octave}`;
}

/** 팝오버 드롭다운이 고를 수 있는 음. C1부터 C7까지. */
export const NOTE_CHOICES: number[] = Array.from(
  { length: 96 - 24 + 1 },
  (_, i) => 24 + i,
);
