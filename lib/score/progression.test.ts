import { describe, expect, it } from "vitest";

import type { ChordSegment } from "@/lib/score/model";
import {
  chordAt,
  defaultProgression,
  segmentIndexAt,
} from "@/lib/score/progression";

const C = { root: 0, quality: "maj" } as const;
const AM = { root: 9, quality: "min" } as const;
const F = { root: 5, quality: "maj" } as const;

const PROG: ChordSegment[] = [
  { start: 0, length: 960, chord: C },
  { start: 960, length: 1920, chord: AM },
  { start: 2880, length: 960, chord: F },
];

describe("defaultProgression", () => {
  it("곡 전체를 덮는 C maj 한 구간이다", () => {
    expect(defaultProgression(8, [4, 4])).toEqual([
      { start: 0, length: 8 * 1920, chord: { root: 0, quality: "maj" } },
    ]);
  });

  it("박자표를 반영한다(3/4 한 마디 = 1440)", () => {
    expect(defaultProgression(2, [3, 4])[0].length).toBe(2880);
  });
});

describe("chordAt / segmentIndexAt", () => {
  it("구간 시작 틱은 그 구간에 속한다", () => {
    expect(chordAt(PROG, 0)).toBe(C);
    expect(chordAt(PROG, 960)).toBe(AM);
    expect(chordAt(PROG, 2880)).toBe(F);
  });

  it("구간 끝 직전 틱은 그 구간이고 끝 틱은 다음 구간이다", () => {
    expect(chordAt(PROG, 959)).toBe(C);
    expect(chordAt(PROG, 2879)).toBe(AM);
    expect(chordAt(PROG, 1919)).toBe(AM);
  });

  it("곡 마지막 틱은 마지막 구간이고 끝 틱 이상·음수는 RangeError다", () => {
    expect(chordAt(PROG, 3839)).toBe(F);
    expect(() => chordAt(PROG, 3840)).toThrow(RangeError);
    expect(() => chordAt(PROG, -1)).toThrow(RangeError);
    expect(() => chordAt([], 0)).toThrow(RangeError);
  });

  it("segmentIndexAt은 같은 규칙으로 인덱스를 돌려준다", () => {
    expect([0, 959, 960, 2879, 2880, 3839].map((t) => segmentIndexAt(PROG, t))).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
  });

  it("구간이 많아도 정확하다(이분 탐색 경계)", () => {
    const many: ChordSegment[] = Array.from({ length: 100 }, (_, i) => ({
      start: i * 960,
      length: 960,
      chord: { root: i % 12, quality: "maj" as const },
    }));
    for (const i of [0, 1, 49, 50, 98, 99]) {
      expect(segmentIndexAt(many, i * 960)).toBe(i);
      expect(segmentIndexAt(many, i * 960 + 959)).toBe(i);
    }
  });
});
