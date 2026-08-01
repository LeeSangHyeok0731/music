import { describe, expect, it } from "vitest";

import {
  DEFAULT_TILE_LENGTH,
  DEFAULT_VELOCITY,
  MIN_TILE_LENGTH,
  SNAP_TICKS,
  addTile,
  defaultNotesFor,
  moveTile,
  nextTileId,
  removeTile,
  resizeTile,
  setTileNotes,
  setTileVelocity,
  snapToGrid,
  toggleDrumCell,
} from "@/lib/score/edit";
import { buildDemoSong } from "@/lib/score/fixture";
import { DRUM_HIHAT, DRUM_KICK } from "@/lib/score/types";
import type { Song } from "@/lib/score/types";

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

/** 피아노 라인 하나만 있는 2마디 곡. 편집 결과를 눈으로 따라가기 쉽다. */
function simpleSong(): Song {
  return {
    tempo: 120,
    timeSignature: [4, 4],
    lengthTicks: 3840,
    lines: [
      {
        id: "L",
        name: "피아노",
        kind: "pitched",
        instrument: "piano",
        tiles: [
          { id: "a", start: 480, length: 480, velocity: 0.5, notes: [62, 65] },
        ],
      },
    ],
  };
}

function tilesOf(song: Song): Song["lines"][number]["tiles"] {
  return song.lines[0].tiles;
}

describe("addTile", () => {
  it("왼쪽의 가장 가까운 타일을 복제한다", () => {
    const next = addTile(simpleSong(), "L", 1440);
    const added = tilesOf(next).find((t) => t.start === 1440)!;

    expect(added.notes).toEqual([62, 65]);
    expect(added.length).toBe(480);
    expect(added.velocity).toBe(0.5);
  });

  it("왼쪽에 여럿 있으면 가장 가까운 것을 고른다", () => {
    // 타일이 하나뿐이면 "가장 가까운 것"과 "아무 왼쪽 타일"이 구분되지 않는다.
    // 셋을 두고 서로 다른 내용을 줘서 실제로 가장 가까운 것을 고르는지 본다.
    const song: Song = {
      ...simpleSong(),
      lines: [
        {
          ...simpleSong().lines[0],
          tiles: [
            { id: "far", start: 0, length: 120, velocity: 0.1, notes: [50] },
            { id: "mid", start: 480, length: 240, velocity: 0.2, notes: [55] },
            { id: "near", start: 960, length: 360, velocity: 0.3, notes: [60] },
            { id: "right", start: 2400, length: 480, velocity: 0.9, notes: [70] },
          ],
        },
      ],
    };

    const next = addTile(song, "L", 1440);
    const added = tilesOf(next).find((t) => t.start === 1440)!;

    expect(added.notes).toEqual([60]);
    expect(added.length).toBe(360);
    expect(added.velocity).toBe(0.3);
  });

  it("클릭 위치와 같은 start의 타일은 왼쪽이 아니다", () => {
    // 경계 조건. tile.start < start 여야 왼쪽이다.
    const song: Song = {
      ...simpleSong(),
      lines: [
        {
          ...simpleSong().lines[0],
          tiles: [
            { id: "same", start: 1440, length: 240, velocity: 0.3, notes: [70] },
          ],
        },
      ],
    };

    const next = addTile(song, "L", 1440);
    const added = tilesOf(next).find((t) => t.id.startsWith("tile-"))!;

    // 왼쪽에 아무것도 없으므로 기본 타일이다
    expect(added.notes).toEqual([60, 64, 67]);
    expect(added.length).toBe(480);
  });

  it("왼쪽에 타일이 없으면 오른쪽을 보지 않고 기본 타일을 쓴다", () => {
    const next = addTile(simpleSong(), "L", 0);
    const added = tilesOf(next).find((t) => t.start === 0)!;

    expect(added.notes).toEqual([60, 64, 67]);
    expect(added.length).toBe(480);
    expect(added.velocity).toBe(0.7);
  });

  it("클릭 위치를 격자에 붙인다", () => {
    const next = addTile(simpleSong(), "L", 1450);
    expect(tilesOf(next).some((t) => t.start === 1440)).toBe(true);
  });

  it("정렬 불변식을 유지한다", () => {
    const next = addTile(simpleSong(), "L", 0);
    const starts = tilesOf(next).map((t) => t.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("원본을 변형하지 않는다", () => {
    const song = simpleSong();
    addTile(song, "L", 1440);
    expect(song.lines[0].tiles).toHaveLength(1);
  });

  it("곡 끝을 넘는 위치에는 끝에 맞춰 넣는다", () => {
    const next = addTile(simpleSong(), "L", 3840);
    const added = tilesOf(next).find((t) => t.id.startsWith("tile-"))!;
    expect(added.start + added.length).toBeLessThanOrEqual(3840);
  });
});

describe("moveTile", () => {
  it("격자에 붙여 옮긴다", () => {
    const next = moveTile(simpleSong(), "L", "a", 1450);
    expect(tilesOf(next)[0].start).toBe(1440);
  });

  it("곡 앞으로 나가면 0으로 클램프한다", () => {
    const next = moveTile(simpleSong(), "L", "a", -600);
    expect(tilesOf(next)[0].start).toBe(0);
  });

  it("곡 끝을 넘으면 끝에서 멈춘다", () => {
    const next = moveTile(simpleSong(), "L", "a", 3840);
    const tile = tilesOf(next)[0];
    expect(tile.start + tile.length).toBe(3840);
  });

  it("옮긴 뒤에도 정렬이 유지된다", () => {
    const song = addTile(simpleSong(), "L", 2400);
    const next = moveTile(song, "L", "a", 3000);
    const starts = tilesOf(next).map((t) => t.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("겹치는 위치로 옮기는 것을 허용한다", () => {
    const song = addTile(simpleSong(), "L", 2400);
    const next = moveTile(song, "L", "a", 2400);
    expect(tilesOf(next).filter((t) => t.start === 2400)).toHaveLength(2);
  });
});

describe("resizeTile", () => {
  it("격자에 붙여 길이를 바꾼다", () => {
    const next = resizeTile(simpleSong(), "L", "a", 950);
    expect(tilesOf(next)[0].length).toBe(960);
  });

  it("최소 길이 아래로는 줄지 않는다", () => {
    const next = resizeTile(simpleSong(), "L", "a", 10);
    expect(tilesOf(next)[0].length).toBe(120);
  });

  it("곡 끝을 넘지 않는다", () => {
    const next = resizeTile(simpleSong(), "L", "a", 9999);
    const tile = tilesOf(next)[0];
    expect(tile.start + tile.length).toBe(3840);
  });
});

describe("removeTile", () => {
  it("해당 타일만 지운다", () => {
    const song = addTile(simpleSong(), "L", 2400);
    const next = removeTile(song, "L", "a");

    expect(tilesOf(next)).toHaveLength(1);
    expect(tilesOf(next)[0].start).toBe(2400);
  });

  it("없는 id면 곡이 그대로다", () => {
    const song = simpleSong();
    const next = removeTile(song, "L", "없음");
    expect(tilesOf(next)).toHaveLength(1);
  });
});

/** 드럼 라인 하나만 있는 1마디 곡. */
function drumSong(): Song {
  return {
    tempo: 120,
    timeSignature: [4, 4],
    lengthTicks: 1920,
    lines: [
      {
        id: "D",
        name: "드럼",
        kind: "drum",
        instrument: "drums",
        tiles: [
          { id: "k0", start: 0, length: 120, velocity: 0.9, notes: [DRUM_KICK] },
        ],
      },
    ],
  };
}

describe("setTileNotes / setTileVelocity", () => {
  it("음 목록을 바꾼다", () => {
    const next = setTileNotes(simpleSong(), "L", "a", [60, 63, 67]);
    expect(tilesOf(next)[0].notes).toEqual([60, 63, 67]);
  });

  it("빈 음 목록은 무시한다 — 소리도 안 나고 화면에도 안 보인다", () => {
    const next = setTileNotes(simpleSong(), "L", "a", []);
    expect(tilesOf(next)[0].notes).toEqual([62, 65]);
  });

  it("세기를 0..1로 제한한다", () => {
    expect(tilesOf(setTileVelocity(simpleSong(), "L", "a", 1.5))[0].velocity).toBe(1);
    expect(tilesOf(setTileVelocity(simpleSong(), "L", "a", -1))[0].velocity).toBe(0);
  });

  it("원본을 변형하지 않는다", () => {
    const song = simpleSong();
    setTileNotes(song, "L", "a", [72]);
    expect(song.lines[0].tiles[0].notes).toEqual([62, 65]);
  });
});

describe("toggleDrumCell", () => {
  it("빈 칸을 켜면 그 조각의 타일이 생긴다", () => {
    const next = toggleDrumCell(drumSong(), "D", 480, DRUM_HIHAT);
    const added = next.lines[0].tiles.find((t) => t.start === 480)!;

    expect(added.notes).toEqual([DRUM_HIHAT]);
    expect(added.length).toBe(120);
  });

  it("켜진 칸을 다시 누르면 꺼진다", () => {
    const next = toggleDrumCell(drumSong(), "D", 0, DRUM_KICK);
    expect(next.lines[0].tiles).toHaveLength(0);
  });

  it("같은 칸을 두 번 토글하면 원래 곡과 같아진다", () => {
    const song = drumSong();
    const twice = toggleDrumCell(
      toggleDrumCell(song, "D", 480, DRUM_HIHAT),
      "D",
      480,
      DRUM_HIHAT,
    );
    expect(twice.lines[0].tiles.map((t) => [t.start, t.notes[0]])).toEqual(
      song.lines[0].tiles.map((t) => [t.start, t.notes[0]]),
    );
  });

  it("다른 조각은 같은 칸에서 서로 영향을 주지 않는다", () => {
    const next = toggleDrumCell(drumSong(), "D", 0, DRUM_HIHAT);
    expect(next.lines[0].tiles).toHaveLength(2);
  });

  it("force=true는 켜기만 한다 — 이어 칠하기에서 깜빡이지 않는다", () => {
    const once = toggleDrumCell(drumSong(), "D", 0, DRUM_KICK, true);
    const twice = toggleDrumCell(once, "D", 0, DRUM_KICK, true);
    expect(twice.lines[0].tiles.filter((t) => t.start === 0)).toHaveLength(1);
  });

  it("force=false는 끄기만 한다", () => {
    const next = toggleDrumCell(drumSong(), "D", 480, DRUM_HIHAT, false);
    expect(next.lines[0].tiles).toHaveLength(1);
  });

  it("곡 끝을 넘는 칸은 만들지 않는다", () => {
    const next = toggleDrumCell(drumSong(), "D", 1920, DRUM_HIHAT);
    expect(next.lines[0].tiles).toHaveLength(1);
  });

  it("정렬 불변식을 유지한다", () => {
    const next = toggleDrumCell(
      toggleDrumCell(drumSong(), "D", 960, DRUM_HIHAT),
      "D",
      480,
      DRUM_KICK,
    );
    const starts = next.lines[0].tiles.map((t) => t.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
