import type { Chord, Clip, Song, Track } from "./model";
import { ticksPerBar } from "./time";

export const DEMO_BARS = 8;

const BAR = ticksPerBar([4, 4]);

/** C - Am - F - G7, 각 2마디. */
const PROGRESSION: Chord[] = [
  { root: 0, quality: "maj" },
  { root: 9, quality: "min" },
  { root: 5, quality: "maj" },
  { root: 7, quality: "dom7" },
];

function chordClips(prefix: string, pattern: string): Clip[] {
  return PROGRESSION.map((chord, i) => ({
    id: `${prefix}-${i}`,
    start: i * 2 * BAR,
    length: 2 * BAR,
    body: { type: "chord", chord, pattern },
  }));
}

/**
 * 소리 검증 화면이 쓰는 데모 곡. 코드·패턴 클립과 음 클립, 악기 4종을 모두 쓴다.
 * 매 호출마다 새 객체를 돌려준다.
 */
export function buildDemoSong(): Song {
  const tracks: Track[] = [
    {
      id: "track-piano",
      instrument: "piano",
      clips: chordClips("piano", "piano-arpeggio-8th"),
    },
    {
      id: "track-guitar",
      instrument: "guitar",
      clips: chordClips("guitar", "guitar-strum-quarter"),
    },
    {
      id: "track-bass",
      instrument: "bass",
      clips: chordClips("bass", "bass-root-quarter"),
    },
    {
      id: "track-drums",
      instrument: "drums",
      clips: [
        {
          id: "drums-0",
          start: 0,
          length: DEMO_BARS * BAR,
          body: {
            type: "chord",
            // 드럼 패턴은 코드를 읽지 않는다. 스키마가 코드를 요구하므로 자리만 채운다.
            chord: { root: 0, quality: "maj" },
            pattern: "drum-basic-rock",
          },
        },
      ],
    },
    {
      id: "track-melody",
      instrument: "piano",
      clips: [
        {
          id: "melody-0",
          start: 4 * BAR,
          length: 2 * BAR,
          body: {
            type: "notes",
            notes: [
              { start: 0, length: 480, pitch: 72, velocity: 0.7 },
              { start: 480, length: 480, pitch: 76, velocity: 0.7 },
              { start: 960, length: 480, pitch: 79, velocity: 0.7 },
              { start: 1440, length: 480, pitch: 76, velocity: 0.7 },
              { start: 1920, length: 960, pitch: 77, velocity: 0.7 },
              { start: 2880, length: 960, pitch: 74, velocity: 0.7 },
            ],
          },
        },
      ],
    },
  ];

  return {
    v: 2,
    tempo: 120,
    timeSignature: [4, 4],
    bars: DEMO_BARS,
    tracks,
    meta: { title: "데모 곡", editors: [] },
  };
}
