import { describe, expect, it } from "vitest";

import { chordPitchClasses } from "@/lib/score/chords";
import type { Chord, Clip, Note } from "@/lib/score/model";
import { songWithPatterns } from "@/lib/score/testing/builders";

import {
  KEY_COLUMN_WIDTH,
  ROLL_CHORD_STRIP_HEIGHT,
  ROLL_PX_PER_BEAT,
  ROW_HEIGHT,
  VELOCITY_LANE_HEIGHT,
  chordSegmentsInClip,
  chordToneRows,
  gridBackground,
  initialScrollTop,
  isBlackKey,
  lengthLabel,
  noteName,
  noteRect,
  pitchToY,
  rollTickToX,
  rollXToTick,
  velocityFromY,
  yToPitch,
} from "./geometry";

const C: Chord = { root: 0, quality: "maj" };
const AM: Chord = { root: 9, quality: "min" };

describe("상수", () => {
  it("계획의 값 그대로", () => {
    expect(ROLL_PX_PER_BEAT).toBe(96);
    expect(ROW_HEIGHT).toBe(20);
    expect(KEY_COLUMN_WIDTH).toBe(56);
  });
});

describe("rollTickToX / rollXToTick", () => {
  it("한 박(480틱) = 96px, 1틱 = 0.2px", () => {
    expect(rollTickToX(480)).toBe(96);
    expect(rollTickToX(0)).toBe(0);
    expect(rollTickToX(1)).toBeCloseTo(0.2, 10);
    expect(rollTickToX(1920)).toBe(384);
    expect(rollXToTick(96)).toBe(480);
    expect(rollXToTick(384)).toBe(1920);
  });

  it("곱셈을 먼저 해서 부동소수 오차가 없다(3·96/480 = 0.6)", () => {
    // 틱 × 96 / 480: 7틱 → 1.4, 정확히 같은 식의 결과여야 한다.
    expect(rollTickToX(7)).toBe((7 * 96) / 480);
    expect(rollTickToX(3)).toBe((3 * 96) / 480);
  });

  it("x → 틱은 가장 가까운 정수로 반올림하고 -0을 정리한다", () => {
    expect(rollXToTick(0.5)).toBe(3); // 2.5 → 3
    expect(rollXToTick(0.4)).toBe(2);
    expect(Object.is(rollXToTick(-0.1), 0)).toBe(true);
    expect(Object.is(rollXToTick(0), 0)).toBe(true);
    expect(rollXToTick(-96)).toBe(-480);
  });

  it("틱 → x의 -0도 정리한다", () => {
    expect(Object.is(rollTickToX(-0), 0)).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "비유한 값(%s)은 0이다",
    (v) => {
      expect(rollTickToX(v)).toBe(0);
      expect(rollXToTick(v)).toBe(0);
    },
  );

  it("왕복: 정수 틱은 그대로 돌아온다", () => {
    for (const tick of [0, 1, 7, 120, 240, 479, 480, 1919, 12345]) {
      expect(rollXToTick(rollTickToX(tick))).toBe(tick);
    }
  });
});

describe("pitchToY / yToPitch", () => {
  it("맨 위 행이 hi다", () => {
    expect(pitchToY(96, 96)).toBe(0);
    expect(pitchToY(95, 96)).toBe(20);
    expect(pitchToY(60, 96)).toBe(720);
  });

  it("y → 음높이: 행 안의 어느 y든 같은 음", () => {
    expect(yToPitch(0, 96)).toBe(96);
    expect(yToPitch(19, 96)).toBe(96);
    expect(yToPitch(20, 96)).toBe(95);
    expect(yToPitch(720, 96)).toBe(60);
    expect(yToPitch(739.9, 96)).toBe(60);
  });

  it("왕복", () => {
    for (let p = 36; p <= 96; p++) {
      expect(yToPitch(pitchToY(p, 96) + 10, 96)).toBe(p);
    }
  });

  it("비유한 y는 맨 위 행(hi)", () => {
    expect(yToPitch(Number.NaN, 96)).toBe(96);
    expect(yToPitch(Number.POSITIVE_INFINITY, 96)).toBe(96);
  });
});

describe("noteName / isBlackKey", () => {
  it.each([
    [60, "C4"],
    [61, "C#4"],
    [71, "B4"],
    [72, "C5"],
    [36, "C2"],
    [28, "E1"],
    [0, "C-1"],
    [127, "G9"],
  ])("noteName(%i) = %s", (pitch, name) => {
    expect(noteName(pitch)).toBe(name);
  });

  it("검은 건반", () => {
    for (const p of [61, 63, 66, 68, 70, 73, 25]) expect(isBlackKey(p)).toBe(true);
    for (const p of [60, 62, 64, 65, 67, 69, 71, 72, 36]) {
      expect(isBlackKey(p)).toBe(false);
    }
  });
});

describe("noteRect", () => {
  it("클립 기준 틱과 음높이를 px 사각형으로 바꾼다", () => {
    const note: Note = { start: 480, length: 240, pitch: 60, velocity: 0.8 };
    expect(noteRect(note, 96)).toEqual({
      left: 96,
      top: 720,
      width: 48,
      height: ROW_HEIGHT,
    });
  });
});

describe("chordSegmentsInClip", () => {
  const song = songWithPatterns({
    bars: 2,
    tracks: [],
    progression: [
      { start: 0, length: 1920, chord: C },
      { start: 1920, length: 1920, chord: AM },
    ],
  });

  it("클립 기준 상대 틱으로 자른다(클립 960~2880)", () => {
    const clip: Clip = {
      id: "c",
      start: 960,
      length: 1920,
      body: { type: "notes", notes: [] },
    };
    expect(chordSegmentsInClip(song, clip)).toEqual([
      { start: 0, length: 960, chord: C },
      { start: 960, length: 960, chord: AM },
    ]);
  });

  it("구간 하나 안에 든 클립은 그 코드 하나", () => {
    const clip: Clip = {
      id: "c",
      start: 480,
      length: 960,
      body: { type: "notes", notes: [] },
    };
    expect(chordSegmentsInClip(song, clip)).toEqual([
      { start: 0, length: 960, chord: C },
    ]);
  });

  it("구간 경계에 딱 맞는 클립은 이웃 구간을 포함하지 않는다", () => {
    const clip: Clip = {
      id: "c",
      start: 1920,
      length: 1920,
      body: { type: "notes", notes: [] },
    };
    expect(chordSegmentsInClip(song, clip)).toEqual([
      { start: 0, length: 1920, chord: AM },
    ]);
  });
});

describe("chordToneRows", () => {
  it("chordPitchClasses와 같다", () => {
    expect(chordToneRows(C)).toEqual([0, 4, 7]);
    expect(chordToneRows(AM)).toEqual(chordPitchClasses(AM));
  });
});

describe("gridBackground", () => {
  it("마디·박·격자 단위 순서로 레이어를 쌓고 크기는 px다(4/4, 1/8)", () => {
    const bg = gridBackground("1/8", 480, 4);
    const sizes = [...bg.matchAll(/\/ (\d+(?:\.\d+)?)px 100%/g)].map((m) => m[1]);
    expect(sizes).toEqual(["384", "96", "48"]);
  });

  it("1/16이면 24px, 1/4는 박과 같으니 레이어를 중복하지 않는다", () => {
    const sizesOf = (unit: "1/4" | "1/8" | "1/16") =>
      [...gridBackground(unit, 480, 4).matchAll(/\/ (\d+(?:\.\d+)?)px 100%/g)].map(
        (m) => m[1],
      );
    expect(sizesOf("1/16")).toEqual(["384", "96", "24"]);
    expect(sizesOf("1/4")).toEqual(["384", "96"]);
  });

  it("마디선이 가장 진하고 선택한 단위의 선이 가장 옅다", () => {
    const alphas = [...gridBackground("1/8", 480, 4).matchAll(/to right, rgb\(255 255 255 \/ ([\d.]+)\) 0,/g)].map(
      (m) => Number(m[1]),
    );
    expect(alphas).toHaveLength(3);
    expect(alphas[0]).toBeGreaterThan(alphas[1]);
    expect(alphas[1]).toBeGreaterThan(alphas[2]);
  });

  it("3/4 박자는 마디가 3박(288px)", () => {
    const sizes = [...gridBackground("1/8", 480, 3).matchAll(/\/ (\d+(?:\.\d+)?)px 100%/g)].map(
      (m) => m[1],
    );
    expect(sizes[0]).toBe("288");
  });
});

describe("lengthLabel", () => {
  it.each([
    [120, "1/16"],
    [240, "1/8"],
    [480, "1/4"],
    [960, "1/2"],
    [1920, "1/1"],
    [360, "3/16"],
    [720, "3/8"],
    [3840, "2/1"],
    [7, "7/1920"],
  ])("%i틱 = %s", (ticks, label) => {
    expect(lengthLabel(ticks)).toBe(label);
  });
});

describe("initialScrollTop", () => {
  // 위 코드 띠와 아래 세기 레인이 보이는 영역을 가린다.
  const strip = ROLL_CHORD_STRIP_HEIGHT + VELOCITY_LANE_HEIGHT;

  it("음이 없으면 C4(60) 행을 보이는 영역 가운데에 둔다", () => {
    // hi 96: C4 행 top 720, 가운데 730. 보이는 높이 400(띠·레인 제외 296)이면 730 - 148
    expect(initialScrollTop([], 96, 400)).toBe(
      pitchToY(60, 96) + ROW_HEIGHT / 2 - (400 - strip) / 2,
    );
  });

  it("음이 있으면 음 범위(최저~최고)의 가운데", () => {
    const notes: Note[] = [
      { start: 0, length: 240, pitch: 72, velocity: 0.8 },
      { start: 0, length: 240, pitch: 80, velocity: 0.8 },
    ];
    // 중앙 76
    expect(initialScrollTop(notes, 96, 400)).toBe(
      pitchToY(76, 96) + ROW_HEIGHT / 2 - (400 - strip) / 2,
    );
  });

  it("위쪽으로 넘치면 0으로 자른다", () => {
    expect(initialScrollTop([], 96, 20000)).toBe(0);
    expect(initialScrollTop([], 96, 0)).toBeGreaterThanOrEqual(0);
  });

  it("비유한 높이는 0 높이로 본다", () => {
    expect(initialScrollTop([], 96, Number.NaN)).toBe(
      initialScrollTop([], 96, 0),
    );
  });
});

describe("velocityFromY", () => {
  const H = VELOCITY_LANE_HEIGHT;

  it("레인 높이는 80px", () => {
    expect(H).toBe(80);
  });

  it("레인 위쪽(y 0)은 1, 아래쪽(y 높이)은 0.05, 가운데(y 40)는 0.5", () => {
    expect(velocityFromY(0, H)).toBe(1);
    expect(velocityFromY(H, H)).toBe(0.05);
    expect(velocityFromY(40, H)).toBe(0.5);
  });

  it("레인 밖은 클램프한다(위 -10 → 1, 아래 90 → 0.05)", () => {
    expect(velocityFromY(-10, H)).toBe(1);
    expect(velocityFromY(90, H)).toBe(0.05);
  });

  it("반올림하지 않는다(y 7 → 1 − 7/80)", () => {
    expect(velocityFromY(7, H)).toBe(1 - 7 / 80);
  });

  it("비유한 y·높이와 0 이하 높이는 null", () => {
    expect(velocityFromY(Number.NaN, H)).toBeNull();
    expect(velocityFromY(Infinity, H)).toBeNull();
    expect(velocityFromY(10, Number.NaN)).toBeNull();
    expect(velocityFromY(10, 0)).toBeNull();
    expect(velocityFromY(10, -80)).toBeNull();
  });
});
