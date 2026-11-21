import type { ChordSegment, Clip, Song, Track } from "./model";
import { ticksPerBar } from "./time";

export const DEMO_BARS = 8;

const BAR = ticksPerBar([4, 4]);

/** C - Am - F - G7, 각 2마디. 곡의 코드는 여기서만 정한다. */
function demoProgression(): ChordSegment[] {
  return [
    { root: 0, quality: "maj" as const },
    { root: 9, quality: "min" as const },
    { root: 5, quality: "maj" as const },
    { root: 7, quality: "dom7" as const },
  ].map((chord, i) => ({ start: i * 2 * BAR, length: 2 * BAR, chord }));
}

/** 2마디짜리 패턴 클립 4개. 코드는 클립이 아니라 곡의 진행이 정한다. */
function patternClips(prefix: string, pattern: string): Clip[] {
  return [0, 1, 2, 3].map((i) => ({
    id: `${prefix}-${i}`,
    start: i * 2 * BAR,
    length: 2 * BAR,
    body: { type: "pattern", pattern },
  }));
}

/**
 * 데모 곡. 코드 진행 위에 악기 4종의 패턴 클립을 깐다. 매 호출마다 새 객체를
 * 돌려준다.
 */
export function buildDemoSong(): Song {
  const tracks: Track[] = [
    {
      id: "track-piano",
      instrument: "piano",
      clips: patternClips("piano", "piano-arpeggio-8th"),
    },
    {
      id: "track-guitar",
      instrument: "guitar",
      clips: patternClips("guitar", "guitar-strum-quarter"),
    },
    {
      id: "track-bass",
      instrument: "bass",
      clips: patternClips("bass", "bass-root-quarter"),
    },
    {
      id: "track-drums",
      instrument: "drums",
      clips: [
        {
          id: "drums-0",
          start: 0,
          length: DEMO_BARS * BAR,
          body: { type: "pattern", pattern: "drum-basic-rock" },
        },
      ],
    },
  ];

  return {
    v: 3,
    tempo: 120,
    timeSignature: [4, 4],
    bars: DEMO_BARS,
    progression: demoProgression(),
    tracks,
    meta: { title: "데모 곡", editors: [] },
  };
}
