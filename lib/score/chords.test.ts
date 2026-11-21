import { describe, expect, it } from "vitest";

import { chordLabel, chordPitch } from "@/lib/score/chords";
import { CHORD_QUALITIES, type Chord } from "@/lib/score/model";

const C_MAJ: Chord = { root: 0, quality: "maj" };
const A_MIN: Chord = { root: 9, quality: "min" };
const G_DOM7: Chord = { root: 7, quality: "dom7" };

describe("chordPitch", () => {
  it("C장조 3화음은 옥타브 4에서 60, 64, 67이다", () => {
    expect(chordPitch(C_MAJ, 0, 4)).toBe(60);
    expect(chordPitch(C_MAJ, 1, 4)).toBe(64);
    expect(chordPitch(C_MAJ, 2, 4)).toBe(67);
  });

  it("3화음에서 degree 3은 한 옥타브 위 근음이다", () => {
    expect(chordPitch(C_MAJ, 3, 4)).toBe(72);
    expect(chordPitch(C_MAJ, 4, 4)).toBe(76);
  });

  it("단3화음은 3음이 반음 낮다", () => {
    // A minor: A4=69, C5=72, E5=76
    expect(chordPitch(A_MIN, 0, 4)).toBe(69);
    expect(chordPitch(A_MIN, 1, 4)).toBe(72);
    expect(chordPitch(A_MIN, 2, 4)).toBe(76);
  });

  it("7화음은 degree 3이 7음이다", () => {
    // G7 옥타브 3: G3=55, B3=59, D4=62, F4=65
    expect(chordPitch(G_DOM7, 0, 3)).toBe(55);
    expect(chordPitch(G_DOM7, 1, 3)).toBe(59);
    expect(chordPitch(G_DOM7, 2, 3)).toBe(62);
    expect(chordPitch(G_DOM7, 3, 3)).toBe(65);
  });

  it("maj7과 min7의 7음", () => {
    expect(chordPitch({ root: 0, quality: "maj7" }, 3, 4)).toBe(71);
    expect(chordPitch({ root: 0, quality: "min7" }, 3, 4)).toBe(70);
  });

  it("7화음에서 degree 4는 한 옥타브 위 근음이다", () => {
    // C dom7 옥타브 4: 근음 60 → degree 4는 72
    expect(chordPitch({ root: 0, quality: "dom7" }, 4, 4)).toBe(72);
    expect(chordPitch(G_DOM7, 4, 3)).toBe(55 + 12);
  });

  describe("모든 코드 종류의 degree 0~4 — 손으로 계산한 고정 표", () => {
    // 공유 링크의 소리가 코드 구성음 간격에 달려 있다. 간격이 바뀌면 같은 링크가
    // 말없이 다른 소리를 낸다. 아래 값은 구현을 부르거나 그 식을 옮겨 오지 않고
    // 음이름에서 직접 적었다(C4=60). 3화음은 degree 3이 한 옥타브 위 근음,
    // degree 4가 한 옥타브 위 3음이고, 7화음은 degree 4가 한 옥타브 위 근음이다.
    const TABLE: Array<[string, Chord, number, readonly number[]]> = [
      // C 옥타브 4
      ["C maj 옥타브 4", { root: 0, quality: "maj" }, 4, [60, 64, 67, 72, 76]], // C4 E4 G4 C5 E5
      ["C min 옥타브 4", { root: 0, quality: "min" }, 4, [60, 63, 67, 72, 75]], // C4 Eb4 G4 C5 Eb5
      ["C dom7 옥타브 4", { root: 0, quality: "dom7" }, 4, [60, 64, 67, 70, 72]], // C4 E4 G4 Bb4 C5
      ["C maj7 옥타브 4", { root: 0, quality: "maj7" }, 4, [60, 64, 67, 71, 72]], // C4 E4 G4 B4 C5
      ["C min7 옥타브 4", { root: 0, quality: "min7" }, 4, [60, 63, 67, 70, 72]], // C4 Eb4 G4 Bb4 C5
      // G 옥타브 3
      ["G maj 옥타브 3", { root: 7, quality: "maj" }, 3, [55, 59, 62, 67, 71]], // G3 B3 D4 G4 B4
      ["G min 옥타브 3", { root: 7, quality: "min" }, 3, [55, 58, 62, 67, 70]], // G3 Bb3 D4 G4 Bb4
      ["G dom7 옥타브 3", { root: 7, quality: "dom7" }, 3, [55, 59, 62, 65, 67]], // G3 B3 D4 F4 G4
      ["G maj7 옥타브 3", { root: 7, quality: "maj7" }, 3, [55, 59, 62, 66, 67]], // G3 B3 D4 F#4 G4
      ["G min7 옥타브 3", { root: 7, quality: "min7" }, 3, [55, 58, 62, 65, 67]], // G3 Bb3 D4 F4 G4
    ];

    it.each(TABLE)("%s", (_name, chord, octave, expected) => {
      expect([0, 1, 2, 3, 4].map((degree) => chordPitch(chord, degree, octave))).toEqual(
        expected,
      );
    });
  });

  it.each([-1, 1.5, Number.NaN])(
    "degree가 음이 아닌 정수가 아니면(%s) RangeError를 던진다",
    (degree) => {
      expect(() => chordPitch(C_MAJ, degree, 4)).toThrow(RangeError);
      expect(() => chordPitch(C_MAJ, degree, 4)).toThrow(
        "degree는 0 이상의 정수여야 합니다",
      );
    },
  );
});

describe("chordLabel", () => {
  const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const SUFFIX = { maj: "", min: "m", dom7: "7", maj7: "maj7", min7: "m7" } as const;

  it("12개 근음 x 5개 종류 전체 표", () => {
    for (let root = 0; root < 12; root++) {
      for (const quality of CHORD_QUALITIES) {
        expect(chordLabel({ root, quality })).toBe(ROOTS[root] + SUFFIX[quality]);
      }
    }
  });

  it("예시 이름", () => {
    expect(chordLabel(C_MAJ)).toBe("C");
    expect(chordLabel(A_MIN)).toBe("Am");
    expect(chordLabel(G_DOM7)).toBe("G7");
    expect(chordLabel({ root: 6, quality: "maj7" })).toBe("F#maj7");
    expect(chordLabel({ root: 2, quality: "min7" })).toBe("Dm7");
  });

  it.each([-1, 12, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "근음이 0..11의 정수가 아니면(%s) RangeError",
    (root) => {
      expect(() => chordLabel({ root, quality: "maj" })).toThrow(RangeError);
    },
  );
});
