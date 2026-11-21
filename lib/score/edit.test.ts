import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLIP_TICKS,
  MAX_BARS_UI,
  MIN_BARS,
  SNAP_TICKS,
  mergeSegments,
  moveBoundary,
  setChord,
  snapTick,
  splitSegment,
} from "@/lib/score/edit";
import type { Chord, ChordSegment, Song } from "@/lib/score/model";
import { songWithPatterns } from "@/lib/score/testing/builders";
import { mulberry32 } from "@/lib/score/testing/random";
import { validateSong } from "@/lib/score/validate";

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

  it("시드 20개 x 연산 200번 뒤에도 매번 유효하고 반마디 격자를 지킨다", () => {
    let changed = 0;
    let unchanged = 0;
    let rangeErrors = 0;

    for (let seed = 1; seed <= 20; seed++) {
      const rand = mulberry32(seed);
      const int = (lo: number, hi: number) =>
        lo + Math.floor(rand() * (hi - lo + 1));
      let song = base();
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
            next = setChord(prev, index, CHORDS[int(0, CHORDS.length - 1)]);
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
          expect(s.length % SNAP_TICKS).toBe(0);
          expect(s.length).toBeGreaterThanOrEqual(SNAP_TICKS);
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
  });
});
