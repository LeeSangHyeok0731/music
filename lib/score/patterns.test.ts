import { describe, expect, it } from "vitest";

import { chordPitch } from "@/lib/score/chords";
import { CHORD_QUALITIES } from "@/lib/score/model";
import {
  BAR_4_4,
  PATTERNS,
  getPattern,
  patternsFor,
} from "@/lib/score/patterns";

describe("패턴 카탈로그", () => {
  it("패턴 id는 불변이다 — 스냅샷이 바뀌면 옛 링크의 소리가 달라진다", () => {
    // 이 테스트가 실패하면 패턴을 '고친' 것이다. 고치지 말고 새 id로 추가하라.
    // 의도한 추가라면 스냅샷 파일에 새 항목이 생길 뿐 기존 항목은 그대로여야 한다.
    expect(PATTERNS).toMatchSnapshot();
  });

  it("id가 유일하다", () => {
    const ids = PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getPattern은 id로 찾고 없으면 undefined다", () => {
    expect(getPattern("piano-block")?.id).toBe("piano-block");
    expect(getPattern("nope")).toBeUndefined();
  });

  it("patternsFor는 악기에 맞는 종류만 돌려준다", () => {
    expect(patternsFor("drums").every((p) => p.kind === "drum")).toBe(true);
    for (const inst of ["piano", "guitar", "bass"] as const) {
      const list = patternsFor(inst);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((p) => p.kind === "harmonic")).toBe(true);
    }
    expect(patternsFor("drums").length).toBeGreaterThan(0);
  });

  it("모든 스텝이 패턴 길이 안에서 시작하고 양수 길이를 가진다", () => {
    for (const p of PATTERNS) {
      expect(p.length).toBeGreaterThan(0);
      for (const s of p.steps) {
        expect(s.at).toBeGreaterThanOrEqual(0);
        expect(s.at).toBeLessThan(p.length);
        expect(s.length).toBeGreaterThan(0);
        expect(Number.isInteger(s.at) && Number.isInteger(s.length)).toBe(true);
        expect(s.velocity).toBeGreaterThan(0);
        expect(s.velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("모든 화음 패턴이 12개 근음 × 모든 코드 종류에서 MIDI 범위 안의 음을 만든다", () => {
    for (const p of PATTERNS) {
      if (p.kind !== "harmonic") continue;
      for (let root = 0; root < 12; root++) {
        for (const quality of CHORD_QUALITIES) {
          for (const s of p.steps) {
            const pitch = chordPitch({ root, quality }, s.degree, s.octave);
            expect(pitch).toBeGreaterThanOrEqual(0);
            expect(pitch).toBeLessThanOrEqual(127);
          }
        }
      }
    }
  });

  it("4/4 한 마디는 1920틱이다", () => {
    expect(BAR_4_4).toBe(1920);
  });
});
