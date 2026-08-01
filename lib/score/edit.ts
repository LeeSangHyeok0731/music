import type { InstrumentId, Song, Tile } from "./types";

/** 편집 격자. 16분음표. 드럼 격자와 같은 단위다. */
export const SNAP_TICKS = 120;

export const MIN_TILE_LENGTH = SNAP_TICKS;
export const DEFAULT_TILE_LENGTH = 480;
export const DEFAULT_VELOCITY = 0.7;

/** 가장 가까운 격자로 붙인다. 곡 앞으로는 나가지 않는다. */
export function snapToGrid(ticks: number): number {
  return Math.max(0, Math.round(ticks / SNAP_TICKS) * SNAP_TICKS);
}

/**
 * 곡 안에서 유일한 새 타일 id.
 *
 * crypto.randomUUID()는 순수하지 않다. tile-<숫자> 패턴에 맞는 id만 골라
 * 가장 큰 값 다음을 쓴다. fixture의 id(piano-0, hihat-3-7)는 이 패턴에
 * 맞지 않으므로 계산에 끼지 않고 충돌하지도 않는다.
 */
export function nextTileId(song: Song): string {
  let max = -1;
  for (const line of song.lines) {
    for (const tile of line.tiles) {
      const match = /^tile-(\d+)$/.exec(tile.id);
      if (match) {
        max = Math.max(max, Number(match[1]));
      }
    }
  }
  return `tile-${max + 1}`;
}

const DEFAULT_NOTES: Record<InstrumentId, number[]> = {
  piano: [60, 64, 67],
  guitar: [62, 66, 69],
  bass: [36],
  // 드럼 타일은 격자 토글로만 만든다 — 기본 타일이라는 개념이 없다
  drums: [],
};

export function defaultNotesFor(instrument: InstrumentId): number[] {
  return [...DEFAULT_NOTES[instrument]];
}

/** 라인 하나만 갈아끼운 새 Song. 나머지 라인은 참조를 그대로 넘긴다. */
function replaceLine(song: Song, lineId: string, tiles: Tile[]): Song {
  return {
    ...song,
    lines: song.lines.map((line) =>
      line.id === lineId
        ? { ...line, tiles: [...tiles].sort((a, b) => a.start - b.start) }
        : line,
    ),
  };
}

function lineOf(song: Song, lineId: string) {
  return song.lines.find((line) => line.id === lineId);
}

/** start + length가 곡 끝을 넘지 않도록 start를 뒤로 밀지 않고 앞으로 당긴다. */
function clampStart(start: number, length: number, lengthTicks: number): number {
  return Math.max(0, Math.min(start, lengthTicks - length));
}

/**
 * 음정 라인에 타일을 만든다. 드럼 라인에는 쓰지 않는다 — 드럼은
 * toggleDrumCell로만 만든다.
 *
 * 음정 라인에는 세로 축이 없어 클릭 위치가 음높이를 알려주지 않는다.
 * 그래서 왼쪽의 가장 가까운 타일을 복제한다. 오른쪽은 보지 않는다 —
 * 보면 라인 맨 앞에 찍을 때마다 뒤쪽 내용이 딸려 와서 "왼쪽에서
 * 오른쪽으로 깔아나간다"는 예측이 깨진다.
 */
export function addTile(song: Song, lineId: string, at: number): Song {
  const line = lineOf(song, lineId);
  if (!line) return song;

  const start = snapToGrid(at);

  let source: Tile | null = null;
  for (const tile of line.tiles) {
    if (tile.start < start) source = tile;
    else break; // tiles는 start 오름차순이다
  }

  const length = source ? source.length : DEFAULT_TILE_LENGTH;
  const created: Tile = {
    id: nextTileId(song),
    start: clampStart(start, length, song.lengthTicks),
    length,
    velocity: source ? source.velocity : DEFAULT_VELOCITY,
    notes: source ? [...source.notes] : defaultNotesFor(line.instrument),
  };

  return replaceLine(song, lineId, [...line.tiles, created]);
}

export function moveTile(
  song: Song,
  lineId: string,
  tileId: string,
  startTicks: number,
): Song {
  const line = lineOf(song, lineId);
  if (!line) return song;

  return replaceLine(
    song,
    lineId,
    line.tiles.map((tile) =>
      tile.id === tileId
        ? {
            ...tile,
            start: clampStart(
              snapToGrid(startTicks),
              tile.length,
              song.lengthTicks,
            ),
          }
        : tile,
    ),
  );
}

export function resizeTile(
  song: Song,
  lineId: string,
  tileId: string,
  lengthTicks: number,
): Song {
  const line = lineOf(song, lineId);
  if (!line) return song;

  return replaceLine(
    song,
    lineId,
    line.tiles.map((tile) => {
      if (tile.id !== tileId) return tile;
      const snapped = Math.max(MIN_TILE_LENGTH, snapToGrid(lengthTicks));
      return {
        ...tile,
        length: Math.min(snapped, song.lengthTicks - tile.start),
      };
    }),
  );
}

export function removeTile(song: Song, lineId: string, tileId: string): Song {
  const line = lineOf(song, lineId);
  if (!line) return song;

  return replaceLine(
    song,
    lineId,
    line.tiles.filter((tile) => tile.id !== tileId),
  );
}
