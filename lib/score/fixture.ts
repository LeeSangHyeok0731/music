import { ticksPerBar } from "./time";
import {
  DRUM_HIHAT,
  DRUM_KICK,
  DRUM_SNARE,
  PPQ,
  type Line,
  type Song,
  type Tile,
} from "./types";

export const DEMO_BARS = 16;

/** 드럼 격자 한 칸의 폭. 16분음표. 실제 울림 길이가 아니라 칸 폭을 뜻한다. */
export const DRUM_TILE_LENGTH = 120;

const TIME_SIGNATURE: [number, number] = [4, 4];
const BAR = ticksPerBar(TIME_SIGNATURE); // 1920
const BEAT = PPQ; // 480

/** C – Am – F – G 를 네 번 반복한다. */
const PROGRESSION = [
  { chord: [60, 64, 67], root: 48 }, // C
  { chord: [57, 60, 64], root: 45 }, // Am
  { chord: [53, 57, 60], root: 41 }, // F
  { chord: [55, 59, 62], root: 43 }, // G
] as const;

function buildPiano(): Line {
  const tiles: Tile[] = [];
  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const step = PROGRESSION[bar % PROGRESSION.length];
    tiles.push({
      id: `piano-${bar}`,
      start: bar * BAR,
      length: BAR,
      velocity: 0.7,
      notes: [...step.chord],
    });
  }
  return {
    id: "line-piano",
    name: "피아노",
    kind: "pitched",
    instrument: "piano",
    tiles,
  };
}

function buildGuitar(): Line {
  const tiles: Tile[] = [];
  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const step = PROGRESSION[bar % PROGRESSION.length];
    // 1박과 3박에 한 번씩 스트로크
    for (const beat of [0, 2]) {
      tiles.push({
        id: `guitar-${bar}-${beat}`,
        start: bar * BAR + beat * BEAT,
        length: BEAT * 2,
        velocity: 0.5,
        notes: step.chord.map((n) => n + 12),
      });
    }
  }
  return {
    id: "line-guitar",
    name: "기타",
    kind: "pitched",
    instrument: "guitar",
    tiles,
  };
}

function buildBass(): Line {
  const tiles: Tile[] = [];
  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const step = PROGRESSION[bar % PROGRESSION.length];
    for (const beat of [0, 2]) {
      tiles.push({
        id: `bass-${bar}-${beat}`,
        start: bar * BAR + beat * BEAT,
        length: BEAT * 2,
        velocity: 0.8,
        notes: [step.root - 12],
      });
    }
  }
  return {
    id: "line-bass",
    name: "베이스",
    kind: "pitched",
    instrument: "bass",
    tiles,
  };
}

function buildDrums(): Line {
  const tiles: Tile[] = [];
  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const base = bar * BAR;

    for (const beat of [0, 2]) {
      tiles.push({
        id: `kick-${bar}-${beat}`,
        start: base + beat * BEAT,
        length: DRUM_TILE_LENGTH,
        velocity: 0.9,
        notes: [DRUM_KICK],
      });
    }

    for (const beat of [1, 3]) {
      tiles.push({
        id: `snare-${bar}-${beat}`,
        start: base + beat * BEAT,
        length: DRUM_TILE_LENGTH,
        velocity: 0.7,
        notes: [DRUM_SNARE],
      });
    }

    // 8분음표 하이햇
    for (let eighth = 0; eighth < 8; eighth++) {
      tiles.push({
        id: `hihat-${bar}-${eighth}`,
        start: base + eighth * (BEAT / 2),
        length: DRUM_TILE_LENGTH,
        velocity: eighth % 2 === 0 ? 0.5 : 0.3,
        notes: [DRUM_HIHAT],
      });
    }
  }

  // start 오름차순 불변식을 여기서 보장한다
  tiles.sort((a, b) => a.start - b.start);

  return {
    id: "line-drums",
    name: "드럼",
    kind: "drum",
    instrument: "drums",
    tiles,
  };
}

export function buildDemoSong(): Song {
  return {
    tempo: 120,
    timeSignature: TIME_SIGNATURE,
    lengthTicks: BAR * DEMO_BARS,
    lines: [buildPiano(), buildGuitar(), buildBass(), buildDrums()],
  };
}
