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

export { replaceLine as __replaceLine };
