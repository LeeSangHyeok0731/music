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
