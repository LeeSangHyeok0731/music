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

/**
 * 라인 하나만 갈아끼운 새 Song. 나머지 라인은 참조를 그대로 넘긴다.
 *
 * 결과가 지금과 같으면 **원본 Song을 그대로 돌려준다.** 호출부(실행취소
 * 히스토리)가 참조 비교로 "아무 일도 없었다"를 판단하기 때문이다. 이게 없으면
 * 타일을 끌었다가 같은 격자에 도로 놓는 것만으로 히스토리에 변화 없는 항목이
 * 쌓이고, Ctrl+Z를 눌러도 화면이 안 바뀐다.
 */
function replaceLine(song: Song, lineId: string, tiles: Tile[]): Song {
  const current = song.lines.find((line) => line.id === lineId);
  const sorted = [...tiles].sort((a, b) => a.start - b.start);

  if (
    current &&
    sorted.length === current.tiles.length &&
    sorted.every((tile, i) => tile === current.tiles[i])
  ) {
    return song;
  }

  return {
    ...song,
    lines: song.lines.map((line) =>
      line.id === lineId ? { ...line, tiles: sorted } : line,
    ),
  };
}

function lineOf(song: Song, lineId: string) {
  return song.lines.find((line) => line.id === lineId);
}

/**
 * start + length가 곡 끝을 넘지 않도록 start를 뒤로 밀지 않고 앞으로 당긴다.
 *
 * 전제: `length <= lengthTicks`. 곡보다 긴 타일은 어디에 놓아도 곡 안에
 * 들어가지 않으므로 여기서 해결할 수 없다 — 길이를 만드는 쪽에서 막는다.
 */
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

  // 드럼 라인은 거부한다. 드럼에는 기본 음이 없어서(defaultNotesFor가 빈
  // 배열) 여기서 만들면 notes가 비어 있는 유령 타일이 생긴다. 소리도 안
  // 나고 화면에도 안 보이는데, toggleDrumCell은 notes[0]으로 칸을 찾으므로
  // 지울 수도 없다.
  if (line.kind === "drum") return song;

  const start = snapToGrid(at);

  let source: Tile | null = null;
  for (const tile of line.tiles) {
    if (tile.start < start) source = tile;
    else break; // tiles는 start 오름차순이다
  }

  // 곡보다 긴 타일은 어디에 놓아도 곡 안에 들어가지 않는다. clampStart가
  // 해결할 수 없는 경우라 길이를 만드는 여기서 막는다.
  const length = Math.min(
    source ? source.length : DEFAULT_TILE_LENGTH,
    song.lengthTicks,
  );
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
    line.tiles.map((tile) => {
      if (tile.id !== tileId) return tile;
      const start = clampStart(
        snapToGrid(startTicks),
        tile.length,
        song.lengthTicks,
      );
      // 값이 같으면 같은 객체를 돌려준다 — replaceLine이 이걸로 "변화 없음"을
      // 판단하고, 실행취소 히스토리가 빈 항목으로 차는 것을 막는다.
      return start === tile.start ? tile : { ...tile, start };
    }),
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
      // 두 클램프의 순서가 중요하다. 곡 끝을 넘지 않는 쪽을 마지막에 두어
      // 그것이 이긴다 — 스케줄러와 렌더러가 타일이 곡 안에 있다고 전제한다.
      //
      // 최소 길이보다 짧아질 걱정은 없다. 이 모듈의 모든 함수가
      // start <= lengthTicks - length를 지키므로 어떤 타일이든
      // lengthTicks - start >= length >= MIN_TILE_LENGTH가 성립한다.
      const snapped = Math.max(MIN_TILE_LENGTH, snapToGrid(lengthTicks));
      const length = Math.min(snapped, song.lengthTicks - tile.start);
      return length === tile.length ? tile : { ...tile, length };
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

/** 음이 하나도 없는 타일은 소리도 안 나고 화면에도 안 보인다 — 거부한다. */
export function setTileNotes(
  song: Song,
  lineId: string,
  tileId: string,
  notes: number[],
): Song {
  if (notes.length === 0) return song;

  const line = lineOf(song, lineId);
  if (!line) return song;

  return replaceLine(
    song,
    lineId,
    line.tiles.map((tile) => {
      if (tile.id !== tileId) return tile;
      const same =
        tile.notes.length === notes.length &&
        tile.notes.every((note, i) => note === notes[i]);
      return same ? tile : { ...tile, notes: [...notes] };
    }),
  );
}

export function setTileVelocity(
  song: Song,
  lineId: string,
  tileId: string,
  velocity: number,
): Song {
  const line = lineOf(song, lineId);
  if (!line) return song;

  const clamped = Math.max(0, Math.min(1, velocity));

  return replaceLine(
    song,
    lineId,
    line.tiles.map((tile) =>
      tile.id === tileId && tile.velocity !== clamped
        ? { ...tile, velocity: clamped }
        : tile,
    ),
  );
}

/**
 * 드럼 격자 한 칸을 켜거나 끈다.
 *
 * @param force 생략하면 토글. true면 켜기만, false면 끄기만 한다.
 *   드래그로 이어 칠할 때 토글이면 포인터가 왔다갔다할 때 깜빡인다.
 */
export function toggleDrumCell(
  song: Song,
  lineId: string,
  startTicks: number,
  piece: number,
  force?: boolean,
): Song {
  const line = lineOf(song, lineId);
  if (!line) return song;

  const start = snapToGrid(startTicks);
  if (start + SNAP_TICKS > song.lengthTicks) return song;

  const existing = line.tiles.find((tile) => isDrumCellTile(tile, start, piece));
  const shouldBeOn = force ?? existing === undefined;

  if (shouldBeOn && existing) return song;
  if (!shouldBeOn && !existing) return song;

  if (shouldBeOn) {
    return replaceLine(song, lineId, [
      ...line.tiles,
      {
        id: nextTileId(song),
        start,
        length: SNAP_TICKS,
        velocity: DEFAULT_VELOCITY,
        notes: [piece],
      },
    ]);
  }

  return replaceLine(
    song,
    lineId,
    line.tiles.filter((tile) => tile.id !== existing!.id),
  );
}

/** 드럼 격자에서 칠할 칸 하나. */
export type DrumCell = { start: number; piece: number };

/**
 * "격자 칸 하나 = 타일 하나 = 노트 하나"라는 드럼 라인의 전제를 이 함수 하나에
 * 담는다. toggleDrumCell/toggleDrumCells와 DrumGrid의 on/off 판정이 각자
 * 이 조건식을 따로 들고 있었다 — 그 전제가 바뀌면(예: 한 칸에 여러 음) 두
 * 곳이 같이 안 바뀌는 순간 격자 표시와 실제 토글 결과가 어긋난다.
 */
export function isDrumCellTile(
  tile: Tile,
  start: number,
  piece: number,
): boolean {
  return tile.start === start && tile.notes[0] === piece;
}

/**
 * 드럼 칸 여러 개를 한 번에 켜거나 끈다. 이어 칠하기의 커밋 단위다.
 *
 * `toggleDrumCell`을 칸마다 부르면 스트로크 하나가 실행취소 히스토리를
 * 십수 칸씩 잡아먹는다. 하이햇 한 마디만 칠해도 16칸이라, 세 번 칠하면
 * 이전 편집이 전부 밀려나고 되돌리려면 Ctrl+Z를 열여섯 번 눌러야 한다.
 * 드래그 중에는 미리보기만 하고 pointerup에서 이 함수로 한 번 커밋한다 —
 * 타일 드래그가 같은 이유로 그렇게 한다.
 *
 * @param on true면 켜기만, false면 끄기만. 스트로크 전체가 한 방향이다.
 */
export function toggleDrumCells(
  song: Song,
  lineId: string,
  cells: DrumCell[],
  on: boolean,
): Song {
  const line = lineOf(song, lineId);
  if (!line) return song;

  let tiles = line.tiles;
  let changed = false;
  // 한 스트로크 안에서 id가 겹치지 않도록 이어서 발급한다. nextTileId는
  // 곡을 훑어 최댓값을 찾는데, 아직 커밋 전이라 곡에는 반영돼 있지 않다.
  let nextId = Number(nextTileId(song).slice("tile-".length));

  for (const cell of cells) {
    // 스냅 전에 거른다. snapToGrid가 음수를 0으로 클램프하므로, 스냅 후에
    // 검사하면 격자 왼쪽 밖을 지나간 포인터가 첫 칸을 칠하게 된다.
    if (cell.start < 0) continue;

    const start = snapToGrid(cell.start);
    if (start + SNAP_TICKS > song.lengthTicks) continue;

    const existing = tiles.find((tile) =>
      isDrumCellTile(tile, start, cell.piece),
    );

    if (on && !existing) {
      tiles = [
        ...tiles,
        {
          id: `tile-${nextId++}`,
          start,
          length: SNAP_TICKS,
          velocity: DEFAULT_VELOCITY,
          notes: [cell.piece],
        },
      ];
      changed = true;
    } else if (!on && existing) {
      tiles = tiles.filter((tile) => tile.id !== existing.id);
      changed = true;
    }
  }

  if (!changed) return song;
  return replaceLine(song, lineId, tiles);
}
