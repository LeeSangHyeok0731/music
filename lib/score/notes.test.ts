import { describe, expect, it } from "vitest";

import {
  MAX_OCTAVE,
  MIN_OCTAVE,
  NATURAL_SEMITONES,
  SHARP_SEMITONES,
  midiOf,
  midiToName,
  octaveOf,
} from "@/lib/score/notes";

describe("midiToName", () => {
  it("MIDI 60은 도4다", () => {
    expect(midiToName(60)).toBe("도4");
  });

  it("MIDI 61은 도#4다", () => {
    expect(midiToName(61)).toBe("도#4");
  });
});

describe("octaveOf", () => {
  // 재작성 전에도 옥타브 계산은 Math.floor(note / 12) - 1이었다. 기존
  // 타일들이 이미 이 규칙으로 저장된 MIDI 값을 쓰고 있으므로, 값이 같더라도
  // 계산 방식이 갈리면 안 된다 — 이 테스트는 그 값을 고정한다.
  it("MIDI 60은 4옥타브다", () => {
    expect(octaveOf(60)).toBe(Math.floor(60 / 12) - 1);
    expect(octaveOf(60)).toBe(4);
  });

  it("옥타브 경계(MIDI 0, 12)에서도 같은 공식을 따른다", () => {
    expect(octaveOf(0)).toBe(Math.floor(0 / 12) - 1);
    expect(octaveOf(12)).toBe(Math.floor(12 / 12) - 1);
  });
});

describe("midiOf", () => {
  it("octaveOf의 역함수다 — MIN_OCTAVE..MAX_OCTAVE 전 구간에서", () => {
    for (let octave = MIN_OCTAVE; octave <= MAX_OCTAVE; octave++) {
      for (let semitone = 0; semitone < 12; semitone++) {
        const note = midiOf(octave, semitone);
        expect(octaveOf(note)).toBe(octave);
      }
    }
  });

  it("n % 12를 그대로 넣어도 n을 복원한다 — 음수 n을 포함해서", () => {
    // midiToName은 ((note % 12) + 12) % 12로 음수를 정규화하는데 midiOf는
    // 그러지 않으면 두 함수가 서로 다른 규칙을 쓰게 된다. 이 비대칭이
    // 남아 있으면 midiOf(octaveOf(n), n % 12) === n이 n < 0에서 깨진다.
    for (let n = -24; n <= 24; n++) {
      expect(midiOf(octaveOf(n), ((n % 12) + 12) % 12)).toBe(n);
    }
  });
});

describe("NATURAL_SEMITONES와 SHARP_SEMITONES", () => {
  it("0..11을 정확히 한 번씩만 덮는다", () => {
    // 건반 렌더링(NotePickerModal)이 이 두 배열로 흰건/검은건을 나눈다.
    // 겹치거나 빠진 반음이 있으면 건반에 키가 중복되거나 아예 안 그려진다.
    const combined = [...NATURAL_SEMITONES, ...SHARP_SEMITONES].sort(
      (a, b) => a - b,
    );
    expect(combined).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it("두 배열 사이에 겹치는 값이 없다", () => {
    const overlap = NATURAL_SEMITONES.filter((s) =>
      (SHARP_SEMITONES as readonly number[]).includes(s),
    );
    expect(overlap).toEqual([]);
  });
});
