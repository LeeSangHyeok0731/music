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
      onPointerCancel={() => {
        paint.current = null;
      }}
      onLostPointerCapture={() => {
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
