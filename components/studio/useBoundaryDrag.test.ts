import { describe, expect, it } from "vitest";

import { buildDemoSong } from "@/lib/score/demo-song";

import { boundaryTickFromPointer, previewBoundary } from "./useBoundaryDrag";

describe("boundaryTickFromPointer", () => {
  it("레인 왼쪽 기준 x를 틱으로 바꾼다(1px = 12틱)", () => {
    expect(boundaryTickFromPointer(96 + 320, 96)).toBe(3840);
  });

  it("scrollLeft를 따로 더하지 않는다: 레인 left가 이미 스크롤을 반영한다", () => {
    expect(boundaryTickFromPointer(96, 96 - 320)).toBe(3840);
  });

  it("곡 시작보다 왼쪽은 0으로 자른다", () => {
    expect(boundaryTickFromPointer(0, 96)).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "유한하지 않은 입력(%s)은 null",
    (x) => {
      expect(boundaryTickFromPointer(x, 96)).toBeNull();
      expect(boundaryTickFromPointer(100, x)).toBeNull();
    },
  );
});

describe("previewBoundary", () => {
  it("옮긴 곡을 돌려주고 원본은 바꾸지 않는다", () => {
    const song = buildDemoSong();
    const before = structuredClone(song);
    const next = previewBoundary(song, 0, 5760);
    expect(next).not.toBe(song);
    expect(next.progression[1].start).toBe(5760);
    expect(song).toEqual(before);
  });

  it("변화가 없으면 같은 참조다", () => {
    const song = buildDemoSong();
    expect(previewBoundary(song, 0, 3840 + 100)).toBe(song);
  });

  it("없는 경계 번호는 원본을 돌려준다(던지지 않는다)", () => {
    const song = buildDemoSong();
    expect(previewBoundary(song, 9, 5760)).toBe(song);
  });

  it("양쪽 반마디가 남도록 클램프한다", () => {
    const song = buildDemoSong();
    expect(previewBoundary(song, 0, 0).progression[1].start).toBe(960);
    expect(previewBoundary(song, 0, 99999).progression[1].start).toBe(6720);
  });
});
