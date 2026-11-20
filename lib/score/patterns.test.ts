import { describe, expect, it } from "vitest";

import { chordPitch } from "@/lib/score/chords";
import { CHORD_QUALITIES } from "@/lib/score/model";
import {
  BAR_4_4,
  PATTERNS,
  getPattern,
  patternsFor,
} from "@/lib/score/patterns";

/**
 * 이미 낸 패턴 id. **추가만 한다** — 새 패턴을 만들면 여기에 id를 덧붙인다.
 * 기존 id를 지우거나(삭제) 그 내용을 바꾸는 것(아래 패턴별 스냅샷)은 금지다.
 */
const FROZEN_PATTERN_IDS = [
  "piano-block",
  "piano-arpeggio-8th",
  "guitar-strum-quarter",
  "bass-root-quarter",
  "bass-root-fifth",
  "drum-basic-rock",
  "drum-four-on-floor",
];

describe("패턴 카탈로그 — 불변", () => {
  // 패턴마다 스냅샷이 따로라서 '새 패턴 추가'(새 항목이 생김)와 '기존 패턴 수정'
  // (기존 항목이 깨짐)이 구분된다. 기존 항목이 깨지면 패턴을 '고친' 것이다 —
  // 고치지 말고 새 id로 추가하라. `-u`로 덮어쓰지 않는다.
  //
  // CI(`CI=true`)에서 vitest는 없는 스냅샷을 쓰지 않고 실패한다. 새 패턴을 추가했으면
  // 로컬에서 한 번 테스트를 돌려 그 패턴의 스냅샷을 기록하고 스냅샷 파일을 함께 커밋한다.
  for (const p of PATTERNS) {
    // 이 describe 제목과 it 제목을 바꾸지 말 것(스냅샷 키). 바꾸면 로컬 실행에서 새 키로
    // 다시 기록되고 옛 항목은 obsolete가 될 뿐 실패하지 않아, 같이 바꾼 내용 변경이 통과한다.
    it(`${p.id}의 내용은 바뀌지 않는다`, () => {
      expect(p).toMatchSnapshot();
    });
  }

  it("이미 낸 패턴 id는 하나도 사라지지 않는다", () => {
    // 지운 패턴의 스냅샷은 '쓰이지 않는 스냅샷'이 될 뿐 테스트를 실패시키지 않는다.
    // 삭제는 이 고정 목록이 잡는다.
    expect(PATTERNS.map((p) => p.id)).toEqual(
      expect.arrayContaining(FROZEN_PATTERN_IDS),
    );
  });

  it("id가 유일하다", () => {
    const ids = PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("패턴 카탈로그 — 런타임 불변", () => {
  // vitest의 ESM 모듈은 strict 모드라 얼린 객체에 쓰면 조용히 무시되지 않고 TypeError다.
  it("카탈로그 배열에 패턴을 넣을 수 없다", () => {
    expect(() =>
      // @ts-expect-error -- PATTERNS는 readonly 배열이다. 런타임에도 얼어 있는지 확인한다.
      PATTERNS.push(PATTERNS[0]),
    ).toThrow(TypeError);
  });

  it("패턴의 필드와 스텝 배열·스텝을 바꿀 수 없다", () => {
    const p = getPattern("piano-block");
    if (!p || p.kind !== "harmonic") throw new Error("piano-block이 없다");
    expect(() => {
      // @ts-expect-error -- 패턴 필드는 readonly다. 런타임에도 얼어 있는지 확인한다.
      p.length = 1;
    }).toThrow(TypeError);
    expect(() =>
      // @ts-expect-error -- steps는 readonly 배열이다. 런타임에도 얼어 있는지 확인한다.
      p.steps.push({ at: 0, length: 1, degree: 0, octave: 4, velocity: 1 }),
    ).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error -- 스텝 필드는 readonly다. 런타임에도 얼어 있는지 확인한다.
      p.steps[0].velocity = 0.1;
    }).toThrow(TypeError);
    expect(p.steps[0].velocity).toBe(0.7);
  });

  it("patternsFor는 새 배열을 돌려주므로 호출자가 바꿔도 카탈로그는 그대로다", () => {
    const first = patternsFor("drums");
    const before = first.length;
    first.length = 0;
    first.push(getPattern("piano-block")!);
    expect(patternsFor("drums")).toHaveLength(before);
    expect(patternsFor("drums").every((p) => p.kind === "drum")).toBe(true);
    expect(PATTERNS.map((p) => p.id)).toEqual(
      expect.arrayContaining(FROZEN_PATTERN_IDS),
    );
  });
});

describe("패턴 카탈로그 — 조회", () => {
  it("getPattern은 모든 카탈로그 id에 대해 그 패턴 객체 자체를 돌려준다", () => {
    for (const p of PATTERNS) {
      expect(getPattern(p.id)).toBe(p);
    }
  });

  it("getPattern은 없는 id에 undefined다", () => {
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
});

describe("패턴 카탈로그 — 내용 범위", () => {
  it("모든 스텝이 패턴 길이 안에서 시작하고 끝나며 양수 길이를 가진다", () => {
    for (const p of PATTERNS) {
      expect(p.length).toBeGreaterThan(0);
      for (const s of p.steps) {
        expect(s.at).toBeGreaterThanOrEqual(0);
        expect(s.at).toBeLessThan(p.length);
        expect(s.length).toBeGreaterThan(0);
        expect(s.at + s.length).toBeLessThanOrEqual(p.length);
        expect(Number.isInteger(s.at) && Number.isInteger(s.length)).toBe(true);
        expect(s.velocity).toBeGreaterThan(0);
        expect(s.velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("모든 화음 패턴이 12개 근음 × 모든 코드 종류에서 악기 대역(24~96) 안의 음을 만든다", () => {
    // 현재 실제 범위는 36(베이스 C2)~78(피아노 B4 위 5음). MIDI 전체(0~127)보다
    // 좁게 잡아 옥타브를 잘못 적은 패턴을 잡는다.
    for (const p of PATTERNS) {
      if (p.kind !== "harmonic") continue;
      for (let root = 0; root < 12; root++) {
        for (const quality of CHORD_QUALITIES) {
          for (const s of p.steps) {
            const pitch = chordPitch({ root, quality }, s.degree, s.octave);
            expect(pitch).toBeGreaterThanOrEqual(24);
            expect(pitch).toBeLessThanOrEqual(96);
          }
        }
      }
    }
  });

  it("4/4 한 마디는 1920틱이다", () => {
    expect(BAR_4_4).toBe(1920);
  });
});
