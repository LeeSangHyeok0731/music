# 타일 편집 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 타임라인에서 타일을 찍고 옮기고 늘리고 지워서 실제로 곡을 만들 수 있게 한다.

**Architecture:** 편집 로직은 `lib/score/edit.ts`의 `Song → Song` 순수 함수로 두고 정렬 불변식을 그곳에서만 지킨다. `StudioProvider`가 곡을 `useState`로 소유하고 편집 핸들러와 실행취소 히스토리를 노출한다. 드래그 중에는 곡 데이터를 건드리지 않고 DOM만 갱신하다가 `pointerup`에서 한 번 커밋한다.

**Tech Stack:** Next.js 16.2.12 (App Router), React 19.2.4, TypeScript 5, Tailwind CSS 4, Vitest

설계 문서: `docs/superpowers/specs/2026-08-01-tile-editing-design.md`

## Global Constraints

- 패키지 매니저는 **pnpm**이다. `npm install` / `yarn`을 쓰지 않는다.
- `lib/score/`는 Web Audio도 React도 import하지 않는다. `lib/audio/`는 React를 import하지 않는다.
- `components/`는 `lib/audio/`를 직접 폴링하지 않는다. `state/StudioProvider`가 노출하는 것만 읽는다.
- 임포트는 `@/` alias(저장소 루트 기준)로 해결한다.
- **모든 편집 함수는 반환 전에 해당 라인의 `tiles`를 `start` 오름차순으로 정렬한다.** 이 불변식이 깨지면 스케줄러가 커서로 전진하다 노트를 조용히 누락시킨다.
- **원본 `Song`을 제자리에서 변형하지 않는다.** 바뀐 라인만 새 객체로 만들고 나머지는 참조를 그대로 넘긴다.
- **드래그 중에는 곡 데이터를 커밋하지 않는다.** 미리보기는 DOM에 직접 쓰고 `pointerup`에서 한 번만 `setSong`을 부른다.
- 재생 중에는 편집이 비활성이다.
- `use client`는 훅이나 브라우저 API를 쓰는 모든 파일에 붙인다.
- 상수: `SNAP_TICKS = 120`(16분음표), 기본 타일 길이 `480`틱, 기본 세기 `0.7`, 히스토리 상한 `50`, 최소 타일 길이 `SNAP_TICKS`.
- 기본 타일 음: piano `[60, 64, 67]`, guitar `[62, 66, 69]`, bass `[36]`. 드럼은 기본 타일이 없다.
- 경계: `start >= 0`, `start + length <= song.lengthTicks`. 넘으면 거부가 아니라 **클램프**한다. 겹침은 허용한다.
- 커밋 메시지는 Conventional Commit 형식에 한국어 설명. 스코프: `score` / `state` / `editor` / `audio` / `docs`.

---

## File Structure

**생성**

```text
lib/score/edit.ts               편집 순수 함수, 스냅, id 발급, 기본 타일
lib/score/edit.test.ts
state/useSongHistory.ts         실행취소 훅 + 순수 헬퍼
state/useSongHistory.test.ts
components/timeline/useTileDrag.ts   포인터 드래그(이동/길이) 훅
components/timeline/TilePopover.tsx  타일 설정 팝오버
```

**수정**

```text
vitest.config.mts                    include에 state/**/*.test.ts 추가
lib/audio/engine.ts                  setSong 추가
lib/score/notes.ts                   NOTE_CHOICES 추가 (팝오버 드롭다운용)
components/timeline/layout.ts        pxToTick 추가
state/StudioProvider.tsx             song 상태화, 선택, 편집 핸들러, 히스토리
components/timeline/Timeline.tsx     편집 props 배선, 키보드 핸들러
components/timeline/TileLine.tsx     클릭·드래그·선택 표시
components/timeline/DrumGrid.tsx     칸 토글, 이어 칠하기
AGENTS.md                            "현재 상태" 갱신 (Task 11)
.claude/rules/ui-conventions.md      인터랙션 절 갱신 (Task 11)
```

---

## Task 1: 편집 기반 — 스냅, id 발급, 기본 타일

**Files:**
- Create: `lib/score/edit.ts`
- Test: `lib/score/edit.test.ts`

**Interfaces:**
- Consumes: `lib/score/types.ts`의 `Song`, `Line`, `Tile`, `InstrumentId`
- Produces:
  - `SNAP_TICKS = 120`
  - `MIN_TILE_LENGTH = SNAP_TICKS`
  - `DEFAULT_TILE_LENGTH = 480`
  - `DEFAULT_VELOCITY = 0.7`
  - `snapToGrid(ticks: number): number`
  - `nextTileId(song: Song): string`
  - `defaultNotesFor(instrument: InstrumentId): number[]`

- [ ] **Step 1: 실패하는 테스트 작성 — `lib/score/edit.test.ts`**

```ts
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "@/lib/score/edit"`

- [ ] **Step 3: `lib/score/edit.ts` 작성**

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS — 기존 64개 + 이번 테스트

- [ ] **Step 5: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add lib/score/edit.ts lib/score/edit.test.ts
git commit -m "feat(score): 편집 기반 상수와 스냅·id 발급 추가"
```

---

## Task 2: 음정 라인 편집 함수

**Files:**
- Modify: `lib/score/edit.ts`
- Test: `lib/score/edit.test.ts`

**Interfaces:**
- Consumes: Task 1의 `SNAP_TICKS`, `MIN_TILE_LENGTH`, `DEFAULT_TILE_LENGTH`, `DEFAULT_VELOCITY`, `snapToGrid`, `nextTileId`, `defaultNotesFor`, `__replaceLine`
- Produces:
  - `addTile(song: Song, lineId: string, at: number): Song`
  - `moveTile(song: Song, lineId: string, tileId: string, startTicks: number): Song`
  - `resizeTile(song: Song, lineId: string, tileId: string, lengthTicks: number): Song`
  - `removeTile(song: Song, lineId: string, tileId: string): Song`

- [ ] **Step 1: 실패하는 테스트를 `lib/score/edit.test.ts`에 추가**

```ts
import {
  addTile,
  moveTile,
  removeTile,
  resizeTile,
} from "@/lib/score/edit";
import type { Song } from "@/lib/score/types";

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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test`
Expected: FAIL — `addTile is not a function` 계열 오류

- [ ] **Step 3: `lib/score/edit.ts`에 구현 추가**

파일 끝의 `export { replaceLine as __replaceLine };` 줄을 지우고 아래를 덧붙인다.

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add lib/score/edit.ts lib/score/edit.test.ts
git commit -m "feat(score): 음정 라인 타일 생성·이동·길이·삭제 추가"
```

---

## Task 3: 타일 속성 편집과 드럼 격자 토글

**Files:**
- Modify: `lib/score/edit.ts`
- Test: `lib/score/edit.test.ts`

**Interfaces:**
- Consumes: Task 1~2의 전부
- Produces:
  - `setTileNotes(song: Song, lineId: string, tileId: string, notes: number[]): Song`
  - `setTileVelocity(song: Song, lineId: string, tileId: string, velocity: number): Song`
  - `toggleDrumCell(song: Song, lineId: string, startTicks: number, piece: number, force?: boolean): Song`

`force`는 드래그로 이어 칠할 때 쓴다. `true`면 켜기만, `false`면 끄기만, 생략하면 토글이다. 지나가며 토글하면 포인터가 왔다갔다할 때 깜빡인다.

- [ ] **Step 1: 실패하는 테스트를 `lib/score/edit.test.ts`에 추가**

```ts
import {
  setTileNotes,
  setTileVelocity,
  toggleDrumCell,
} from "@/lib/score/edit";
import { DRUM_HIHAT, DRUM_KICK } from "@/lib/score/types";

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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test`
Expected: FAIL — `setTileNotes is not a function` 계열 오류

- [ ] **Step 3: `lib/score/edit.ts`에 구현 추가**

```ts
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
    line.tiles.map((tile) =>
      tile.id === tileId ? { ...tile, notes: [...notes] } : tile,
    ),
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
      tile.id === tileId ? { ...tile, velocity: clamped } : tile,
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

  const existing = line.tiles.find(
    (tile) => tile.start === start && tile.notes[0] === piece,
  );
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add lib/score/edit.ts lib/score/edit.test.ts
git commit -m "feat(score): 타일 속성 편집과 드럼 격자 토글 추가"
```

---

## Task 4: 실행취소 히스토리

**Files:**
- Create: `state/useSongHistory.ts`
- Test: `state/useSongHistory.test.ts`
- Modify: `vitest.config.mts`

**Interfaces:**
- Consumes: `lib/score/types.ts`의 `Song`
- Produces:
  - `HISTORY_LIMIT = 50`
  - `pushHistory(past: Song[], song: Song, limit?: number): Song[]`
  - `useSongHistory(initial: Song)` → `{ song, commitWith(updater: (song: Song) => Song): void, undo(): Song | null, canUndo: boolean }`

`commitWith`는 현재 곡에 updater를 적용해 교체하고 이전 곡을 히스토리에 쌓는다. **곡이 아니라 updater를 받는 것이 핵심이다** — 호출부가 현재 곡을 클로저에 담으면 편집마다 핸들러의 정체성이 바뀌고, 그러면 타임라인의 memo가 매번 풀려 한 라인만 고쳐도 모든 라인이 다시 그려진다.

`undo`는 되돌린 곡을 반환한다(없으면 `null`) — 호출부가 선택 검사를 해야 하기 때문이다.

- [ ] **Step 1: `vitest.config.mts`의 include에 `state/` 추가**

```ts
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "state/**/*.test.ts"],
  },
```

- [ ] **Step 2: 실패하는 테스트 작성 — `state/useSongHistory.test.ts`**

```ts
import { describe, expect, it } from "vitest";

import { HISTORY_LIMIT, pushHistory } from "@/state/useSongHistory";
import { buildDemoSong } from "@/lib/score/fixture";
import type { Song } from "@/lib/score/types";

function songWithTempo(tempo: number): Song {
  return { ...buildDemoSong(), tempo };
}

describe("pushHistory", () => {
  it("뒤에 쌓는다", () => {
    const a = songWithTempo(100);
    const b = songWithTempo(101);
    const past = pushHistory(pushHistory([], a), b);

    expect(past.map((s) => s.tempo)).toEqual([100, 101]);
  });

  it("상한을 넘으면 오래된 것부터 버린다", () => {
    let past: Song[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      past = pushHistory(past, songWithTempo(i));
    }

    expect(past).toHaveLength(HISTORY_LIMIT);
    // 가장 오래된 10개가 밀려났으므로 첫 항목은 tempo 10이다
    expect(past[0].tempo).toBe(10);
    expect(past.at(-1)!.tempo).toBe(HISTORY_LIMIT + 9);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const past: Song[] = [];
    pushHistory(past, songWithTempo(1));
    expect(past).toHaveLength(0);
  });

  it("상한은 50이다", () => {
    expect(HISTORY_LIMIT).toBe(50);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "@/state/useSongHistory"`

- [ ] **Step 4: `state/useSongHistory.ts` 작성**

```ts
"use client";

import { useCallback, useState } from "react";

import type { Song } from "@/lib/score/types";

/**
 * 곡 하나가 수백 타일이라 스냅샷 자체는 싸지만, 무한히 쌓을 이유도 없다.
 */
export const HISTORY_LIMIT = 50;

/** 뒤에 쌓고 상한을 넘으면 앞에서 버린다. 원본 배열은 건드리지 않는다. */
export function pushHistory(
  past: Song[],
  song: Song,
  limit: number = HISTORY_LIMIT,
): Song[] {
  const next = [...past, song];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export type SongHistory = {
  song: Song;
  /**
   * 현재 곡에 updater를 적용해 교체하고, 이전 곡을 히스토리에 쌓는다.
   *
   * 곡을 인자로 받지 않고 updater를 받는 이유: 호출부가 현재 곡을 클로저에
   * 담으면 편집마다 핸들러의 정체성이 바뀌고, 그러면 타임라인의 memo가
   * 매번 풀려 한 라인만 고쳐도 모든 라인이 다시 그려진다.
   */
  commitWith: (updater: (song: Song) => Song) => void;
  /** 되돌린 곡을 반환한다. 되돌릴 게 없으면 null. */
  undo: () => Song | null;
  canUndo: boolean;
};

export function useSongHistory(initial: Song): SongHistory {
  const [song, setSong] = useState(initial);
  const [past, setPast] = useState<Song[]>([]);

  // 상태를 ref로 미러링한다. setState 업데이터 안에서 값을 꺼내 반환하면
  // StrictMode에서 업데이터가 두 번 돌고 배치 때문에 시점도 보장되지 않는다.
  // ref로 읽으면 결정적이고, 콜백 의존성도 비어 정체성이 안정적이다.
  const songRef = useRef(song);
  const pastRef = useRef<Song[]>([]);

  const commitWith = useCallback((updater: (song: Song) => Song) => {
    const next = updater(songRef.current);
    if (next === songRef.current) return; // 편집 함수가 곡을 그대로 돌려준 경우

    pastRef.current = pushHistory(pastRef.current, songRef.current);
    songRef.current = next;
    setPast(pastRef.current);
    setSong(next);
  }, []);

  const undo = useCallback((): Song | null => {
    const prev = pastRef.current;
    if (prev.length === 0) return null;

    const restored = prev[prev.length - 1];
    pastRef.current = prev.slice(0, -1);
    songRef.current = restored;
    setPast(pastRef.current);
    setSong(restored);
    return restored;
  }, []);

  return { song, commitWith, undo, canUndo: past.length > 0 };
}
```

`useRef`를 import에 추가한다: `import { useCallback, useRef, useState } from "react";`

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 6: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음. `set-state-in-effect` 룰은 이 파일에 해당하지 않는다(effect가 없다).

- [ ] **Step 7: 커밋**

```bash
git add vitest.config.mts state/useSongHistory.ts state/useSongHistory.test.ts
git commit -m "feat(state): 실행취소 히스토리 훅 추가"
```

---

## Task 5: StudioProvider에 곡 상태와 편집 배선

**Files:**
- Modify: `lib/audio/engine.ts`
- Modify: `state/StudioProvider.tsx`

**Interfaces:**
- Consumes: Task 1~3의 편집 함수 전부, Task 4의 `useSongHistory`
- Produces:
  - `Engine.setSong(song: Song): void`
  - `export type TileRef = { lineId: string; tileId: string }`
  - `export type TileEditHandlers = { createAt(lineId, tick): void; move(lineId, tileId, startTicks): void; resize(lineId, tileId, lengthTicks): void; remove(lineId, tileId): void; setNotes(lineId, tileId, notes): void; setVelocity(lineId, tileId, velocity): void; toggleDrum(lineId, startTicks, piece, force?): void }`
  - `StudioValue`에 추가: `selection: TileRef | null`, `select(ref: TileRef | null): void`, `edit: TileEditHandlers`, `undo(): void`, `canUndo: boolean`, `editable: boolean`

`editable`은 `!isPlaying`이다. 컴포넌트가 재생 상태를 직접 해석하지 않도록 이름을 따로 준다.

- [ ] **Step 1: `lib/audio/engine.ts`에 `setSong` 추가**

`private readonly song: Song;`을 `private song: Song;`으로 바꾸고, `dispose()` 바로 위에 아래 메서드를 넣는다.

```ts
  /**
   * 곡을 갈아끼운다. 편집은 정지 중에만 일어나므로 다음 play()부터 반영된다.
   * 재생 중에 부르면 이미 예약된 구간과 새 곡이 어긋나므로 무시한다.
   */
  setSong(song: Song): void {
    if (this.playing) return;
    this.song = song;
    this.bpm = song.tempo;
  }
```

- [ ] **Step 2: 정적 검사**

Run: `pnpm check-types`
Expected: 오류 없음

- [ ] **Step 3: `state/StudioProvider.tsx` 수정 — import와 타입**

import 블록에 추가한다.

```ts
import {
  addTile,
  moveTile,
  removeTile,
  resizeTile,
  setTileNotes,
  setTileVelocity,
  toggleDrumCell,
} from "@/lib/score/edit";
import { useSongHistory } from "@/state/useSongHistory";
```

`StudioValue` 정의 위에 타입을 추가한다.

```ts
export type TileRef = { lineId: string; tileId: string };

export type TileEditHandlers = {
  createAt: (lineId: string, tick: number) => void;
  move: (lineId: string, tileId: string, startTicks: number) => void;
  resize: (lineId: string, tileId: string, lengthTicks: number) => void;
  remove: (lineId: string, tileId: string) => void;
  setNotes: (lineId: string, tileId: string, notes: number[]) => void;
  setVelocity: (lineId: string, tileId: string, velocity: number) => void;
  toggleDrum: (
    lineId: string,
    startTicks: number,
    piece: number,
    force?: boolean,
  ) => void;
};
```

`StudioValue`에 다섯 줄을 더한다.

```ts
  selection: TileRef | null;
  select: (ref: TileRef | null) => void;
  edit: TileEditHandlers;
  undo: () => void;
  canUndo: boolean;
  editable: boolean;
```

- [ ] **Step 4: `StudioProvider` 본문 수정 — 곡을 상태로**

`const song = useMemo(() => buildDemoSong(), []);` 를 아래로 교체한다.

```ts
  const initialSong = useMemo(() => buildDemoSong(), []);
  const {
    song,
    commitWith,
    undo: undoSong,
    canUndo,
  } = useSongHistory(initialSong);
  const [selection, setSelection] = useState<TileRef | null>(null);

  // 편집 핸들러가 isPlaying을 클로저에 담으면 재생/정지마다 정체성이 바뀌어
  // 타임라인 memo가 풀린다. ref로 읽는다.
  const playingRef = useRef(false);
  playingRef.current = isPlaying;
```

`getEngine`의 의존성 `[song]`을 `[initialSong]`으로 바꾸고 `new Engine(song)`을 `new Engine(initialSong)`으로 바꾼다. 엔진은 생성 시점의 곡으로 시작하고 이후에는 `setSong`으로 받는다.

곡이 바뀌면 엔진에 넘기는 effect를 `play` 정의 앞에 추가한다.

```ts
  // 편집은 정지 중에만 일어나므로 다음 play()부터 반영된다.
  useEffect(() => {
    engineRef.current?.setSong(song);
  }, [song]);
```

- [ ] **Step 5: 편집 핸들러와 실행취소 추가**

`currentTick` 정의 아래에 넣는다.

```ts
  const editable = !isPlaying;

  const select = useCallback((ref: TileRef | null) => {
    setSelection(ref);
  }, []);

  // 각 핸들러는 편집 함수를 updater로 넘긴다. 현재 곡을 클로저에 담지 않으므로
  // 이 객체의 정체성이 편집마다 바뀌지 않고, 타임라인 memo가 유지된다.
  // 재생 중에는 아무것도 하지 않는다.
  const edit = useMemo<TileEditHandlers>(
    () => ({
      createAt: (lineId, tick) => {
        if (playingRef.current) return;
        commitWith((s) => addTile(s, lineId, tick));
      },
      move: (lineId, tileId, startTicks) => {
        if (playingRef.current) return;
        commitWith((s) => moveTile(s, lineId, tileId, startTicks));
      },
      resize: (lineId, tileId, lengthTicks) => {
        if (playingRef.current) return;
        commitWith((s) => resizeTile(s, lineId, tileId, lengthTicks));
      },
      remove: (lineId, tileId) => {
        if (playingRef.current) return;
        commitWith((s) => removeTile(s, lineId, tileId));
        setSelection((prev) => (prev && prev.tileId === tileId ? null : prev));
      },
      setNotes: (lineId, tileId, notes) => {
        if (playingRef.current) return;
        commitWith((s) => setTileNotes(s, lineId, tileId, notes));
      },
      setVelocity: (lineId, tileId, velocity) => {
        if (playingRef.current) return;
        commitWith((s) => setTileVelocity(s, lineId, tileId, velocity));
      },
      toggleDrum: (lineId, startTicks, piece, force) => {
        if (playingRef.current) return;
        commitWith((s) => toggleDrumCell(s, lineId, startTicks, piece, force));
      },
    }),
    [commitWith],
  );

  const undo = useCallback(() => {
    const restored = undoSong();
    if (!restored) return;
    // 생성을 되돌리면 선택된 타일이 사라진다. 그대로 두면 존재하지 않는
    // 타일의 팝오버가 떠 있게 된다.
    setSelection((prev) => {
      if (!prev) return prev;
      const line = restored.lines.find((l) => l.id === prev.lineId);
      const exists = line?.tiles.some((t) => t.id === prev.tileId);
      return exists ? prev : null;
    });
  }, [undoSong]);
```

- [ ] **Step 6: context value에 새 항목 연결**

`value`의 `useMemo` 객체와 의존성 배열 양쪽에 `selection`, `select`, `edit`, `undo`, `canUndo`, `editable`을 추가한다.

- [ ] **Step 7: 검증**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: 전부 성공

- [ ] **Step 8: 커밋**

```bash
git add lib/audio/engine.ts state/StudioProvider.tsx
git commit -m "feat(state): 곡을 상태로 바꾸고 편집 핸들러와 실행취소를 배선"
```

---

## Task 6: 타일 클릭·선택·드래그

**Files:**
- Modify: `components/timeline/layout.ts`
- Create: `components/timeline/useTileDrag.ts`
- Modify: `components/timeline/TileLine.tsx`
- Modify: `components/timeline/Timeline.tsx`

**Interfaces:**
- Consumes: Task 5의 `TileRef`, `TileEditHandlers`, `editable`, `selection`, `select`
- Produces:
  - `pxToTick(px: number, perBar: number): number` (layout.ts)
  - `useTileDrag(...)` 훅
  - `TileLine`의 새 props: `{ line, perBar, editable, selectedTileId, edit, onSelect }`

- [ ] **Step 1: `components/timeline/layout.ts`에 `pxToTick` 추가**

```ts
/** tickToPx의 역함수. 드래그 거리를 음악적 시간으로 되돌린다. */
export function pxToTick(px: number, perBar: number): number {
  return (px / PX_PER_BAR) * perBar;
}
```

- [ ] **Step 2: `components/timeline/useTileDrag.ts` 작성**

```ts
"use client";

import { useCallback, useRef } from "react";

import { pxToTick } from "./layout";

export type DragKind = "move" | "resize";

type DragState = {
  kind: DragKind;
  tileId: string;
  startTick: number;
  lengthTick: number;
  originX: number;
  /** 드래그 시작 시점의 폭. offsetWidth를 매번 읽으면 값이 누적된다. */
  originWidth: number;
  element: HTMLElement;
};

/**
 * 타일 드래그. 드래그 중에는 곡 데이터를 건드리지 않고 DOM만 옮긴다.
 *
 * 매 pointermove마다 setSong을 부르면 곡 전체가 교체되고 실행취소
 * 히스토리에 수십 개가 쌓인다. 커밋은 pointerup에서 한 번뿐이다.
 */
export function useTileDrag({
  perBar,
  onCommitMove,
  onCommitResize,
}: {
  perBar: number;
  onCommitMove: (tileId: string, startTicks: number) => void;
  onCommitResize: (tileId: string, lengthTicks: number) => void;
}) {
  const drag = useRef<DragState | null>(null);

  const onPointerDown = useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      kind: DragKind,
      tileId: string,
      startTick: number,
      lengthTick: number,
    ) => {
      const element = event.currentTarget;
      // 포인터가 요소 밖으로 나가도 추적이 끊기지 않게 한다
      element.setPointerCapture(event.pointerId);
      drag.current = {
        kind,
        tileId,
        startTick,
        lengthTick,
        originX: event.clientX,
        originWidth: element.offsetWidth,
        element,
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state) return;

      const deltaPx = event.clientX - state.originX;

      if (state.kind === "move") {
        // transform만 바꾼다 — 레이아웃이 다시 계산되지 않는다
        state.element.style.transform = `translateX(${deltaPx}px)`;
      } else {
        // 시작 시점의 폭에서 계산한다. offsetWidth를 매번 읽으면 방금 쓴
        // 값을 다시 읽어 폭이 누적되며 폭주한다.
        state.element.style.width = `${Math.max(4, state.originWidth + deltaPx)}px`;
      }
    },
    [],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state) return;
      drag.current = null;

      const deltaTick = pxToTick(event.clientX - state.originX, perBar);

      // 미리보기를 되돌린다. 커밋된 곡이 새로 렌더되면서 제자리를 잡는다.
      state.element.style.transform = "";
      state.element.style.width = "";

      if (state.kind === "move") {
        onCommitMove(state.tileId, state.startTick + deltaTick);
      } else {
        onCommitResize(state.tileId, state.lengthTick + deltaTick);
      }
    },
    [perBar, onCommitMove, onCommitResize],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}
```

- [ ] **Step 3: `components/timeline/TileLine.tsx` 전체 교체**

```tsx
"use client";

import { memo } from "react";

import { midiToName } from "@/lib/score/notes";
import type { Line } from "@/lib/score/types";
import type { TileEditHandlers } from "@/state/StudioProvider";

import { PITCHED_LINE_HEIGHT, ROW_DIVIDER, pxToTick, tickToPx } from "./layout";
import { useTileDrag } from "./useTileDrag";

const COLORS: Record<string, string> = {
  piano: "bg-indigo-500/25 border-indigo-400/60 text-indigo-100",
  guitar: "bg-emerald-500/25 border-emerald-400/60 text-emerald-100",
  bass: "bg-amber-500/25 border-amber-400/60 text-amber-100",
  drums: "bg-rose-500/25 border-rose-400/60 text-rose-100",
};

const TILE_INSET = 6;
/** 오른쪽 끝 이 폭 안에서 누르면 길이 조절이다. */
const RESIZE_HANDLE_PX = 6;

function TileLineImpl({
  line,
  perBar,
  editable,
  selectedTileId,
  edit,
  onSelect,
}: {
  line: Line;
  perBar: number;
  editable: boolean;
  selectedTileId: string | null;
  edit: TileEditHandlers;
  onSelect: (tileId: string | null) => void;
}) {
  const color = COLORS[line.instrument] ?? COLORS.piano;

  const drag = useTileDrag({
    perBar,
    onCommitMove: (tileId, startTicks) =>
      edit.move(line.id, tileId, startTicks),
    onCommitResize: (tileId, lengthTicks) =>
      edit.resize(line.id, tileId, lengthTicks),
  });

  return (
    <div
      className="relative"
      style={{ height: PITCHED_LINE_HEIGHT, boxShadow: ROW_DIVIDER }}
      onPointerDown={(event) => {
        // 빈 칸을 눌렀을 때만 여기까지 온다 — 타일은 전파를 멈춘다
        if (!editable) return;
        const rect = event.currentTarget.getBoundingClientRect();
        edit.createAt(line.id, pxToTick(event.clientX - rect.left, perBar));
      }}
    >
      {line.tiles.map((tile) => {
        const selected = tile.id === selectedTileId;
        return (
          <div
            key={tile.id}
            className={`absolute flex items-center overflow-hidden rounded-md border px-1.5 font-mono text-[11px] leading-none whitespace-nowrap ${color} ${
              selected ? "ring-2 ring-amber-400" : ""
            } ${editable ? "cursor-grab" : ""}`}
            style={{
              left: tickToPx(tile.start, perBar),
              top: TILE_INSET,
              width: Math.max(tickToPx(tile.length, perBar) - 2, 4),
              height: PITCHED_LINE_HEIGHT - TILE_INSET * 2,
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (!editable) return;
              onSelect(tile.id);
              const rect = event.currentTarget.getBoundingClientRect();
              const kind =
                event.clientX >= rect.right - RESIZE_HANDLE_PX
                  ? "resize"
                  : "move";
              drag.onPointerDown(
                event,
                kind,
                tile.id,
                tile.start,
                tile.length,
              );
            }}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onContextMenu={(event) => {
              event.preventDefault();
              if (!editable) return;
              edit.remove(line.id, tile.id);
            }}
          >
            {tile.notes.map(midiToName).join(" ")}
          </div>
        );
      })}
    </div>
  );
}

// 재생 중엔 StudioProvider의 context value가 10Hz로 바뀌어 Timeline이
// 매번 리렌더된다. props가 그대로면 이 타일 div들을 다시 그릴 이유가
// 없으므로 memo로 끊는다 — 안 그러면 재생 중 매 리렌더가 스케줄러
// 타이머와 같은 메인 스레드를 잡아먹어 오디오가 튄다.
export const TileLine = memo(TileLineImpl);
```

- [ ] **Step 4: `components/timeline/Timeline.tsx`에서 새 props 전달**

`useStudio()` 구조분해에 `selection`, `select`, `edit`, `editable`을 추가하고, `TileLine` 호출을 아래로 바꾼다.

```tsx
              <TileLine
                key={line.id}
                line={line}
                perBar={perBar}
                editable={editable}
                selectedTileId={
                  selection && selection.lineId === line.id
                    ? selection.tileId
                    : null
                }
                edit={edit}
                onSelect={(tileId) =>
                  select(tileId ? { lineId: line.id, tileId } : null)
                }
              />
```

- [ ] **Step 5: 검증**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: 전부 성공

- [ ] **Step 6: 커밋**

```bash
git add components/timeline/layout.ts components/timeline/useTileDrag.ts components/timeline/TileLine.tsx components/timeline/Timeline.tsx
git commit -m "feat(editor): 타일 클릭·선택·드래그 편집 추가"
```

---

## Task 7: 드럼 격자 토글과 이어 칠하기

**Files:**
- Modify: `components/timeline/DrumGrid.tsx`
- Modify: `components/timeline/Timeline.tsx`

**Interfaces:**
- Consumes: Task 5의 `TileEditHandlers.toggleDrum`, `editable`; Task 6의 `pxToTick`
- Produces: `DrumGrid`의 새 props `{ line, perBar, editable, edit }`

- [ ] **Step 1: `components/timeline/DrumGrid.tsx` 전체 교체**

```tsx
"use client";

import { memo, useRef } from "react";

import { SNAP_TICKS } from "@/lib/score/edit";
import type { Line } from "@/lib/score/types";
import type { TileEditHandlers } from "@/state/StudioProvider";

import {
  DRUM_LINE_HEIGHT,
  DRUM_ROWS,
  DRUM_ROW_HEIGHT,
  PX_PER_BAR,
  ROW_DIVIDER,
  pxToTick,
  tickToPx,
} from "./layout";

/** 16분음표 격자. 배경은 CSS로, 켜진 칸만 DOM 노드로 그린다. */
function DrumGridImpl({
  line,
  perBar,
  editable,
  edit,
}: {
  line: Line;
  perBar: number;
  editable: boolean;
  edit: TileEditHandlers;
}) {
  const stepWidth = PX_PER_BAR / 16;
  // 드래그로 이어 칠할 때의 방향. 지나가며 토글하면 포인터가 왔다갔다할
  // 때 깜빡이므로, pointerdown에서 정한 방향만 적용한다.
  const paint = useRef<boolean | null>(null);

  function cellAt(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const tick = pxToTick(event.clientX - rect.left, perBar);
    const start = Math.floor(tick / SNAP_TICKS) * SNAP_TICKS;
    const row = Math.floor((event.clientY - rect.top) / DRUM_ROW_HEIGHT);
    const piece = DRUM_ROWS[row];
    return piece === undefined ? null : { start, piece };
  }

  return (
    <div
      className={`relative ${editable ? "cursor-pointer" : ""}`}
      style={{
        height: DRUM_LINE_HEIGHT,
        boxShadow: ROW_DIVIDER,
        backgroundImage: [
          `repeating-linear-gradient(to right, rgb(255 255 255 / 0.04) 0 1px, transparent 1px ${stepWidth}px)`,
          `repeating-linear-gradient(to bottom, rgb(255 255 255 / 0.06) 0 1px, transparent 1px ${DRUM_ROW_HEIGHT}px)`,
        ].join(","),
      }}
      onPointerDown={(event) => {
        if (!editable) return;
        const cell = cellAt(event);
        if (!cell) return;
        event.currentTarget.setPointerCapture(event.pointerId);

        const isOn = line.tiles.some(
          (tile) => tile.start === cell.start && tile.notes[0] === cell.piece,
        );
        paint.current = !isOn;
        edit.toggleDrum(line.id, cell.start, cell.piece, paint.current);
      }}
      onPointerMove={(event) => {
        if (paint.current === null) return;
        const cell = cellAt(event);
        if (!cell) return;
        edit.toggleDrum(line.id, cell.start, cell.piece, paint.current);
      }}
      onPointerUp={() => {
        paint.current = null;
      }}
    >
      {line.tiles.map((tile) => {
        // 첫 노트 하나만 보고 행을 정한다 — 격자는 한 칸 = 한 음을 전제한다.
        const row = DRUM_ROWS.indexOf(
          tile.notes[0] as (typeof DRUM_ROWS)[number],
        );
        if (row < 0) return null;

        return (
          <div
            key={tile.id}
            className="pointer-events-none absolute rounded-sm border border-rose-300/60 bg-rose-500/45"
            style={{
              left: tickToPx(tile.start, perBar) + 1,
              top: row * DRUM_ROW_HEIGHT + 5,
              width: Math.max(tickToPx(tile.length, perBar) - 2, 4),
              height: DRUM_ROW_HEIGHT - 10,
            }}
          />
        );
      })}
    </div>
  );
}

// TileLine과 같은 이유 — 재생 중 context value가 바뀔 때마다 이 격자를
// 다시 그리지 않도록 props가 그대로면 리렌더를 건너뛴다.
export const DrumGrid = memo(DrumGridImpl);
```

켜진 칸에 `pointer-events-none`을 준 이유는, 칸 위를 지날 때 포인터 이벤트가 격자 컨테이너로 계속 가야 이어 칠하기가 끊기지 않기 때문이다.

- [ ] **Step 2: `components/timeline/Timeline.tsx`에서 새 props 전달**

```tsx
              <DrumGrid
                key={line.id}
                line={line}
                perBar={perBar}
                editable={editable}
                edit={edit}
              />
```

- [ ] **Step 3: 검증**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: 전부 성공

- [ ] **Step 4: 커밋**

```bash
git add components/timeline/DrumGrid.tsx components/timeline/Timeline.tsx
git commit -m "feat(editor): 드럼 격자 토글과 이어 칠하기 추가"
```

---

## Task 8: 타일 설정 팝오버

**Files:**
- Modify: `lib/score/notes.ts`
- Create: `components/timeline/TilePopover.tsx`
- Modify: `components/timeline/Timeline.tsx`

**Interfaces:**
- Consumes: Task 5의 `selection`, `select`, `edit`; `midiToName`
- Produces:
  - `NOTE_CHOICES: number[]` (notes.ts) — C1(24)부터 C7(96)까지
  - `<TilePopover perBar={number} />`

- [ ] **Step 1: `lib/score/notes.ts`에 `NOTE_CHOICES` 추가**

```ts
/** 팝오버 드롭다운이 고를 수 있는 음. C1부터 C7까지. */
export const NOTE_CHOICES: number[] = Array.from(
  { length: 96 - 24 + 1 },
  (_, i) => 24 + i,
);
```

- [ ] **Step 2: `components/timeline/TilePopover.tsx` 작성**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { NOTE_CHOICES, midiToName } from "@/lib/score/notes";
import { useStudio } from "@/state/StudioProvider";

import { PITCHED_LINE_HEIGHT, RULER_HEIGHT, lineHeight, tickToPx } from "./layout";

const LENGTH_CHOICES: Array<{ label: string; ticks: number }> = [
  { label: "1/16", ticks: 120 },
  { label: "1/8", ticks: 240 },
  { label: "1/4", ticks: 480 },
  { label: "1/2", ticks: 960 },
  { label: "1마디", ticks: 1920 },
];

/**
 * 선택된 타일의 설정. 타일 아래에 뜨고, 아래 공간이 모자라면 위로 뒤집는다.
 * 드럼 타일에는 뜨지 않는다 — 격자 칸은 시작 시점과 길이가 이미 정해져 있다.
 */
export function TilePopover({ perBar }: { perBar: number }) {
  const { song, selection, select, edit } = useStudio();
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const line = selection
    ? song.lines.find((l) => l.id === selection.lineId)
    : undefined;
  const tile = line?.tiles.find((t) => t.id === selection?.tileId);
  const open = Boolean(selection && line && tile && line.kind === "pitched");

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") select(null);
    }
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        select(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    // 타일 클릭 자체가 이 핸들러를 즉시 부르지 않도록 캡처가 아닌 버블로 듣는다
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, select]);

  if (!open || !line || !tile || !selection) return null;

  // 이 라인의 위쪽 모서리가 스테이지에서 몇 px 아래인지
  let lineTop = RULER_HEIGHT;
  for (const l of song.lines) {
    if (l.id === line.id) break;
    lineTop += lineHeight(l.kind);
  }

  // 스테이지 아래쪽 라인이면 위로 뒤집는다. 아래에 뜨면 화면 밖으로 나간다.
  const stageHeight =
    RULER_HEIGHT +
    song.lines.reduce((sum, l) => sum + lineHeight(l.kind), 0);
  const flipUp = lineTop + PITCHED_LINE_HEIGHT > stageHeight - 160;

  return (
    <div
      ref={ref}
      className="absolute z-20 w-[190px] rounded-md border border-white/15 bg-[#16171c] p-2.5 text-[11px] shadow-lg"
      style={{
        left: tickToPx(tile.start, perBar),
        // 뒤집을 때는 라인 위쪽 모서리를 기준으로 두고 자기 높이만큼 끌어올린다
        top: flipUp ? lineTop - 4 : lineTop + PITCHED_LINE_HEIGHT + 4,
        transform: flipUp ? "translateY(-100%)" : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-zinc-500">음</span>
        {tile.notes.map((note) => (
          <span
            key={note}
            className="inline-flex items-center gap-1 rounded bg-indigo-500/30 px-1.5 py-0.5 font-mono text-indigo-100"
          >
            {midiToName(note)}
            <button
              type="button"
              aria-label={`${midiToName(note)} 제거`}
              disabled={tile.notes.length === 1}
              className="text-indigo-300 disabled:opacity-30"
              onClick={() =>
                edit.setNotes(
                  line.id,
                  tile.id,
                  tile.notes.filter((n) => n !== note),
                )
              }
            >
              ×
            </button>
          </span>
        ))}
        {adding ? (
          <select
            autoFocus
            aria-label="음 추가"
            className="rounded bg-white/10 px-1 py-0.5 font-mono"
            defaultValue=""
            onChange={(event) => {
              const note = Number(event.target.value);
              setAdding(false);
              if (!Number.isNaN(note) && !tile.notes.includes(note)) {
                edit.setNotes(line.id, tile.id, [...tile.notes, note].sort((a, b) => a - b));
              }
            }}
            onBlur={() => setAdding(false)}
          >
            <option value="" disabled>
              선택
            </option>
            {NOTE_CHOICES.map((note) => (
              <option key={note} value={note}>
                {midiToName(note)}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            aria-label="음 추가"
            className="rounded bg-white/10 px-1.5 py-0.5"
            onClick={() => setAdding(true)}
          >
            +
          </button>
        )}
      </div>

      <label className="mb-2 flex items-center gap-2 text-zinc-500">
        세기
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(tile.velocity * 100)}
          aria-label="세기"
          className="flex-1 accent-zinc-400"
          onChange={(event) =>
            edit.setVelocity(line.id, tile.id, Number(event.target.value) / 100)
          }
        />
      </label>

      <label className="flex items-center gap-2 text-zinc-500">
        길이
        <select
          value={tile.length}
          aria-label="길이"
          className="flex-1 rounded bg-white/10 px-1 py-0.5 font-mono"
          onChange={(event) =>
            edit.resize(line.id, tile.id, Number(event.target.value))
          }
        >
          {LENGTH_CHOICES.map((choice) => (
            <option key={choice.ticks} value={choice.ticks}>
              {choice.label}
            </option>
          ))}
          {LENGTH_CHOICES.every((c) => c.ticks !== tile.length) && (
            <option value={tile.length}>{tile.length}틱</option>
          )}
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 3: `components/timeline/Timeline.tsx`에 팝오버 삽입**

`<Playflag ... />` 바로 아래에 넣는다.

```tsx
          <TilePopover perBar={perBar} />
```

import도 추가한다: `import { TilePopover } from "./TilePopover";`

- [ ] **Step 4: 검증**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: 전부 성공

- [ ] **Step 5: 커밋**

```bash
git add lib/score/notes.ts components/timeline/TilePopover.tsx components/timeline/Timeline.tsx
git commit -m "feat(editor): 타일 설정 팝오버 추가"
```

---

## Task 9: 키보드 단축키

**Files:**
- Modify: `components/timeline/Timeline.tsx`

**Interfaces:**
- Consumes: Task 5의 `selection`, `select`, `edit`, `undo`, `editable`
- Produces: 없음

- [ ] **Step 1: `components/timeline/Timeline.tsx`에 키보드 effect 추가**

컴포넌트 본문에 넣는다. `useEffect`를 import에 추가한다.

```tsx
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // 입력 필드에 포커스가 있으면 가로채지 않는다
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (!editable) return;

      if (event.key === "Escape") {
        select(null);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selection) return;
        event.preventDefault();
        edit.remove(selection.lineId, selection.tileId);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editable, selection, select, edit, undo]);
```

- [ ] **Step 2: 검증**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: 전부 성공

- [ ] **Step 3: 커밋**

```bash
git add components/timeline/Timeline.tsx
git commit -m "feat(editor): 삭제·선택 해제·실행취소 단축키 추가"
```

---

## Task 10: 실제로 편집하고 들어보기

**Files:**
- Modify: 이 단계에서 발견된 문제에 해당하는 파일

**Interfaces:**
- Consumes: Task 1~9 전부
- Produces: 없음 (검증 태스크)

정적 검사와 순수 함수 테스트는 상호작용에 대해 아무것도 증명하지 않는다.

- [ ] **Step 1: 개발 서버 실행**

```bash
pnpm dev
```

http://localhost:3000 을 연다.

- [ ] **Step 2: 타일 생성**

피아노 라인의 빈 칸을 클릭한다. 기대: 왼쪽 타일과 같은 음·길이의 타일이 격자에 붙어 생긴다. 라인 맨 앞(왼쪽에 타일이 없는 곳)을 클릭하면 `C4 E4 G4` 3화음이 생긴다.

- [ ] **Step 3: 이동과 길이 조절**

타일을 끌어 옮긴다. 기대: 드래그 중에는 타일만 따라오고, 놓으면 격자에 붙는다. 오른쪽 끝 6px을 잡고 끌면 길이가 바뀐다.

곡 끝 너머로 끌어 본다. 기대: 곡 끝에서 멈춘다.

- [ ] **Step 4: 삭제와 실행취소**

타일을 우클릭한다. 기대: 지워진다. `Ctrl+Z`. 기대: 되돌아온다.

타일을 만들고 `Ctrl+Z`. 기대: 사라지고, 그 타일의 팝오버가 떠 있었다면 같이 닫힌다.

- [ ] **Step 5: 드럼 이어 칠하기**

드럼 하이햇 행을 가로로 빠르게 끈다. 기대: 지나간 칸이 전부 켜지고 **빠뜨리는 칸이 없다.** 켜진 칸 위를 다시 끌면 전부 꺼진다.

빠뜨리는 칸이 있으면 포인터 이동 사이의 칸을 채우는 보간이 필요하다는 뜻이다.

- [ ] **Step 6: 팝오버**

타일을 클릭한다. 기대: 아래에 팝오버가 뜬다. 음을 추가·삭제하고 세기와 길이를 바꾼다. 바깥을 클릭하거나 `Esc`로 닫는다.

음이 하나만 남았을 때 × 버튼이 비활성인지 본다.

- [ ] **Step 7: 편집한 곡이 실제로 들리는지**

몇 개를 고친 뒤 재생한다. 기대: 바꾼 대로 들린다.

- [ ] **Step 8: 재생 중 편집이 막히는지**

재생 중에 타일을 클릭·드래그해 본다. 기대: 아무 일도 일어나지 않는다.

- [ ] **Step 9: 드래그 중 리렌더가 없는지**

React DevTools Profiler를 켜고 타일을 끈다. 기대: 드래그 중에는 커밋이 없고, `pointerup`에서 한 번만 있다.

- [ ] **Step 10: 발견된 문제 수정 후 커밋**

원인별로 나눠 커밋한다. 없으면 이 스텝을 건너뛴다.

```bash
git add <고친 파일>
git commit -m "fix(editor): <무엇이 왜 틀렸는지>"
```

---

## Task 11: 문서를 사실에 맞게 갱신

**Files:**
- Modify: `AGENTS.md`
- Modify: `.claude/rules/ui-conventions.md`

**Interfaces:**
- Consumes: Task 1~10이 만든 실제 동작
- Produces: 없음

- [ ] **Step 1: `AGENTS.md`의 "현재 상태" 절 교체**

```markdown
## 현재 상태

타임라인에서 곡을 편집하고 재생할 수 있다. `lib/score/`(곡 데이터·시간 변환·편집 함수), `lib/audio/`(AudioContext·look-ahead 스케줄러·신스 악기 4종), `state/`, `components/timeline/`, `components/transport/`가 존재한다.

타일을 찍고 옮기고 늘리고 지울 수 있으며, 드럼은 격자 칸 토글로 만든다. 타일을 클릭하면 음·세기·길이를 고치는 팝오버가 뜬다. `Ctrl+Z`로 되돌린다.

**편집은 정지 중에만 된다** — 재생 중 타임라인은 읽기 전용이다. 스케줄러의 커서가 `tiles[]` 인덱스라 재생 중 곡이 바뀌면 노트가 조용히 누락된다. 아직 없는 것: 다시실행, 다중 선택, 복사/붙여넣기, 라인 추가/삭제, 루프, 시크, 줌, 저장/불러오기, 샘플 음원.

설계 근거는 `docs/superpowers/specs/`에 있다.
```

- [ ] **Step 2: `.claude/rules/ui-conventions.md`의 "인터랙션" 절에 실제 제스처 추가**

기존 항목은 그대로 두고 절 끝에 아래를 덧붙인다.

```markdown
구현된 편집 제스처(`components/timeline/`):

| 제스처 | 결과 |
| --- | --- |
| 음정 라인 빈 칸 클릭 | 왼쪽의 가장 가까운 타일을 복제해 생성 |
| 타일 클릭 | 선택 + 설정 팝오버 |
| 타일 드래그 | 가로 이동 (스냅 1/16) |
| 타일 오른쪽 6px 드래그 | 길이 조절 |
| 타일 우클릭 / `Delete` | 삭제 |
| 드럼 칸 클릭·드래그 | 토글·이어 칠하기 |
| `Esc` | 팝오버 닫기, 선택 해제 |
| `Ctrl+Z` | 실행취소 |

편집은 정지 중에만 동작한다. `useStudio().editable`이 `!isPlaying`이다.
```

- [ ] **Step 3: 전체 검증**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: 전부 성공

- [ ] **Step 4: 커밋**

```bash
git add AGENTS.md .claude/rules/ui-conventions.md
git commit -m "docs: 구현된 편집 기능을 사실에 맞게 갱신"
```

---

## 완료 기준

- `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build`가 모두 통과한다
- 빈 칸을 클릭하면 왼쪽 타일이 복제되고, 왼쪽에 없으면 악기 기본값이 나온다
- 타일을 끌어 옮기고 늘릴 수 있고 곡 경계에서 멈춘다
- 드럼 격자를 드래그로 칠할 때 칸을 빠뜨리지 않는다
- 팝오버에서 음·세기·길이를 고칠 수 있다
- `Ctrl+Z`가 편집 직전 상태로 되돌리고, 사라진 타일의 선택이 풀린다
- 편집한 곡을 재생하면 바꾼 대로 들린다
- 재생 중에는 편집이 아무 일도 하지 않는다
- 드래그 중 곡 데이터 커밋이 일어나지 않는다 (Profiler로 확인)
