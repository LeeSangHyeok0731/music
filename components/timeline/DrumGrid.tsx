"use client";

import { memo, useRef, useState } from "react";

import { SNAP_TICKS, isDrumCellTile } from "@/lib/score/edit";
import type { DrumCell } from "@/lib/score/edit";
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
  /**
   * 진행 중인 스트로크. 방향(`on`)은 `pointerdown`에서 정해 끝까지 고정한다 —
   * 지나가며 토글하면 포인터가 왔다갔다할 때 칸이 깜빡인다.
   *
   * 칸은 모아 뒀다가 `pointerup`에서 한 번 커밋한다. 칸마다 커밋하면 하이햇
   * 한 마디(16칸)만 칠해도 실행취소 히스토리 16칸이 날아가고, 되돌리려면
   * Ctrl+Z를 열여섯 번 눌러야 한다. 타일 드래그가 같은 이유로 그렇게 한다.
   */
  const stroke = useRef<{ on: boolean; cells: DrumCell[] } | null>(null);
  /** 커밋 전까지 화면에 보여줄 스트로크. 없으면 칠하는 게 보이지 않는다. */
  const [preview, setPreview] = useState<{
    on: boolean;
    keys: Set<string>;
  } | null>(null);

  function cellAt(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const tick = pxToTick(event.clientX - rect.left, perBar);
    // 격자 왼쪽 밖은 칸이 아니다. 포인터 캡처 중에는 음수가 들어온다.
    if (tick < 0) return null;
    const start = Math.floor(tick / SNAP_TICKS) * SNAP_TICKS;
    const row = Math.floor((event.clientY - rect.top) / DRUM_ROW_HEIGHT);
    const piece = DRUM_ROWS[row];
    return piece === undefined ? null : { start, piece };
  }

  function addToStroke(cell: DrumCell) {
    const current = stroke.current;
    if (!current) return;

    const key = `${cell.start}:${cell.piece}`;
    if (current.cells.some((c) => `${c.start}:${c.piece}` === key)) return;

    current.cells.push(cell);
    setPreview({
      on: current.on,
      keys: new Set(current.cells.map((c) => `${c.start}:${c.piece}`)),
    });
  }

  function endStroke(commit: boolean) {
    const current = stroke.current;
    stroke.current = null;
    setPreview(null);
    if (commit && current && current.cells.length > 0) {
      edit.toggleDrumStroke(line.id, current.cells, current.on);
    }
  }

  return (
    <div
      className={`relative ${editable ? "cursor-pointer" : ""}`}
      style={{
        height: DRUM_LINE_HEIGHT,
        boxShadow: ROW_DIVIDER,
        // 가로 스크롤이 가능한 스테이지 위에서 가로로 이어 칠하면 브라우저가
        // 패닝으로 가져가며 드래그를 끊는다. 여기서는 우리가 쓴다.
        touchAction: "none",
        backgroundImage: [
          `repeating-linear-gradient(to right, rgb(255 255 255 / 0.04) 0 1px, transparent 1px ${stepWidth}px)`,
          `repeating-linear-gradient(to bottom, rgb(255 255 255 / 0.06) 0 1px, transparent 1px ${DRUM_ROW_HEIGHT}px)`,
        ].join(","),
      }}
      onPointerDown={(event) => {
        if (!editable) return;
        // 왼쪽 버튼만. 막지 않으면 우클릭에도 칠하기가 시작된다.
        if (event.button !== 0) return;
        const cell = cellAt(event);
        if (!cell) return;
        event.currentTarget.setPointerCapture(event.pointerId);

        const isOn = line.tiles.some((tile) =>
          isDrumCellTile(tile, cell.start, cell.piece),
        );
        stroke.current = { on: !isOn, cells: [] };
        addToStroke(cell);
      }}
      onPointerMove={(event) => {
        if (!stroke.current) return;
        const cell = cellAt(event);
        if (!cell) return;
        addToStroke(cell);
      }}
      onPointerUp={() => endStroke(true)}
      // 취소된 스트로크는 커밋하지 않는다. 터치 패닝에 뺏기거나 요소가
      // 언마운트되면 사용자가 의도한 칠하기가 아니다.
      onPointerCancel={() => endStroke(false)}
      onLostPointerCapture={() => endStroke(true)}
    >
      {line.tiles.map((tile) => {
        // 첫 노트 하나만 보고 행을 정한다 — 격자는 한 칸 = 한 음을 전제한다.
        const row = DRUM_ROWS.indexOf(
          tile.notes[0] as (typeof DRUM_ROWS)[number],
        );
        if (row < 0) return null;

        // 지우는 스트로크가 지나간 칸은 커밋 전에 미리 감춘다
        if (
          preview &&
          !preview.on &&
          preview.keys.has(`${tile.start}:${tile.notes[0]}`)
        ) {
          return null;
        }

        return (
          <div
            key={tile.id}
            className="pointer-events-none absolute rounded-sm border border-rose-300/60 bg-rose-500/45"
            style={{
              // TileLine의 음정 타일과 같은 기준(오프셋 없이 tickToPx 그대로)을
              // 쓴다. 전에는 여기만 +1이라 같은 틱이어도 드럼 타일이 음정
              // 타일보다 1px 오른쪽에서 시작했다.
              left: tickToPx(tile.start, perBar),
              top: row * DRUM_ROW_HEIGHT + 5,
              width: Math.max(tickToPx(tile.length, perBar) - 2, 4),
              height: DRUM_ROW_HEIGHT - 10,
            }}
          />
        );
      })}

      {/* 켜는 스트로크가 지나간 칸. 커밋되면 위 목록으로 넘어간다. */}
      {preview?.on &&
        [...preview.keys].map((key) => {
          const [start, piece] = key.split(":").map(Number);
          const row = DRUM_ROWS.indexOf(piece as (typeof DRUM_ROWS)[number]);
          if (row < 0) return null;
          // 이미 켜져 있던 칸은 위에서 그리므로 두 번 그리지 않는다
          if (line.tiles.some((t) => isDrumCellTile(t, start, piece))) {
            return null;
          }

          return (
            <div
              key={key}
              className="pointer-events-none absolute rounded-sm border border-rose-300/60 bg-rose-500/45"
              style={{
                left: tickToPx(start, perBar),
                top: row * DRUM_ROW_HEIGHT + 5,
                width: Math.max(tickToPx(SNAP_TICKS, perBar) - 2, 4),
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
