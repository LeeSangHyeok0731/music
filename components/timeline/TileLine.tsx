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
