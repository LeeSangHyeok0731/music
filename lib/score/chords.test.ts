import { describe, expect, it } from "vitest";

import { chordPitch } from "@/lib/score/chords";
import type { Chord } from "@/lib/score/model";

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
});
