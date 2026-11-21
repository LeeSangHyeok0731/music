import { describe, expect, it } from "vitest";

import { buildDemoSong } from "@/lib/score/demo-song";
import { songWithPatterns } from "@/lib/score/testing/builders";

import {
  DRAG_THRESHOLD_PX,
  findClip,
  laneTickFromPointer,
  movedPastThreshold,
  planAddClip,
  previewMove,
  previewResize,
} from "./useClipDrag";

function gapSong() {
  return songWithPatterns({
    bars: 4,
    tracks: [
      {
        id: "t",
        instrument: "piano",
        clips: [
          { id: "clip-1", start: 0, length: 1920, pattern: "piano-block" },
          { id: "clip-2", start: 5760, length: 1920, pattern: "piano-block" },
        ],
      },
    ],
  });
}

describe("movedPastThreshold", () => {
  it("임계값은 5px", () => {
    expect(DRAG_THRESHOLD_PX).toBe(5);
  });

  it("5px 미만이면 클릭, 5px 이상이면 드래그(방향 무관)", () => {
    expect(movedPastThreshold(0, 0)).toBe(false);
    expect(movedPastThreshold(4.9, 0)).toBe(false);
    expect(movedPastThreshold(5, 0)).toBe(true);
    expect(movedPastThreshold(-5, 0)).toBe(true);
    expect(movedPastThreshold(0, 5)).toBe(true);
  });

  it("대각선은 거리로 잰다(3, 4 = 5)", () => {
    expect(movedPastThreshold(3, 4)).toBe(true);
    expect(movedPastThreshold(3, 3)).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "유한하지 않은 입력(%s)은 드래그가 아니다",
    (v) => {
      expect(movedPastThreshold(v, 0)).toBe(false);
      expect(movedPastThreshold(0, v)).toBe(false);
    },
  );
});

describe("laneTickFromPointer", () => {
  it("레인 left 기준(1px = 12틱)이고 scrollLeft를 더하지 않는다", () => {
    expect(laneTickFromPointer(96 + 320, 96)).toBe(3840);
    expect(laneTickFromPointer(96, 96 - 320)).toBe(3840);
  });

  it("왼쪽은 0으로 자르고 비유한 입력은 null", () => {
    expect(laneTickFromPointer(0, 96)).toBe(0);
    expect(laneTickFromPointer(Number.NaN, 96)).toBeNull();
    expect(laneTickFromPointer(100, Number.NaN)).toBeNull();
  });
});

describe("findClip", () => {
  it("트랙·클립 id로 찾고 없으면 undefined", () => {
    const song = gapSong();
    expect(findClip(song, "t", "clip-2")?.start).toBe(5760);
    expect(findClip(song, "t", "nope")).toBeUndefined();
    expect(findClip(song, "nope", "clip-1")).toBeUndefined();
  });
});

describe("previewMove / previewResize", () => {
  it("편집 함수와 같은 규칙(스냅·클램프)으로 옮긴 곡을 돌려주고 원본은 그대로다", () => {
    const song = gapSong();
    const before = structuredClone(song);
    expect(
      findClip(previewMove(song, "t", "clip-2", 4800), "t", "clip-2"),
    ).toMatchObject({ start: 4800 });
    expect(
      findClip(previewMove(song, "t", "clip-2", -999), "t", "clip-2"),
    ).toMatchObject({ start: 1920 });
    expect(
      findClip(previewResize(song, "t", "clip-1", 2880), "t", "clip-1"),
    ).toMatchObject({ length: 2880 });
    expect(
      findClip(previewResize(song, "t", "clip-1", 10), "t", "clip-1"),
    ).toMatchObject({ length: 960 });
    expect(song).toEqual(before);
  });

  it("바뀌는 게 없으면 같은 참조다", () => {
    const song = gapSong();
    expect(previewMove(song, "t", "clip-2", 5760)).toBe(song);
    expect(previewMove(song, "t", "clip-2", 5760 + 100)).toBe(song);
    expect(previewResize(song, "t", "clip-1", 1920)).toBe(song);
  });

  it("없는 트랙·클립이나 NaN은 던지지 않고 원본을 돌려준다", () => {
    const song = gapSong();
    expect(previewMove(song, "nope", "clip-1", 0)).toBe(song);
    expect(previewMove(song, "t", "nope", 0)).toBe(song);
    expect(previewMove(song, "t", "clip-1", Number.NaN)).toBe(song);
    expect(previewResize(song, "t", "clip-1", Number.NaN)).toBe(song);
    expect(previewResize(song, "nope", "clip-1", 960)).toBe(song);
  });
});

describe("planAddClip", () => {
  it("추가될 클립의 새 id를 돌려준다", () => {
    expect(planAddClip(gapSong(), "t", 2500)).toBe("clip-3");
  });

  it("자리가 없거나 클립 위면 null", () => {
    const song = gapSong();
    expect(planAddClip(song, "t", 100)).toBeNull(); // clip-1 위
    expect(planAddClip(song, "t", 7600)).toBeNull(); // clip-2 위(곡 끝)
    expect(planAddClip(song, "t", Number.NaN)).toBeNull();
    expect(planAddClip(song, "t", -50)).toBeNull();
  });

  it("없는 트랙은 던지지 않고 null", () => {
    expect(planAddClip(gapSong(), "nope", 2500)).toBeNull();
  });

  it("원본 곡을 바꾸지 않는다", () => {
    const song = buildDemoSong();
    const before = structuredClone(song);
    planAddClip(song, "track-piano", 0);
    expect(song).toEqual(before);
  });
});
