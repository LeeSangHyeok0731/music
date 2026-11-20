import {
  DRUM_HIHAT,
  DRUM_KICK,
  DRUM_SNARE,
  PPQ,
  type InstrumentId,
} from "./model";

/**
 * 패턴 카탈로그. 곡 파일에는 id만 들어가므로 공유 URL이 작다.
 *
 * **패턴 id는 불변이다.** 이미 공유된 링크가 같은 소리로 재생되려면 한 번
 * 낸 id의 내용을 바꿀 수 없다. 고치고 싶으면 새 id를 만들고, 옛 것은
 * 그대로 둔다. `patterns.test.ts`의 패턴별 스냅샷(내용 변경)과 고정 id
 * 목록(삭제)이 이를 지키고, 아래의 깊은 freeze가 런타임 변형을 막는다.
 *
 * 시간은 틱이고 4/4 한 마디(1920)를 기준으로 만들었다. 다른 박자에서는
 * 패턴이 자기 길이로 반복되어 마디선과 어긋날 수 있다 — 편집 UI가 4/4만
 * 제공하는 동안은 문제가 되지 않는다.
 */
export const BAR_4_4 = PPQ * 4;

export type HarmonicStep = {
  /** 패턴 시작 기준 틱. */
  readonly at: number;
  readonly length: number;
  /** 코드 구성음 순번. 0=근음, 1=3음, 2=5음, 3=7음(3화음이면 한 옥타브 위 근음). */
  readonly degree: number;
  readonly octave: number;
  readonly velocity: number;
};

export type DrumStep = {
  readonly at: number;
  readonly length: number;
  /** GM 드럼 번호. */
  readonly pitch: number;
  readonly velocity: number;
};

export type Pattern =
  | {
      readonly id: string;
      readonly kind: "harmonic";
      readonly length: number;
      readonly steps: readonly HarmonicStep[];
    }
  | {
      readonly id: string;
      readonly kind: "drum";
      readonly length: number;
      readonly steps: readonly DrumStep[];
    };

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export const PATTERNS: readonly Pattern[] = [
  {
    id: "piano-block",
    kind: "harmonic",
    length: BAR_4_4,
    steps: [0, 1, 2].map((degree) => ({
      at: 0,
      length: BAR_4_4,
      degree,
      octave: 4,
      velocity: 0.7,
    })),
  },
  {
    id: "piano-arpeggio-8th",
    kind: "harmonic",
    length: BAR_4_4,
    steps: [0, 1, 2, 1, 0, 1, 2, 1].map((degree, i) => ({
      at: i * (PPQ / 2),
      length: PPQ / 2,
      degree,
      octave: 4,
      velocity: 0.6,
    })),
  },
  {
    id: "guitar-strum-quarter",
    kind: "harmonic",
    length: BAR_4_4,
    // 네 박마다 낮은 현부터 15틱씩 어긋나게 친다
    steps: range(4).flatMap((beat) =>
      [0, 1, 2].map((degree) => ({
        at: beat * PPQ + degree * 15,
        length: 450,
        degree,
        octave: 3,
        velocity: 0.6,
      })),
    ),
  },
  {
    id: "bass-root-quarter",
    kind: "harmonic",
    length: BAR_4_4,
    steps: range(4).map((beat) => ({
      at: beat * PPQ,
      length: 420,
      degree: 0,
      octave: 2,
      velocity: 0.8,
    })),
  },
  {
    id: "bass-root-fifth",
    kind: "harmonic",
    length: BAR_4_4,
    steps: [
      { at: 0, length: 900, degree: 0, octave: 2, velocity: 0.8 },
      { at: 960, length: 900, degree: 2, octave: 2, velocity: 0.8 },
    ],
  },
  {
    id: "drum-basic-rock",
    kind: "drum",
    length: BAR_4_4,
    steps: [
      { at: 0, length: 240, pitch: DRUM_KICK, velocity: 0.9 },
      { at: 960, length: 240, pitch: DRUM_KICK, velocity: 0.9 },
      { at: 480, length: 240, pitch: DRUM_SNARE, velocity: 0.8 },
      { at: 1440, length: 240, pitch: DRUM_SNARE, velocity: 0.8 },
      ...range(8).map((i) => ({
        at: i * 240,
        length: 120,
        pitch: DRUM_HIHAT,
        velocity: 0.5,
      })),
    ],
  },
  {
    id: "drum-four-on-floor",
    kind: "drum",
    length: BAR_4_4,
    steps: [
      ...range(4).map((beat) => ({
        at: beat * PPQ,
        length: 240,
        pitch: DRUM_KICK,
        velocity: 0.9,
      })),
      { at: 480, length: 240, pitch: DRUM_SNARE, velocity: 0.7 },
      { at: 1440, length: 240, pitch: DRUM_SNARE, velocity: 0.7 },
      ...range(4).map((beat) => ({
        at: beat * PPQ + 240,
        length: 120,
        pitch: DRUM_HIHAT,
        velocity: 0.5,
      })),
    ],
  },
];

// 카탈로그는 모든 곡이 공유한다. 호출자가 실수로 바꾸면 그 순간부터 같은 id가
// 다른 소리를 내므로, 모듈 로드 시 스텝까지 깊게 얼린다(readonly 타입의 런타임 짝).
for (const p of PATTERNS) {
  for (const s of p.steps) Object.freeze(s);
  Object.freeze(p.steps);
  Object.freeze(p);
}
Object.freeze(PATTERNS);

const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));

export function getPattern(id: string): Pattern | undefined {
  return BY_ID.get(id);
}

/**
 * 악기에 쓸 수 있는 패턴. 드럼은 드럼 패턴만, 나머지는 화음 패턴만이다.
 * 매번 새 배열을 돌려준다 — 호출자가 배열을 바꿔도 카탈로그에는 영향이 없다.
 */
export function patternsFor(instrument: InstrumentId): Pattern[] {
  const kind = instrument === "drums" ? "drum" : "harmonic";
  return PATTERNS.filter((p) => p.kind === kind);
}
