import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLIP_TICKS,
  MAX_BARS_UI,
  MIN_BARS,
  SNAP_TICKS,
  addClip,
  mergeSegments,
  moveBoundary,
  moveClip,
  removeClip,
  resizeClip,
  setBars,
  setChord,
  setClipPattern,
  setTempo,
  setTrackPattern,
  snapTick,
  splitSegment,
} from "@/lib/score/edit";
import {
  MAX_TEMPO,
  MIN_TEMPO,
  type Chord,
  type ChordSegment,
  type Clip,
  type Note,
  type Song,
} from "@/lib/score/model";
import { PATTERNS, patternsFor } from "@/lib/score/patterns";
import {
  songWithNotes,
  songWithPatterns,
} from "@/lib/score/testing/builders";
import { mulberry32 } from "@/lib/score/testing/random";
import { validateSong } from "@/lib/score/validate";

/**
 * 시드 20개 × 수백 번 연산을 도는 속성 테스트의 제한 시간. 단독으로는 약 1~2초지만 전체 스위트가
 * 병렬로 도는 동안엔 5초 기본값을 넘길 수 있다(연산량은 정해져 있고 CPU 경합만 달라진다).
 */
const PROPERTY_TIMEOUT_MS = 30_000;

const C: Chord = { root: 0, quality: "maj" };
const AM: Chord = { root: 9, quality: "min" };
const F: Chord = { root: 5, quality: "maj" };

const P: ChordSegment[] = [
  { start: 0, length: 1920, chord: C },
  { start: 1920, length: 1920, chord: AM },
  { start: 3840, length: 3840, chord: F },
];

/** 4마디 = 7680틱, 기본 진행은 P. */
function base(progression: ChordSegment[] = P): Song {
  return songWithPatterns({ bars: 4, tracks: [], progression });
}

function seg(start: number, length: number, chord: Chord): ChordSegment {
  return { start, length, chord };
}

/** 모든 연산 뒤의 공통 검사: 결과가 유효하고 입력은 변형되지 않았다. */
function expectValidAndInputUntouched(
  input: Song,
  snapshot: Song,
  result: Song,
) {
  expect(validateSong(result)).toEqual([]);
  expect(input).toEqual(snapshot);
}

describe("상수와 snapTick", () => {
  it("격자·기본 길이·마디 한도 상수", () => {
    expect(SNAP_TICKS).toBe(960);
    expect(DEFAULT_CLIP_TICKS).toBe(1920);
    expect(MIN_BARS).toBe(1);
    expect(MAX_BARS_UI).toBe(64);
  });

  it("snapTick은 가장 가까운 격자로 반올림한다", () => {
    expect(snapTick(0)).toBe(0);
    expect(snapTick(1000)).toBe(960);
    expect(snapTick(1500)).toBe(1920);
    expect(snapTick(1919)).toBe(1920);
    expect(snapTick(479)).toBe(0);
  });

  it("snapTick은 정확히 .5인 지점에서 위로 올린다(Math.round(0.5) === 1)", () => {
    // 480 / 960 = 0.5 이고 Math.round는 .5를 +무한대 쪽으로 보내 960이 된다.
    // Math.floor로 바꾸면 이 케이스가 깨진다.
    expect(snapTick(480)).toBe(960);
    expect(snapTick(1440)).toBe(1920);
    expect(snapTick(2400)).toBe(2880);
  });
});

describe("setChord", () => {
  it("구간 1의 chord만 F로 바뀌고 start/length와 나머지는 그대로다", () => {
    const input = base();
    const snapshot = structuredClone(input);
    const result = setChord(input, 1, F);
    expect(result).not.toBe(input);
    expect(result.progression).toEqual([
      seg(0, 1920, C),
      seg(1920, 1920, F),
      seg(3840, 3840, F),
    ]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("Am과 같은 코드(다른 객체)면 같은 참조를 돌려준다", () => {
    const input = base();
    const snapshot = structuredClone(input);
    const same: Chord = { root: 9, quality: "min" };
    expect(setChord(input, 1, same)).toBe(input);
    expect(input).toEqual(snapshot);
  });

  it("근음만, 종류만 달라도 바뀐다", () => {
    const input = base();
    expect(
      setChord(input, 1, { root: 10, quality: "min" }).progression[1].chord,
    ).toEqual({ root: 10, quality: "min" });
    expect(
      setChord(input, 1, { root: 9, quality: "min7" }).progression[1].chord,
    ).toEqual({ root: 9, quality: "min7" });
  });

  it("넘겨 준 chord 객체를 곡 안에 그대로 끼우지 않는다(별칭 방지)", () => {
    const input = base();
    const chord: Chord = { root: 7, quality: "dom7" };
    const result = setChord(input, 0, chord);
    chord.root = 1;
    expect(result.progression[0].chord).toEqual({ root: 7, quality: "dom7" });
  });

  it("index -1, 3(범위 밖), 1.5·NaN(정수 아님)은 RangeError", () => {
    const input = base();
    expect(() => setChord(input, -1, F)).toThrow(RangeError);
    expect(() => setChord(input, 3, F)).toThrow(RangeError);
    expect(() => setChord(input, 1.5, F)).toThrow(RangeError);
    expect(() => setChord(input, Number.NaN, F)).toThrow(RangeError);
  });

  it("유효하지 않은 코드(root 12·1.5·NaN·-1, 알 수 없는 quality)는 RangeError이고 입력은 그대로다", () => {
    const input = base();
    const snapshot = structuredClone(input);
    const invalid: unknown[] = [
      { root: 12, quality: "maj" },
      { root: 1.5, quality: "maj" },
      { root: Number.NaN, quality: "maj" },
      { root: -1, quality: "maj" },
      { root: 0, quality: "x" },
    ];
    for (const chord of invalid) {
      expect(() => setChord(input, 1, chord as Chord)).toThrow(RangeError);
      expect(input).toEqual(snapshot);
    }
  });
});

describe("splitSegment", () => {
  it("tick 960 -> [C 0~960, C 960~1920, Am, F] (구간 3개 -> 4개)", () => {
    const input = base();
    const snapshot = structuredClone(input);
    const result = splitSegment(input, 960);
    expect(result.progression).toEqual([
      seg(0, 960, C),
      seg(960, 960, C),
      seg(1920, 1920, AM),
      seg(3840, 3840, F),
    ]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("tick 1000은 스냅 960과 같은 결과다", () => {
    expect(splitSegment(base(), 1000)).toEqual(splitSegment(base(), 960));
  });

  it("tick 1500은 스냅 1920 = 구간 경계라 no-op", () => {
    const input = base();
    expect(splitSegment(input, 1500)).toBe(input);
  });

  it("tick 100은 스냅 0 = 곡 시작이라 no-op", () => {
    const input = base();
    expect(splitSegment(input, 100)).toBe(input);
  });

  it("tick 480은 960으로 스냅돼(Math.round(0.5) = 1) 분할되고, 1440은 1920으로 스냅돼 경계라 no-op", () => {
    const input = base();
    expect(splitSegment(input, 480)).toEqual(splitSegment(input, 960));
    expect(splitSegment(input, 480).progression).toHaveLength(4);
    expect(splitSegment(input, 1440)).toBe(input);
  });

  it("길이 960 구간 안(start+480)은 960으로 스냅돼 경계 -> no-op", () => {
    const input = base([seg(0, 960, C), seg(960, 6720, AM)]);
    expect(splitSegment(input, 480)).toBe(input);
  });

  it("스냅한 지점이 안쪽이어도 한쪽이 반마디 미만이면 no-op", () => {
    // C 0~1000: 960에서 가르면 오른쪽이 40 < 960.
    const input = base([seg(0, 1000, C), seg(1000, 6680, AM)]);
    expect(splitSegment(input, 960)).toBe(input);
  });

  it("왼쪽 반이 반마디 미만이면(구간이 격자에 안 맞을 때) no-op", () => {
    // 불러온 곡의 어긋난 구간: Am 500~3500. 960은 구간 안쪽이고 오른쪽은 2540으로 충분하지만
    // 왼쪽이 960 - 500 = 460 < 960이라 쪼개지 않는다.
    const input = base([
      seg(0, 500, C),
      seg(500, 3000, AM),
      seg(3500, 4180, F),
    ]);
    const snapshot = structuredClone(input);
    expect(validateSong(input)).toEqual([]);
    expect(splitSegment(input, 960)).toBe(input);
    expect(input).toEqual(snapshot);
  });

  it("뒤 구간 한가운데(5760)에서 가른다", () => {
    const result = splitSegment(base(), 5760);
    expect(result.progression).toEqual([
      seg(0, 1920, C),
      seg(1920, 1920, AM),
      seg(3840, 1920, F),
      seg(5760, 1920, F),
    ]);
    expect(validateSong(result)).toEqual([]);
  });

  it("곡 끝 근처: 7000 -> 6720 분할, 7200 -> 7680 = 곡 끝이라 no-op", () => {
    const input = base();
    expect(splitSegment(input, 7000).progression.at(-1)).toEqual(
      seg(6720, 960, F),
    );
    expect(splitSegment(input, 7200)).toBe(input);
    expect(splitSegment(input, 99999)).toBe(input);
  });

  it("음수·NaN·무한대 tick은 no-op", () => {
    const input = base();
    expect(splitSegment(input, -100)).toBe(input);
    expect(splitSegment(input, -2000)).toBe(input);
    expect(splitSegment(input, Number.NaN)).toBe(input);
    expect(splitSegment(input, Number.POSITIVE_INFINITY)).toBe(input);
  });

  it("쪼갠 두 구간의 chord는 서로 다른 객체다(별칭 방지)", () => {
    const result = splitSegment(base(), 960);
    expect(result.progression[0].chord).toEqual(result.progression[1].chord);
    expect(result.progression[0].chord).not.toBe(result.progression[1].chord);
  });
});

describe("moveBoundary", () => {
  it("(P, 0, 2880) -> 경계 1920 -> 2880: C 0~2880, Am 2880~3840", () => {
    const input = base();
    const snapshot = structuredClone(input);
    const result = moveBoundary(input, 0, 2880);
    expect(result.progression).toEqual([
      seg(0, 2880, C),
      seg(2880, 960, AM),
      seg(3840, 3840, F),
    ]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("(P, 0, 0) -> lo = 960로 클램프: C 0~960, Am 960~3840", () => {
    const input = base();
    const snapshot = structuredClone(input);
    const result = moveBoundary(input, 0, 0);
    expect(result.progression).toEqual([
      seg(0, 960, C),
      seg(960, 2880, AM),
      seg(3840, 3840, F),
    ]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("(P, 0, 99999) -> hi = 3840 - 960 = 2880으로 클램프(위와 같은 결과)", () => {
    expect(moveBoundary(base(), 0, 99999)).toEqual(
      moveBoundary(base(), 0, 2880),
    );
  });

  it("(P, 0, 1920) -> 변화 없음, 같은 참조", () => {
    const input = base();
    expect(moveBoundary(input, 0, 1920)).toBe(input);
  });

  it("스냅 결과가 지금 경계와 같으면 no-op: (P, 1, 4000) -> 3840", () => {
    const input = base();
    expect(moveBoundary(input, 1, 4000)).toBe(input);
  });

  it("마지막이 아닌 경계 index 1: (P, 1, 5760)", () => {
    const result = moveBoundary(base(), 1, 5760);
    expect(result.progression).toEqual([
      seg(0, 1920, C),
      seg(1920, 3840, AM),
      seg(5760, 1920, F),
    ]);
    expect(validateSong(result)).toEqual([]);
  });

  it("경계를 왼쪽으로도 옮긴다: (P, 1, 2880)", () => {
    const result = moveBoundary(base(), 1, 2880);
    expect(result.progression).toEqual([
      seg(0, 1920, C),
      seg(1920, 960, AM),
      seg(2880, 4800, F),
    ]);
  });

  it("(P, 2, ...)는 RangeError: 마지막 구간 뒤에는 경계가 없다", () => {
    const input = base();
    expect(() => moveBoundary(input, 2, 1000)).toThrow(RangeError);
    expect(() => moveBoundary(input, -1, 1000)).toThrow(RangeError);
    expect(() => moveBoundary(input, 3, 1000)).toThrow(RangeError);
    expect(() => moveBoundary(input, 0.5, 1000)).toThrow(RangeError);
  });

  it("구간이 하나뿐이면 어떤 index든 RangeError(경계가 없다)", () => {
    const input = base([seg(0, 7680, C)]);
    expect(() => moveBoundary(input, 0, 960)).toThrow(RangeError);
  });

  it("두 구간이 모두 960 길이면 어느 쪽으로 옮겨도 no-op", () => {
    const input = base([
      seg(0, 960, C),
      seg(960, 960, AM),
      seg(1920, 5760, F),
    ]);
    expect(moveBoundary(input, 0, 0)).toBe(input);
    expect(moveBoundary(input, 0, 960)).toBe(input);
    expect(moveBoundary(input, 0, 1920)).toBe(input);
    expect(moveBoundary(input, 0, 99999)).toBe(input);
  });

  it("lo > hi(두 구간 합이 한 칸 폭 두 개보다 짧음)이면 no-op", () => {
    // a 0~500, b 500~900: lo = 960, hi = 900 - 960 = -60.
    const input = base([seg(0, 500, C), seg(500, 400, AM), seg(900, 6780, F)]);
    expect(moveBoundary(input, 0, 700)).toBe(input);
  });

  it("NaN tick은 no-op(곡을 망가뜨리지 않는다)", () => {
    const input = base();
    expect(moveBoundary(input, 0, Number.NaN)).toBe(input);
  });

  it("-무한대는 lo로, +무한대는 hi로 클램프", () => {
    expect(moveBoundary(base(), 0, Number.NEGATIVE_INFINITY)).toEqual(
      moveBoundary(base(), 0, 0),
    );
    expect(moveBoundary(base(), 0, Number.POSITIVE_INFINITY)).toEqual(
      moveBoundary(base(), 0, 99999),
    );
  });

  it("코드는 건드리지 않는다", () => {
    const result = moveBoundary(base(), 0, 2880);
    expect(result.progression.map((s) => s.chord)).toEqual([C, AM, F]);
  });
});

describe("mergeSegments", () => {
  it("(P, 0) -> [C 0~3840, F 3840~7680] (왼쪽 코드 C)", () => {
    const input = base();
    const snapshot = structuredClone(input);
    const result = mergeSegments(input, 0);
    expect(result.progression).toEqual([seg(0, 3840, C), seg(3840, 3840, F)]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("(P, 1) -> [C, Am 1920~7680] (왼쪽 코드 Am)", () => {
    const input = base();
    const snapshot = structuredClone(input);
    const result = mergeSegments(input, 1);
    expect(result.progression).toEqual([seg(0, 1920, C), seg(1920, 5760, AM)]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("구간이 하나뿐이면 같은 참조(index와 무관하게 no-op)", () => {
    const input = base([seg(0, 7680, C)]);
    expect(mergeSegments(input, 0)).toBe(input);
    expect(mergeSegments(input, -1)).toBe(input);
    expect(mergeSegments(input, 5)).toBe(input);
  });

  it("index -1, 구간 수 - 1(마지막), 그 이상, 정수 아님은 RangeError", () => {
    const input = base();
    expect(() => mergeSegments(input, -1)).toThrow(RangeError);
    expect(() => mergeSegments(input, 2)).toThrow(RangeError);
    expect(() => mergeSegments(input, 3)).toThrow(RangeError);
    expect(() => mergeSegments(input, 0.5)).toThrow(RangeError);
  });

  it("합친 구간의 chord를 고쳐도 입력은 그대로다(별칭 방지)", () => {
    const input = base();
    const result = mergeSegments(input, 0);
    result.progression[0].chord.root = 3;
    expect(input.progression[0].chord.root).toBe(0);
  });
});

describe("mulberry32", () => {
  it("같은 시드는 같은 열을, 다른 시드는 다른 열을 만들고 [0, 1)에 든다", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    const seqC = Array.from({ length: 50 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const x of seqA) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("속성: 무작위 편집 열", () => {
  const CHORDS: Chord[] = [
    C,
    AM,
    F,
    { root: 7, quality: "dom7" },
    { root: 2, quality: "maj7" },
    { root: 11, quality: "min7" },
  ];
  const INVALID_CHORDS = [
    { root: 12, quality: "maj" },
    { root: -1, quality: "min" },
    { root: 1.5, quality: "maj7" },
    { root: Number.NaN, quality: "dom7" },
    { root: 0, quality: "x" },
  ] as unknown as Chord[];

  /**
   * 진행 연산 네 가지를 무작위로 섞는다. `aligned`이면 모든 구간 길이가 격자의
   * 배수라는 것까지, 아니면(불러온 어긋난 곡) 유효성·양의 정수 길이·합계만 본다.
   */
  function runProgressionOps(makeSong: () => Song, aligned: boolean) {
    let changed = 0;
    let unchanged = 0;
    let rangeErrors = 0;
    let invalidChordErrors = 0;

    for (let seed = 1; seed <= 20; seed++) {
      const rand = mulberry32(seed);
      const int = (lo: number, hi: number) =>
        lo + Math.floor(rand() * (hi - lo + 1));
      let song = makeSong();
      const total = song.bars * 1920;

      for (let step = 0; step < 200; step++) {
        const prev = song;
        const prevClone = structuredClone(prev);
        const n = prev.progression.length;
        // 범위 밖 인덱스도 섞는다.
        const index = int(-2, n + 1);
        // 가끔 곡 밖의 아주 큰·작은 틱도 섞는다.
        const tick =
          rand() < 0.1 ? int(-50000, 100000) : int(-500, total + 1500);
        const op = int(0, 3);

        let next: Song;
        try {
          if (op === 0) {
            // 가끔 잘못된 코드도 섞는다: 어떤 경우에도 잘못된 곡이 나오면 안 된다.
            const invalid = rand() < 0.15;
            const chord = invalid
              ? INVALID_CHORDS[int(0, INVALID_CHORDS.length - 1)]
              : CHORDS[int(0, CHORDS.length - 1)];
            if (invalid) {
              // 인덱스는 유효하게: 던지는 이유가 코드 검증임을 분명히 한다.
              expect(() => setChord(prev, int(0, n - 1), chord)).toThrow(
                RangeError,
              );
              invalidChordErrors++;
              expect(prev).toEqual(prevClone);
              continue;
            }
            next = setChord(prev, index, chord);
          } else if (op === 1) {
            next = splitSegment(prev, tick);
          } else if (op === 2) {
            next = moveBoundary(prev, index, tick);
          } else {
            next = mergeSegments(prev, index);
          }
        } catch (e) {
          if (!(e instanceof RangeError)) throw e;
          rangeErrors++;
          expect(prev).toEqual(prevClone);
          continue;
        }

        song = next;
        expect(validateSong(song)).toEqual([]);
        expect(prev).toEqual(prevClone); // 입력 불변
        let sum = 0;
        for (const s of song.progression) {
          if (aligned) expect(s.length % SNAP_TICKS).toBe(0);
          expect(Number.isInteger(s.length)).toBe(true);
          expect(s.length).toBeGreaterThan(0);
          if (aligned) expect(s.length).toBeGreaterThanOrEqual(SNAP_TICKS);
          sum += s.length;
        }
        expect(sum).toBe(total);

        // 새 참조인데 내용이 같으면 실행취소에 빈 칸이 쌓인다.
        if (next === prev) {
          unchanged++;
        } else {
          changed++;
          expect(next).not.toEqual(prevClone);
        }
      }
    }

    // 속성 테스트가 허공을 치지 않았는지: 바뀜·no-op·RangeError가 모두 실제로 일어났다.
    expect(changed).toBeGreaterThan(300);
    expect(unchanged).toBeGreaterThan(100);
    expect(rangeErrors).toBeGreaterThan(100);
    expect(invalidChordErrors).toBeGreaterThan(20);
  }

  it("시드 20개 x 연산 200번 뒤에도 매번 유효하고 반마디 격자를 지킨다(잘못된 코드 포함)", () => {
    runProgressionOps(() => base(), true);
  }, PROPERTY_TIMEOUT_MS);

  it("어긋난 불러온 곡(구간이 격자에 안 맞음)에서도 유효하고 길이 합이 곡 길이다", () => {
    runProgressionOps(
      () =>
        base([seg(0, 1000, C), seg(1000, 1500, AM), seg(2500, 5180, F)]),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 클립·곡 전체 편집
// ---------------------------------------------------------------------------

const PIANO_CLIPS = [
  { id: "clip-1", start: 0, length: 1920, pattern: "piano-block" },
  { id: "clip-2", start: 3840, length: 1920, pattern: "piano-arpeggio-8th" },
];

/** 4마디(L = 7680): 피아노 `t-piano`(clip-1 0~1920, clip-2 3840~5760)와 빈 드럼 `t-drums`. */
function arrangement(
  progression?: ChordSegment[],
  pianoClips = PIANO_CLIPS,
): Song {
  return songWithPatterns({
    bars: 4,
    progression,
    tracks: [
      { id: "t-piano", instrument: "piano", clips: pianoClips },
      { id: "t-drums", instrument: "drums", clips: [] },
    ],
  });
}

function clipsOf(song: Song, trackId: string): Clip[] {
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`테스트 오류: 트랙 없음 ${trackId}`);
  return track.clips;
}

/** `[id, start, length]` 목록. 배열 순서까지 비교하려고 쓴다. */
function shape(song: Song, trackId: string): Array<[string, number, number]> {
  return clipsOf(song, trackId).map((c) => [c.id, c.start, c.length]);
}

function patternOf(clip: Clip): string {
  if (clip.body.type !== "pattern") throw new Error("테스트 오류: notes 클립");
  return clip.body.pattern;
}

function note(start: number, length: number, pitch = 60): Note {
  return { start, length, pitch, velocity: 0.8 };
}

/** `songWithNotes`의 클립(track-1 / clip-1, 0~곡 끝)을 `notes` 본문으로 쓴다. */
function notesSong(notes: Note[], bars = 1): Song {
  return songWithNotes({ notes, bars });
}

describe("addClip", () => {
  it("(t-piano, 1920) -> clip-3: 1920~3840, piano-block, 순서 clip-1, clip-3, clip-2", () => {
    const input = arrangement();
    const snapshot = structuredClone(input);
    const result = addClip(input, "t-piano", 1920);
    expect(shape(result, "t-piano")).toEqual([
      ["clip-1", 0, 1920],
      ["clip-3", 1920, 1920],
      ["clip-2", 3840, 1920],
    ]);
    expect(patternOf(clipsOf(result, "t-piano")[1])).toBe("piano-block");
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("기존 클립은 같은 객체를 공유하고 다른 트랙은 건드리지 않는다", () => {
    const input = arrangement();
    const result = addClip(input, "t-piano", 1920);
    expect(clipsOf(result, "t-piano")[0]).toBe(clipsOf(input, "t-piano")[0]);
    expect(result.tracks[1]).toBe(input.tracks[1]);
  });

  it("(t-piano, 2000)은 바닥 격자 1920이라 위와 같은 결과다", () => {
    expect(addClip(arrangement(), "t-piano", 2000)).toEqual(
      addClip(arrangement(), "t-piano", 1920),
    );
  });

  it("클릭한 칸의 시작으로 내림한다: 2500 -> 1920(길이 1920), 1500 -> 960은 clip-1 안이라 no-op", () => {
    // Math.round였다면 2500은 2880(길이 960), 1500은 1920(추가)이 된다.
    const input = arrangement();
    expect(shape(addClip(input, "t-piano", 2500), "t-piano")).toEqual([
      ["clip-1", 0, 1920],
      ["clip-3", 1920, 1920],
      ["clip-2", 3840, 1920],
    ]);
    expect(addClip(input, "t-piano", 1500)).toBe(input);
  });

  it("(t-piano, 960)은 clip-1 안이라 같은 참조", () => {
    const input = arrangement();
    expect(addClip(input, "t-piano", 960)).toBe(input);
    expect(addClip(input, "t-piano", 0)).toBe(input);
  });

  it("(t-piano, 5760) -> 마지막 클립 바로 뒤: 길이 1920, clip-3 start 5760", () => {
    const result = addClip(arrangement(), "t-piano", 5760);
    expect(shape(result, "t-piano")).toEqual([
      ["clip-1", 0, 1920],
      ["clip-2", 3840, 1920],
      ["clip-3", 5760, 1920],
    ]);
    expect(validateSong(result)).toEqual([]);
  });

  it("(t-piano, 7000) -> 6720에 길이 960(곡 끝까지 빈 공간이 960)", () => {
    const result = addClip(arrangement(), "t-piano", 7000);
    expect(shape(result, "t-piano").at(-1)).toEqual(["clip-3", 6720, 960]);
    expect(validateSong(result)).toEqual([]);
  });

  it("곡 끝(7680)과 음수(-10 -> -960)는 no-op", () => {
    const input = arrangement();
    expect(addClip(input, "t-piano", 7680)).toBe(input);
    expect(addClip(input, "t-piano", -10)).toBe(input);
    expect(addClip(input, "t-piano", 99999)).toBe(input);
  });

  it("NaN·무한대는 no-op", () => {
    const input = arrangement();
    expect(addClip(input, "t-piano", Number.NaN)).toBe(input);
    expect(addClip(input, "t-piano", Number.POSITIVE_INFINITY)).toBe(input);
    expect(addClip(input, "t-piano", Number.NEGATIVE_INFINITY)).toBe(input);
  });

  it("(t-drums, 0) -> 첫 드럼 패턴 drum-basic-rock, 길이 1920, id clip-1", () => {
    const input = arrangement();
    const result = addClip(input, "t-drums", 0);
    expect(shape(result, "t-drums")).toEqual([["clip-1", 0, 1920]]);
    expect(patternOf(clipsOf(result, "t-drums")[0])).toBe("drum-basic-rock");
    expect(validateSong(result)).toEqual([]);
  });

  it("새 클립의 패턴은 악기별 카탈로그의 첫 패턴이다", () => {
    for (const instrument of ["piano", "guitar", "bass", "drums"] as const) {
      const song = songWithPatterns({
        bars: 1,
        tracks: [{ id: "t", instrument, clips: [] }],
      });
      const result = addClip(song, "t", 0);
      expect(patternOf(clipsOf(result, "t")[0])).toBe(
        patternsFor(instrument)[0].id,
      );
    }
  });

  it("존재하지 않는 trackId는 Error", () => {
    const input = arrangement();
    expect(() => addClip(input, "nope", 0)).toThrow(Error);
  });

  it("같은 칸에 두 번 연속 추가하면 둘째는 같은 참조(no-op)", () => {
    const first = addClip(arrangement(), "t-piano", 1920);
    expect(addClip(first, "t-piano", 1920)).toBe(first);
    expect(addClip(first, "t-piano", 2400)).toBe(first);
  });

  it("id는 트랙 안 clip-<n> 최댓값 + 1이다(번호가 비어 있어도 최댓값 뒤)", () => {
    const input = arrangement(undefined, [
      { id: "clip-7", start: 0, length: 1920, pattern: "piano-block" },
      { id: "intro", start: 1920, length: 960, pattern: "piano-block" },
    ]);
    const result = addClip(input, "t-piano", 3840);
    expect(clipsOf(result, "t-piano").map((c) => c.id)).toEqual([
      "clip-7",
      "intro",
      "clip-8",
    ]);
  });

  it("clip-<n> 형식이 아닌 id만 있으면 clip-1부터 시작한다", () => {
    const input = arrangement(undefined, [
      { id: "intro", start: 0, length: 960, pattern: "piano-block" },
    ]);
    const result = addClip(input, "t-piano", 1920);
    expect(clipsOf(result, "t-piano").map((c) => c.id)).toEqual([
      "intro",
      "clip-1",
    ]);
  });

  it("터무니없이 큰 번호의 id가 있어도 멈추지 않고 유일한 id를 낸다", () => {
    const input = arrangement(undefined, [
      {
        id: "clip-100000000000000000000",
        start: 0,
        length: 960,
        pattern: "piano-block",
      },
    ]);
    const result = addClip(input, "t-piano", 1920);
    expect(validateSong(result)).toEqual([]);
    const ids = clipsOf(result, "t-piano").map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("앞 클립이 있어도 뒤 클립까지의 빈 공간이 반마디면 길이 960", () => {
    const input = arrangement(undefined, [
      { id: "clip-1", start: 960, length: 960, pattern: "piano-block" },
      { id: "clip-2", start: 2880, length: 960, pattern: "piano-block" },
    ]);
    const result = addClip(input, "t-piano", 1920);
    expect(shape(result, "t-piano")).toEqual([
      ["clip-1", 960, 960],
      ["clip-3", 1920, 960],
      ["clip-2", 2880, 960],
    ]);
  });
});

describe("moveClip", () => {
  it("(clip-1, 1000) -> 스냅 960", () => {
    const input = arrangement();
    const snapshot = structuredClone(input);
    const result = moveClip(input, "t-piano", "clip-1", 1000);
    expect(shape(result, "t-piano")).toEqual([
      ["clip-1", 960, 1920],
      ["clip-2", 3840, 1920],
    ]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("(clip-1, 99999) -> upper = 3840 - 1920 = 1920에서 멈춘다(겹치지 않는다)", () => {
    const result = moveClip(arrangement(), "t-piano", "clip-1", 99999);
    expect(shape(result, "t-piano")).toEqual([
      ["clip-1", 1920, 1920],
      ["clip-2", 3840, 1920],
    ]);
    expect(validateSong(result)).toEqual([]);
  });

  it("(clip-2, 0) -> lower = 1920(clip-1 끝)에서 멈춘다", () => {
    const result = moveClip(arrangement(), "t-piano", "clip-2", 0);
    expect(shape(result, "t-piano")).toEqual([
      ["clip-1", 0, 1920],
      ["clip-2", 1920, 1920],
    ]);
    expect(validateSong(result)).toEqual([]);
  });

  it("(clip-2, 99999) -> upper = 7680 - 1920 = 5760", () => {
    const result = moveClip(arrangement(), "t-piano", "clip-2", 99999);
    expect(clipsOf(result, "t-piano")[1].start).toBe(5760);
    expect(validateSong(result)).toEqual([]);
  });

  it("(clip-2, -99999) -> lower에서 멈추고, 앞 클립이 없으면 0에서 멈춘다", () => {
    const result = moveClip(arrangement(), "t-piano", "clip-2", -99999);
    expect(clipsOf(result, "t-piano")[1].start).toBe(1920);
    const solo = arrangement(undefined, [PIANO_CLIPS[1]]);
    const soloResult = moveClip(solo, "t-piano", "clip-2", -99999);
    expect(clipsOf(soloResult, "t-piano")[0].start).toBe(0);
  });

  it("(clip-1, 0)은 변화 없음 -> 같은 참조(클램프 결과가 같아도 마찬가지)", () => {
    const input = arrangement();
    expect(moveClip(input, "t-piano", "clip-1", 0)).toBe(input);
    const atUpper = moveClip(input, "t-piano", "clip-1", 1920);
    expect(moveClip(atUpper, "t-piano", "clip-1", 99999)).toBe(atUpper);
  });

  it("옮겨도 본문·길이·다른 클립은 그대로다", () => {
    const input = arrangement();
    const result = moveClip(input, "t-piano", "clip-1", 960);
    const moved = clipsOf(result, "t-piano")[0];
    expect(moved.body).toBe(clipsOf(input, "t-piano")[0].body);
    expect(moved.length).toBe(1920);
    expect(clipsOf(result, "t-piano")[1]).toBe(clipsOf(input, "t-piano")[1]);
  });

  it("NaN은 no-op이고 무한대는 클램프된다", () => {
    const input = arrangement();
    expect(moveClip(input, "t-piano", "clip-1", Number.NaN)).toBe(input);
    const result = moveClip(
      input,
      "t-piano",
      "clip-1",
      Number.POSITIVE_INFINITY,
    );
    expect(clipsOf(result, "t-piano")[0].start).toBe(1920);
  });

  it("곡을 가득 채운 클립은 갈 곳이 없어 no-op", () => {
    const full = arrangement(undefined, [
      { id: "clip-1", start: 0, length: 7680, pattern: "piano-block" },
    ]);
    expect(moveClip(full, "t-piano", "clip-1", 960)).toBe(full);
  });

  it("없는 트랙·클립은 Error(다른 트랙의 클립 id도 마찬가지)", () => {
    const input = arrangement();
    expect(() => moveClip(input, "nope", "clip-1", 0)).toThrow(Error);
    expect(() => moveClip(input, "t-piano", "nope", 0)).toThrow(Error);
    expect(() => moveClip(input, "t-drums", "clip-1", 0)).toThrow(Error);
  });
});

describe("resizeClip", () => {
  it("(clip-1, 960) -> 길이 960", () => {
    const input = arrangement();
    const snapshot = structuredClone(input);
    const result = resizeClip(input, "t-piano", "clip-1", 960);
    expect(shape(result, "t-piano")).toEqual([
      ["clip-1", 0, 960],
      ["clip-2", 3840, 1920],
    ]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("(clip-1, 100) -> 스냅 0이지만 최소 960", () => {
    const result = resizeClip(arrangement(), "t-piano", "clip-1", 100);
    expect(clipsOf(result, "t-piano")[0].length).toBe(960);
    const negative = resizeClip(arrangement(), "t-piano", "clip-1", -5000);
    expect(clipsOf(negative, "t-piano")[0].length).toBe(960);
  });

  it("(clip-1, 99999) -> upper = 3840에서 멈춘다(clip-2와 겹치지 않는다)", () => {
    const result = resizeClip(arrangement(), "t-piano", "clip-1", 99999);
    expect(clipsOf(result, "t-piano")[0].length).toBe(3840);
    expect(validateSong(result)).toEqual([]);
  });

  it("(clip-2, 99999) -> upper = 7680 - 3840 = 3840", () => {
    const result = resizeClip(arrangement(), "t-piano", "clip-2", 99999);
    expect(clipsOf(result, "t-piano")[1].length).toBe(3840);
    expect(validateSong(result)).toEqual([]);
  });

  it("(clip-1, 1920)은 지금 길이와 같아 같은 참조", () => {
    const input = arrangement();
    expect(resizeClip(input, "t-piano", "clip-1", 1920)).toBe(input);
    expect(resizeClip(input, "t-piano", "clip-1", 1500)).toBe(input);
  });

  it("빈 공간이 반마디 미만이면 그만큼만 늘어난다(len = upper)", () => {
    const input = arrangement(undefined, [
      { id: "clip-1", start: 0, length: 480, pattern: "piano-block" },
      { id: "clip-2", start: 700, length: 960, pattern: "piano-block" },
    ]);
    expect(validateSong(input)).toEqual([]);
    const result = resizeClip(input, "t-piano", "clip-1", 5000);
    expect(clipsOf(result, "t-piano")[0].length).toBe(700);
    expect(validateSong(result)).toEqual([]);
  });

  it("NaN은 no-op이고 시작·본문은 그대로다", () => {
    const input = arrangement();
    expect(resizeClip(input, "t-piano", "clip-1", Number.NaN)).toBe(input);
    const result = resizeClip(input, "t-piano", "clip-1", 960);
    expect(clipsOf(result, "t-piano")[0].body).toBe(
      clipsOf(input, "t-piano")[0].body,
    );
  });

  it("notes 클립을 960으로 줄이면 start >= 960인 음은 버리고 start 0은 남긴다", () => {
    const input = notesSong([note(0, 480), note(960, 480), note(1440, 480)]);
    expect(clipsOf(input, "track-1")[0].length).toBe(1920);
    const snapshot = structuredClone(input);
    const result = resizeClip(input, "track-1", "clip-1", 960);
    const body = clipsOf(result, "track-1")[0].body;
    expect(body).toEqual({ type: "notes", notes: [note(0, 480)] });
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("줄인 길이를 넘는 음은 잘린다: 길이 960으로 줄이면 {800, 480}이 160이 된다", () => {
    // 브리프의 "길이 1000"은 격자(960)로 스냅되므로 잘린 길이는 960 - 800 = 160이다.
    const input = notesSong([note(800, 480)]);
    const result = resizeClip(input, "track-1", "clip-1", 1000);
    expect(clipsOf(result, "track-1")[0].length).toBe(960);
    expect(clipsOf(result, "track-1")[0].body).toEqual({
      type: "notes",
      notes: [note(800, 160)],
    });
    expect(validateSong(result)).toEqual([]);
  });

  it("늘릴 때는 notes 본문을 건드리지 않는다", () => {
    const input = notesSong([note(0, 480)], 2);
    const shrunk = resizeClip(input, "track-1", "clip-1", 960);
    const grown = resizeClip(shrunk, "track-1", "clip-1", 3840);
    expect(clipsOf(grown, "track-1")[0].length).toBe(3840);
    expect(clipsOf(grown, "track-1")[0].body).toBe(
      clipsOf(shrunk, "track-1")[0].body,
    );
  });

  it("없는 트랙·클립은 Error", () => {
    const input = arrangement();
    expect(() => resizeClip(input, "nope", "clip-1", 960)).toThrow(Error);
    expect(() => resizeClip(input, "t-piano", "nope", 960)).toThrow(Error);
  });
});

describe("removeClip", () => {
  it("clip-1을 지우면 클립이 하나 줄고 clip-2는 그대로다", () => {
    const input = arrangement();
    const snapshot = structuredClone(input);
    const result = removeClip(input, "t-piano", "clip-1");
    expect(shape(result, "t-piano")).toEqual([["clip-2", 3840, 1920]]);
    expect(clipsOf(result, "t-piano")[0]).toBe(clipsOf(input, "t-piano")[1]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("없는 클립·트랙 id는 Error", () => {
    const input = arrangement();
    expect(() => removeClip(input, "t-piano", "nope")).toThrow(Error);
    expect(() => removeClip(input, "nope", "clip-1")).toThrow(Error);
    expect(() => removeClip(input, "t-drums", "clip-1")).toThrow(Error);
  });
});

describe("setClipPattern", () => {
  it("(clip-1, piano-arpeggio-8th) -> 패턴만 바뀐다", () => {
    const input = arrangement();
    const snapshot = structuredClone(input);
    const result = setClipPattern(
      input,
      "t-piano",
      "clip-1",
      "piano-arpeggio-8th",
    );
    const [c1, c2] = clipsOf(result, "t-piano");
    expect(patternOf(c1)).toBe("piano-arpeggio-8th");
    expect([c1.id, c1.start, c1.length]).toEqual(["clip-1", 0, 1920]);
    expect(c2).toBe(clipsOf(input, "t-piano")[1]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("같은 패턴이면 같은 참조", () => {
    const input = arrangement();
    expect(setClipPattern(input, "t-piano", "clip-1", "piano-block")).toBe(
      input,
    );
  });

  it("악기와 안 맞는 패턴(피아노에 드럼, 드럼에 피아노)은 Error", () => {
    const input = arrangement();
    expect(() =>
      setClipPattern(input, "t-piano", "clip-1", "drum-basic-rock"),
    ).toThrow(Error);
    const withDrum = addClip(input, "t-drums", 0);
    expect(() =>
      setClipPattern(withDrum, "t-drums", "clip-1", "piano-block"),
    ).toThrow(Error);
  });

  it("카탈로그에 없는 패턴 id는 Error", () => {
    expect(() =>
      setClipPattern(arrangement(), "t-piano", "clip-1", "nope"),
    ).toThrow(Error);
  });

  it("notes 클립에는 패턴이 없어 Error", () => {
    const input = notesSong([note(0, 480)]);
    expect(() =>
      setClipPattern(input, "track-1", "clip-1", "piano-block"),
    ).toThrow("notes 클립에는 패턴이 없습니다");
  });

  it("없는 트랙·클립은 Error", () => {
    const input = arrangement();
    expect(() =>
      setClipPattern(input, "nope", "clip-1", "piano-block"),
    ).toThrow(Error);
    expect(() =>
      setClipPattern(input, "t-piano", "nope", "piano-block"),
    ).toThrow(Error);
  });
});

describe("setTrackPattern", () => {
  it("(t-piano, bass-root-fifth) -> 두 클립 모두 바뀐다", () => {
    const input = arrangement();
    const snapshot = structuredClone(input);
    const result = setTrackPattern(input, "t-piano", "bass-root-fifth");
    expect(clipsOf(result, "t-piano").map(patternOf)).toEqual([
      "bass-root-fifth",
      "bass-root-fifth",
    ]);
    expect(shape(result, "t-piano")).toEqual(shape(input, "t-piano"));
    expect(result.tracks[1]).toBe(input.tracks[1]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("이미 모두 그 패턴이면 같은 참조, 일부만 다르면 다른 것만 새 객체", () => {
    const input = arrangement();
    const once = setTrackPattern(input, "t-piano", "piano-block");
    expect(clipsOf(once, "t-piano").map(patternOf)).toEqual([
      "piano-block",
      "piano-block",
    ]);
    expect(clipsOf(once, "t-piano")[0]).toBe(clipsOf(input, "t-piano")[0]);
    expect(setTrackPattern(once, "t-piano", "piano-block")).toBe(once);
  });

  it("클립이 없는 트랙은 no-op", () => {
    const input = arrangement();
    expect(setTrackPattern(input, "t-drums", "drum-four-on-floor")).toBe(input);
  });

  it("notes 클립은 건드리지 않는다", () => {
    // 2마디 곡: notes 클립(0~1920) 뒤에 패턴 클립을 하나 더 둔다.
    const input = notesSong([note(0, 480)], 2);
    const shrunk = resizeClip(input, "track-1", "clip-1", 1920);
    const withPattern = addClip(shrunk, "track-1", 1920);
    expect(clipsOf(withPattern, "track-1").map((c) => c.body.type)).toEqual([
      "notes",
      "pattern",
    ]);
    const result = setTrackPattern(withPattern, "track-1", "bass-root-fifth");
    const [notesClip, patternClip] = clipsOf(result, "track-1");
    expect(notesClip).toBe(clipsOf(withPattern, "track-1")[0]);
    expect(patternOf(patternClip)).toBe("bass-root-fifth");
    // notes 클립만 있는 트랙은 no-op
    const onlyNotes = notesSong([note(0, 480)]);
    expect(setTrackPattern(onlyNotes, "track-1", "bass-root-fifth")).toBe(
      onlyNotes,
    );
  });

  it("악기와 안 맞는 패턴·없는 패턴·없는 트랙은 Error(클립이 없는 트랙이어도)", () => {
    const input = arrangement();
    expect(() => setTrackPattern(input, "t-piano", "drum-basic-rock")).toThrow(
      Error,
    );
    expect(() => setTrackPattern(input, "t-drums", "piano-block")).toThrow(
      Error,
    );
    expect(() => setTrackPattern(input, "t-piano", "nope")).toThrow(Error);
    expect(() => setTrackPattern(input, "nope", "piano-block")).toThrow(Error);
  });
});

describe("setBars", () => {
  /** C 0~1920, Am 1920~5760, F 5760~7680. Am이 2마디 경계(3840)를 가로지르고 3마디 경계(5760)에서 끝난다. */
  const PX: ChordSegment[] = [
    seg(0, 1920, C),
    seg(1920, 3840, AM),
    seg(5760, 1920, F),
  ];

  it("8 -> 진행의 마지막 구간만 7680 늘고 클립·트랙은 그대로다", () => {
    const input = arrangement(P);
    const snapshot = structuredClone(input);
    const result = setBars(input, 8);
    expect(result.bars).toBe(8);
    expect(result.progression).toEqual([
      seg(0, 1920, C),
      seg(1920, 1920, AM),
      seg(3840, 11520, F),
    ]);
    expect(result.tracks).toBe(input.tracks);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("2 -> 진행: start >= 3840인 구간은 버리고 마지막 구간을 자른다; clip-2(3840)는 삭제, clip-1 유지", () => {
    const input = arrangement(PX);
    const snapshot = structuredClone(input);
    const result = setBars(input, 2);
    expect(result.bars).toBe(2);
    expect(result.progression).toEqual([seg(0, 1920, C), seg(1920, 1920, AM)]);
    expect(shape(result, "t-piano")).toEqual([["clip-1", 0, 1920]]);
    expectValidAndInputUntouched(input, snapshot, result);
  });

  it("3(새 끝 5760) -> clip-2는 3840~5760이라 그대로, 진행은 F를 버린다", () => {
    const input = arrangement(PX);
    const result = setBars(input, 3);
    expect(shape(result, "t-piano")).toEqual([
      ["clip-1", 0, 1920],
      ["clip-2", 3840, 1920],
    ]);
    expect(clipsOf(result, "t-piano")[1]).toBe(clipsOf(input, "t-piano")[1]);
    expect(result.progression).toEqual([seg(0, 1920, C), seg(1920, 3840, AM)]);
    expect(validateSong(result)).toEqual([]);
  });

  it("3, 클립이 새 끝을 가로지르면(4800~6720) length 960으로 잘린다", () => {
    const input = arrangement(undefined, [
      { id: "clip-1", start: 0, length: 1920, pattern: "piano-block" },
      { id: "clip-2", start: 4800, length: 1920, pattern: "piano-block" },
    ]);
    const result = setBars(input, 3);
    expect(shape(result, "t-piano")).toEqual([
      ["clip-1", 0, 1920],
      ["clip-2", 4800, 960],
    ]);
    expect(validateSong(result)).toEqual([]);
  });

  it("1 -> 진행은 첫 구간만, clip-2 삭제", () => {
    const result = setBars(arrangement(PX), 1);
    expect(result.progression).toEqual([seg(0, 1920, C)]);
    expect(shape(result, "t-piano")).toEqual([["clip-1", 0, 1920]]);
    expect(validateSong(result)).toEqual([]);
  });

  it("줄일 때 notes 클립의 음도 정리한다(start >= 새 길이는 버리고 넘치는 음은 자른다)", () => {
    const input = songWithNotes({
      bars: 4,
      notes: [note(0, 480), note(1800, 480), note(1920, 480), note(3000, 480)],
    });
    // clip-1: 0~7680. 2마디(3840)로 줄이면 음은 모두 안에 들어간다.
    const mid = setBars(input, 2);
    expect(clipsOf(mid, "track-1")[0].length).toBe(3840);
    expect(clipsOf(mid, "track-1")[0].body).toEqual({
      type: "notes",
      notes: [note(0, 480), note(1800, 480), note(1920, 480), note(3000, 480)],
    });
    expect(clipsOf(mid, "track-1")[0].body).toBe(
      clipsOf(input, "track-1")[0].body,
    );
    // 1마디(1920): 1800~2280은 120으로 잘리고 1920·3000은 버려진다.
    const result = setBars(input, 1);
    expect(clipsOf(result, "track-1")[0].length).toBe(1920);
    expect(clipsOf(result, "track-1")[0].body).toEqual({
      type: "notes",
      notes: [note(0, 480), note(1800, 120)],
    });
    expect(validateSong(result)).toEqual([]);
  });

  it("앞에서 시작하는 notes 클립이 잘리면 음은 클립 기준 상대 틱으로 정리된다", () => {
    const base4 = songWithNotes({ bars: 4, notes: [] });
    // 클립을 1920~7680(길이 5760)에 두고 음을 넣는다.
    const input: Song = {
      ...base4,
      tracks: [
        {
          ...base4.tracks[0],
          clips: [
            {
              id: "clip-1",
              start: 1920,
              length: 5760,
              body: {
                type: "notes",
                notes: [note(0, 480), note(1800, 480), note(1920, 480)],
              },
            },
          ],
        },
      ],
    };
    expect(validateSong(input)).toEqual([]);
    // 새 끝 3840: 클립 길이 1920. 음 1800은 120으로, 1920은 버린다.
    const result = setBars(input, 2);
    expect(clipsOf(result, "track-1")[0].length).toBe(1920);
    expect(clipsOf(result, "track-1")[0].body).toEqual({
      type: "notes",
      notes: [note(0, 480), note(1800, 120)],
    });
    expect(validateSong(result)).toEqual([]);
  });

  it("0, 100, 4.6은 1, 64, 5로 클램프된다", () => {
    const input = arrangement();
    expect(setBars(input, 0).bars).toBe(1);
    expect(setBars(input, -3).bars).toBe(1);
    expect(setBars(input, 100).bars).toBe(64);
    expect(setBars(input, 4.6).bars).toBe(5);
    expect(setBars(input, Number.POSITIVE_INFINITY).bars).toBe(64);
    for (const b of [0, 100, 4.6]) {
      expect(validateSong(setBars(input, b))).toEqual([]);
    }
  });

  it("같은 값(4, 4.2로 반올림해 4)이나 NaN은 같은 참조", () => {
    const input = arrangement();
    expect(setBars(input, 4)).toBe(input);
    expect(setBars(input, 4.2)).toBe(input);
    expect(setBars(input, Number.NaN)).toBe(input);
  });

  it("상한(64마디) 곡은 100을 요청해도 클램프 결과가 같아 no-op", () => {
    const big = songWithPatterns({ bars: 64, tracks: [] });
    expect(setBars(big, 64)).toBe(big);
    expect(setBars(big, 100)).toBe(big);
  });

  it("클립이 바뀌지 않은 트랙은 참조를 유지한다", () => {
    const input = arrangement(PX);
    const result = setBars(input, 3);
    expect(result.tracks[1]).toBe(input.tracks[1]);
  });
});

describe("setTempo", () => {
  it("500, 10, 119.6 -> 240, 40, 120", () => {
    const input = arrangement();
    expect(setTempo(input, 500).tempo).toBe(MAX_TEMPO);
    expect(setTempo(input, 10).tempo).toBe(MIN_TEMPO);
    expect(setTempo(input, 119.6).tempo).toBe(120);
    expect(setTempo(input, 90.4).tempo).toBe(90);
    expect(setTempo(input, Number.POSITIVE_INFINITY).tempo).toBe(240);
    expect(MAX_TEMPO).toBe(240);
    expect(MIN_TEMPO).toBe(40);
  });

  it("같은 값(120, 119.6 -> 120, 클램프 후 같음)이나 NaN은 같은 참조", () => {
    const input = arrangement();
    expect(setTempo(input, 120)).toBe(input);
    expect(setTempo(input, 119.6)).toBe(input);
    const fast = setTempo(input, 240);
    expect(setTempo(fast, 9999)).toBe(fast);
    expect(setTempo(input, Number.NaN)).toBe(input);
  });

  it("곡의 나머지는 그대로 공유한다", () => {
    const input = arrangement();
    const snapshot = structuredClone(input);
    const result = setTempo(input, 90);
    expect(result.tracks).toBe(input.tracks);
    expect(result.progression).toBe(input.progression);
    expectValidAndInputUntouched(input, snapshot, result);
  });
});

describe("속성: 모든 편집 함수를 섞은 무작위 열", () => {
  const OPS = [
    "setChord",
    "splitSegment",
    "moveBoundary",
    "mergeSegments",
    "addClip",
    "moveClip",
    "resizeClip",
    "removeClip",
    "setClipPattern",
    "setTrackPattern",
    "setBars",
    "setTempo",
  ] as const;
  type Op = (typeof OPS)[number];
  const PROGRESSION_OPS: readonly Op[] = [
    "setChord",
    "splitSegment",
    "moveBoundary",
    "mergeSegments",
  ];
  const VALID_CHORDS: Chord[] = [
    C,
    AM,
    F,
    { root: 7, quality: "dom7" },
    { root: 2, quality: "maj7" },
  ];

  function initialSong(): Song {
    const song = songWithPatterns({
      bars: 4,
      tracks: [
        { id: "t-piano", instrument: "piano", clips: PIANO_CLIPS },
        { id: "t-guitar", instrument: "guitar", clips: [] },
        { id: "t-bass", instrument: "bass", clips: [] },
        {
          id: "t-drums",
          instrument: "drums",
          clips: [
            {
              id: "clip-1",
              start: 960,
              length: 1920,
              pattern: "drum-basic-rock",
            },
          ],
        },
      ],
      progression: P,
    });
    song.tracks.push({
      id: "t-notes",
      instrument: "piano",
      clips: [
        {
          id: "clip-1",
          start: 0,
          length: 3840,
          body: {
            type: "notes",
            notes: [
              note(0, 480),
              note(960, 480),
              note(1800, 480),
              note(3000, 840),
            ],
          },
        },
      ],
    });
    return song;
  }

  it("시드 20개 x 연산 300번: 매번 유효·겹침 없음·입력 불변·진행이 곡을 덮고, 함수마다 바뀜/no-op 경로를 지난다", () => {
    const changed = new Map<Op, number>();
    const unchanged = new Map<Op, number>();
    const thrown = new Map<Op, number>();
    const bump = (m: Map<Op, number>, op: Op) =>
      m.set(op, (m.get(op) ?? 0) + 1);

    for (let seed = 1; seed <= 20; seed++) {
      const rand = mulberry32(seed * 7919);
      const int = (lo: number, hi: number) =>
        lo + Math.floor(rand() * (hi - lo + 1));
      const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
      let song = initialSong();

      for (let step = 0; step < 300; step++) {
        const prev = song;
        const prevClone = structuredClone(prev);
        const total = prev.bars * 1920;
        const op = pick(OPS);

        // 인자: 유효한 값과 잘못된 값(없는 id, 범위 밖, NaN)을 섞는다.
        const trackId = rand() < 0.08 ? "nope" : pick(prev.tracks).id;
        const track = prev.tracks.find((t) => t.id === trackId);
        const clipId =
          rand() < 0.08 || !track || track.clips.length === 0
            ? pick(["nope", "clip-1"])
            : pick(track.clips).id;
        const clip = track?.clips.find((c) => c.id === clipId);
        const tick =
          rand() < 0.05
            ? Number.NaN
            : rand() < 0.1
              ? int(-50000, 100000)
              : int(-500, total + 1500);
        const compatible = track
          ? patternsFor(track.instrument).map((p) => p.id)
          : [];
        const patternId =
          rand() < 0.1
            ? "nope"
            : rand() < 0.15
              ? pick(PATTERNS).id
              : compatible.length > 0
                ? pick(compatible)
                : "piano-block";
        const index = int(-2, prev.progression.length + 1);
        const chord: Chord =
          rand() < 0.1 ? { root: 12, quality: "maj" } : pick(VALID_CHORDS);

        // 이 호출이 `Error`를 던져야 하는지를 인자로부터 미리 계산한다.
        // 진행 연산은 RangeError를 던질 수 있다(범위 밖 인덱스, 잘못된 코드).
        let mustThrow = false;
        if (op === "addClip" || op === "setTrackPattern") mustThrow ||= !track;
        if (
          op === "moveClip" ||
          op === "resizeClip" ||
          op === "removeClip" ||
          op === "setClipPattern"
        ) {
          mustThrow ||= !track || !clip;
        }
        if (op === "setClipPattern" && clip) {
          mustThrow ||= clip.body.type === "notes";
        }
        if (op === "setClipPattern" || op === "setTrackPattern") {
          mustThrow ||= !compatible.includes(patternId);
        }

        let next: Song | undefined;
        let error: unknown;
        try {
          switch (op) {
            case "setChord":
              next = setChord(prev, index, chord);
              break;
            case "splitSegment":
              next = splitSegment(prev, tick);
              break;
            case "moveBoundary":
              next = moveBoundary(prev, index, tick);
              break;
            case "mergeSegments":
              next = mergeSegments(prev, index);
              break;
            case "addClip":
              next = addClip(prev, trackId, tick);
              break;
            case "moveClip":
              next = moveClip(prev, trackId, clipId, tick);
              break;
            case "resizeClip":
              next = resizeClip(prev, trackId, clipId, tick);
              break;
            case "removeClip":
              next = removeClip(prev, trackId, clipId);
              break;
            case "setClipPattern":
              next = setClipPattern(prev, trackId, clipId, patternId);
              break;
            case "setTrackPattern":
              next = setTrackPattern(prev, trackId, patternId);
              break;
            case "setBars": {
              const r = rand();
              const bars =
                r < 0.1
                  ? Number.NaN
                  : r < 0.2
                    ? prev.bars
                    : r < 0.3
                      ? pick([0, 100, 4.6, -3, 63.5])
                      : int(1, 12);
              next = setBars(prev, bars);
              break;
            }
            case "setTempo": {
              const r = rand();
              const bpm =
                r < 0.1
                  ? Number.NaN
                  : r < 0.25
                    ? prev.tempo
                    : r < 0.35
                      ? pick([10, 500, 119.6])
                      : int(30, 250);
              next = setTempo(prev, bpm);
              break;
            }
          }
        } catch (e) {
          error = e;
        }

        if (error !== undefined) {
          bump(thrown, op);
          if (PROGRESSION_OPS.includes(op)) {
            expect(error).toBeInstanceOf(RangeError);
          } else {
            // 클립·곡 전체 연산의 오류는 인자가 잘못됐을 때만, 평범한 Error로 던진다.
            expect(mustThrow).toBe(true);
            expect((error as Error).constructor).toBe(Error);
          }
          expect(prev).toEqual(prevClone);
          continue;
        }
        // 던져야 했는데 안 던졌다면 잘못된 인자가 조용히 받아들여진 것이다.
        expect(mustThrow).toBe(false);

        expect(next).toBeDefined();
        song = next as Song;
        expect(validateSong(song)).toEqual([]);
        expect(prev).toEqual(prevClone); // 입력 불변

        // 같은 트랙의 클립은 겹치지 않고, 진행은 곡을 덮는다.
        const len = song.bars * 1920;
        for (const t of song.tracks) {
          let cursor = 0;
          for (const c of t.clips) {
            expect(c.start).toBeGreaterThanOrEqual(cursor);
            expect(c.start + c.length).toBeLessThanOrEqual(len);
            cursor = c.start + c.length;
          }
        }
        let sum = 0;
        for (const s of song.progression) sum += s.length;
        expect(sum).toBe(len);

        if (song === prev) {
          bump(unchanged, op);
        } else {
          bump(changed, op);
          expect(song).not.toEqual(prevClone);
        }
      }
    }

    // 속성 테스트가 허공을 치지 않았는지: 모든 함수가 바뀜 경로를, removeClip 말고는 no-op 경로도 지났다.
    for (const op of OPS) {
      expect(changed.get(op) ?? 0, `${op} 바뀜 경로`).toBeGreaterThan(0);
      // removeClip은 지우거나 던질 뿐 no-op 경로가 없다.
      if (op === "removeClip") continue;
      expect(unchanged.get(op) ?? 0, `${op} no-op 경로`).toBeGreaterThan(0);
    }
    // 던질 수 있는 함수는 던지는 경로도 지났다.
    for (const op of [
      "setChord",
      "moveBoundary",
      "mergeSegments",
      "addClip",
      "moveClip",
      "resizeClip",
      "removeClip",
      "setClipPattern",
      "setTrackPattern",
    ] as const) {
      expect(thrown.get(op) ?? 0, `${op} 오류 경로`).toBeGreaterThan(0);
    }
  }, PROPERTY_TIMEOUT_MS);
});
