import { describe, expect, it } from "vitest";

import {
  DEFAULT_TILE_LENGTH,
  DEFAULT_VELOCITY,
  MIN_TILE_LENGTH,
  SNAP_TICKS,
  defaultNotesFor,
  nextTileId,
  snapToGrid,
} from "@/lib/score/edit";
import { buildDemoSong } from "@/lib/score/fixture";

describe("상수", () => {
  it("스냅은 16분음표(120틱)다", () => {
    expect(SNAP_TICKS).toBe(120);
  });

  it("최소 타일 길이는 1스냅이다", () => {
    expect(MIN_TILE_LENGTH).toBe(SNAP_TICKS);
  });

  it("기본 타일은 4분음표 길이에 세기 0.7이다", () => {
    expect(DEFAULT_TILE_LENGTH).toBe(480);
    expect(DEFAULT_VELOCITY).toBe(0.7);
  });
});

describe("snapToGrid", () => {
  it("가장 가까운 격자로 붙인다", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(59)).toBe(0);
    expect(snapToGrid(61)).toBe(120);
    expect(snapToGrid(120)).toBe(120);
    expect(snapToGrid(1799)).toBe(1800);
  });

  it("음수는 0으로 붙인다", () => {
    expect(snapToGrid(-50)).toBe(0);
    expect(snapToGrid(-500)).toBe(0);
  });
});

describe("nextTileId", () => {
  it("fixture의 id와 섞여도 tile-0부터 시작한다", () => {
    // fixture의 id는 piano-0, hihat-3-7 같은 형태라 tile-<숫자> 패턴에
    // 맞지 않는다. 계산에 끼지 않아야 한다.
    expect(nextTileId(buildDemoSong())).toBe("tile-0");
  });

  it("이미 있는 tile-<n> 중 가장 큰 값 다음을 준다", () => {
    const song = buildDemoSong();
    const withTiles = {
      ...song,
      lines: song.lines.map((line, i) =>
        i === 0
          ? {
              ...line,
              tiles: [
                { id: "tile-0", start: 0, length: 120, velocity: 0.5, notes: [60] },
                { id: "tile-7", start: 240, length: 120, velocity: 0.5, notes: [60] },
              ],
            }
          : line,
      ),
    };
    expect(nextTileId(withTiles)).toBe("tile-8");
  });
});

describe("defaultNotesFor", () => {
  it("악기마다 다른 기본 음을 준다", () => {
    expect(defaultNotesFor("piano")).toEqual([60, 64, 67]);
    expect(defaultNotesFor("guitar")).toEqual([62, 66, 69]);
    expect(defaultNotesFor("bass")).toEqual([36]);
  });

  it("드럼은 기본 타일이 없다 — 빈 배열", () => {
    expect(defaultNotesFor("drums")).toEqual([]);
  });
});
