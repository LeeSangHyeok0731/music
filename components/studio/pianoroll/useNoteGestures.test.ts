import { describe, expect, it } from "vitest";

import type { Note, Song } from "@/lib/score/model";
import { noteKey, planMoveNotes } from "@/lib/score/notes";
import { songWithNotes } from "@/lib/score/testing/builders";

import { movedPastThreshold } from "../useClipDrag";
import {
  NO_SCROLL,
  boxFromPoints,
  cellFromPointer,
  liveSelection,
  movedPastThreshold as rollMovedPastThreshold,
  previewDelta,
  previewNotes,
  toggleKey,
  unionKeys,
} from "./useNoteGestures";

/** 격자: 화면 (100, 50)에서 시작, 1마디(1920틱 = 384px) × 61행(1220px), hi 96. */
const RECT = { left: 100, top: 50, width: 384, height: 61 * 20 };
const HI = 96;

describe("cellFromPointer", () => {
  it("손계산 값: 칸의 시작으로 내리고(1/8 = 48px) 행은 y가 든 행이다", () => {
    expect(cellFromPointer(100, 50, RECT, NO_SCROLL, HI, "1/8")).toEqual({
      tick: 0,
      pitch: 96,
    });
    // x 47.9px = 239.5틱 → 0칸, 48px = 240틱 → 240
    expect(cellFromPointer(147.9, 50, RECT, NO_SCROLL, HI, "1/8")?.tick).toBe(0);
    expect(cellFromPointer(148, 50, RECT, NO_SCROLL, HI, "1/8")?.tick).toBe(240);
    // 1/4 칸(96px): x 191px = 955틱 → 480
    expect(cellFromPointer(291, 50, RECT, NO_SCROLL, HI, "1/4")?.tick).toBe(480);
    // y 739.9 → (96 - 36) = 60, y 740 → 59
    expect(cellFromPointer(100, 50 + 739.9, RECT, NO_SCROLL, HI, "1/8")?.pitch).toBe(60);
    expect(cellFromPointer(100, 50 + 740, RECT, NO_SCROLL, HI, "1/8")?.pitch).toBe(59);
  });

  it("스크롤 보정: 이미 스크롤이 반영된 격자 사각형(scroll 0)과 원점 사각형 + 스크롤이 같은 칸이다", () => {
    // 격자 요소의 getBoundingClientRect는 스크롤을 이미 반영한다(left가 300px 왼쪽으로 간다).
    const scrolled = { ...RECT, left: RECT.left - 300, top: RECT.top - 200 };
    const viaRect = cellFromPointer(150, 80, scrolled, NO_SCROLL, HI, "1/8");
    const viaScroll = cellFromPointer(150, 80, RECT, { left: 300, top: 200 }, HI, "1/8");
    expect(viaRect).toEqual(viaScroll);
    // x = 150 - (100 - 300) = 350px → 1750틱 → 1680, y = 80 - (50 - 200) = 230 → 96 - 11 = 85
    expect(viaRect).toEqual({ tick: 1680, pitch: 85 });
    // 스크롤을 두 번 더하면 다른 칸이다(이중 보정 방지의 근거).
    expect(
      cellFromPointer(150, 80, scrolled, { left: 300, top: 200 }, HI, "1/8"),
    ).not.toEqual(viaRect);
  });

  it("격자 밖(음수·폭/높이 이상)은 null", () => {
    expect(cellFromPointer(99.9, 60, RECT, NO_SCROLL, HI, "1/8")).toBeNull();
    expect(cellFromPointer(120, 49.9, RECT, NO_SCROLL, HI, "1/8")).toBeNull();
    expect(cellFromPointer(100 + 384, 60, RECT, NO_SCROLL, HI, "1/8")).toBeNull();
    expect(cellFromPointer(120, 50 + 1220, RECT, NO_SCROLL, HI, "1/8")).toBeNull();
    expect(cellFromPointer(100 + 383.9, 50 + 1219.9, RECT, NO_SCROLL, HI, "1/8")).toEqual({
      tick: 1680,
      pitch: 36,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "유한하지 않은 값(%s)은 null",
    (bad) => {
      expect(cellFromPointer(bad, 60, RECT, NO_SCROLL, HI, "1/8")).toBeNull();
      expect(cellFromPointer(120, bad, RECT, NO_SCROLL, HI, "1/8")).toBeNull();
      expect(cellFromPointer(120, 60, { ...RECT, left: bad }, NO_SCROLL, HI, "1/8")).toBeNull();
      expect(cellFromPointer(120, 60, RECT, { left: 0, top: bad }, HI, "1/8")).toBeNull();
      expect(cellFromPointer(120, 60, RECT, NO_SCROLL, bad, "1/8")).toBeNull();
    },
  );
});

describe("boxFromPoints", () => {
  it("두 점(격자 안 px)을 틱 구간·음높이 구간으로, 방향과 무관하게", () => {
    const box = { startTick: 240, endTick: 960, loPitch: 90, hiPitch: 95 };
    // x 48px = 240틱, 192px = 960틱; y 25 → 95, y 125 → 96 - 6 = 90
    expect(boxFromPoints({ x: 48, y: 25 }, { x: 192, y: 125 }, HI)).toEqual(box);
    expect(boxFromPoints({ x: 192, y: 125 }, { x: 48, y: 25 }, HI)).toEqual(box);
    expect(boxFromPoints({ x: 192, y: 25 }, { x: 48, y: 125 }, HI)).toEqual(box);
  });

  it("격자 밖으로 나간 점도 그대로 환산한다(음수 틱·hi 위 행)", () => {
    expect(boxFromPoints({ x: -10, y: -5 }, { x: 10, y: 5 }, HI)).toEqual({
      startTick: -50,
      endTick: 50,
      loPitch: 96,
      hiPitch: 97,
    });
  });

  it("유한하지 않으면 NaN 박스(selectNotesInBox가 []를 준다)", () => {
    const box = boxFromPoints({ x: Number.NaN, y: 0 }, { x: 10, y: 5 }, HI);
    expect(Object.values(box).every(Number.isNaN)).toBe(true);
  });
});

describe("movedPastThreshold", () => {
  it("2a의 같은 함수를 다시 쓴다(5px)", () => {
    expect(rollMovedPastThreshold).toBe(movedPastThreshold);
    expect(rollMovedPastThreshold(4.9, 0)).toBe(false);
    expect(rollMovedPastThreshold(3, 4)).toBe(true);
  });
});

describe("선택 키 도우미", () => {
  const notes: Note[] = [
    { start: 0, length: 240, pitch: 60, velocity: 0.8 },
    { start: 240, length: 240, pitch: 62, velocity: 0.8 },
  ];

  it("liveSelection: 클립에 없는 키와 중복을 거르고 순서를 지킨다", () => {
    expect(liveSelection(notes, ["240:62", "9:9", "0:60", "240:62"])).toEqual([
      "240:62",
      "0:60",
    ]);
  });

  it("liveSelection: 바뀐 게 없으면 같은 배열을 돌려준다", () => {
    const sel = ["0:60"];
    expect(liveSelection(notes, sel)).toBe(sel);
  });

  it("toggleKey·unionKeys", () => {
    expect(toggleKey(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleKey(["a"], "b")).toEqual(["a", "b"]);
    expect(unionKeys(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });
});

/**
 * 한 마디 클립. C4 [0,240), E4 [0,240)(화음), C4 [960,1200).
 */
function chordSong(): Song {
  return songWithNotes({
    notes: [
      { start: 0, length: 240, pitch: 60, velocity: 0.8 },
      { start: 0, length: 240, pitch: 64, velocity: 0.8 },
      { start: 960, length: 240, pitch: 60, velocity: 0.8 },
    ],
  });
}
const T = "track-1";
const C = "clip-1";

describe("previewDelta", () => {
  const chord = [noteKey({ start: 0, pitch: 60 }), noteKey({ start: 0, pitch: 64 })];

  it("이동: dTicks = rollXToTick(Δx), dPitch = −round(Δy/20)", () => {
    const song = chordSong();
    const r = previewDelta("move", song, T, C, chord, 48, -40, "1/8");
    expect(r.status).toBe("valid");
    if (r.status !== "valid") return;
    expect([r.dTicks, r.dPitch]).toEqual([240, 2]);
    expect(r.plan.keys).toEqual(["240:62", "240:66"]);
  });

  it("이동: 칸 절반 미만·반 행 미만이면 zero(제자리)", () => {
    const song = chordSong();
    expect(previewDelta("move", song, T, C, chord, 23, 9, "1/8").status).toBe("zero");
    expect(previewDelta("move", song, T, C, chord, -23, -9, "1/8").status).toBe("zero");
  });

  it("이동: 거부(겹침·경계)는 rejected — zero와 구별된다", () => {
    const song = chordSong();
    // C4 [0,240)를 960으로 옮기면 C4 [960,1200)와 겹친다.
    expect(previewDelta("move", song, T, C, chord, 192, 0, "1/8").status).toBe(
      "rejected",
    );
    // 왼쪽 경계 밖
    expect(previewDelta("move", song, T, C, chord, -48, 0, "1/8").status).toBe(
      "rejected",
    );
    // 같은 plan 함수도 같은 참조를 준다(거부)
    expect(planMoveNotes(song, T, C, chord, -240, 0, "1/8").song).toBe(song);
  });

  it("이동: 유한하지 않은 변화량은 rejected", () => {
    const song = chordSong();
    expect(previewDelta("move", song, T, C, chord, Number.NaN, 0, "1/8").status).toBe(
      "rejected",
    );
  });

  it("길이: Δy는 무시하고 dTicks만, 클램프로 바뀌는 게 없으면 zero", () => {
    const song = chordSong();
    const r = previewDelta("resize", song, T, C, chord, 96, 300, "1/8");
    expect(r.status).toBe("valid");
    if (r.status === "valid") expect([r.dTicks, r.dPitch]).toEqual([480, 0]);
    // 이미 최소 길이(1/8)인데 줄이기 → 바뀌는 게 없으니 제자리
    expect(previewDelta("resize", song, T, C, chord, -96, 0, "1/8").status).toBe("zero");
    expect(previewDelta("resize", song, T, C, chord, 10, 0, "1/8").status).toBe("zero");
  });
});

describe("previewNotes", () => {
  it("원래 키 → 미리보기 음(이동한 위치)으로 짝짓는다", () => {
    const song = chordSong();
    const keys = ["0:64", "0:60"];
    const r = previewDelta("move", song, T, C, keys, 48, 20, "1/8");
    if (r.status !== "valid") throw new Error("valid여야 한다");
    const map = previewNotes(r.plan, T, C, keys);
    expect([...map.keys()]).toEqual(["0:64", "0:60"]);
    expect(map.get("0:64")).toMatchObject({ start: 240, pitch: 63 });
    expect(map.get("0:60")).toMatchObject({ start: 240, pitch: 59 });
  });

  it("길이 미리보기는 같은 키의 늘어난 음", () => {
    const song = chordSong();
    const keys = ["960:60"];
    const r = previewDelta("resize", song, T, C, keys, 48, 0, "1/8");
    if (r.status !== "valid") throw new Error("valid여야 한다");
    expect(previewNotes(r.plan, T, C, keys).get("960:60")).toMatchObject({
      start: 960,
      length: 480,
    });
  });
});
