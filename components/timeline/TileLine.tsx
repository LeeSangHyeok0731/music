"use client";

import { memo, useRef } from "react";

import { midiToName } from "@/lib/score/notes";
import type { InstrumentId, Line } from "@/lib/score/types";
import type { TileEditHandlers, TileRef } from "@/state/StudioProvider";

import { PITCHED_LINE_HEIGHT, ROW_DIVIDER, pxToTick, tickToPx } from "./layout";
import { useTileDrag } from "./useTileDrag";

// InstrumentId 전부를 키로 요구하는 타입이라 fallback이 필요 없다 —
// 새 악기가 추가되면 여기 빠뜨린 게 타입 에러로 바로 드러난다.
const COLORS: Record<InstrumentId, string> = {
  piano: "bg-indigo-500/25 border-indigo-400/60 text-indigo-100",
  guitar: "bg-emerald-500/25 border-emerald-400/60 text-emerald-100",
  bass: "bg-amber-500/25 border-amber-400/60 text-amber-100",
  drums: "bg-rose-500/25 border-rose-400/60 text-rose-100",
};

const TILE_INSET = 6;
/** 오른쪽 끝 이 폭 안에서 누르면 길이 조절이다. */
const RESIZE_HANDLE_PX = 6;

/** 이 거리 안에서 뗐으면 클릭으로 본다. 넘으면 스크롤·드래그 의도다. */
const CLICK_SLOP_PX = 4;

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
  /**
   * Provider의 `select`를 그대로 받는다. Timeline에서 lineId를 감싼 클로저를
   * 만들면 매 렌더마다 새 함수가 되어 memo가 항상 풀린다. 이 컴포넌트가
   * 이미 line.id를 알고 있으므로 여기서 조립한다.
   */
  onSelect: (ref: TileRef | null) => void;
}) {
  const color = COLORS[line.instrument];
  /** 빈 칸을 누른 지점. 뗄 때 클릭인지 드래그인지 판정한다. */
  const pressRef = useRef<{ x: number; y: number } | null>(null);

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
        // 왼쪽 버튼만. pointerdown은 우클릭에도 오므로, 막지 않으면
        // 빈 칸에서 우클릭할 때마다 타일이 생기고 그 위에 컨텍스트 메뉴가 뜬다.
        if (event.button !== 0) return;
        pressRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!editable || !press) return;

        // 누른 자리에서 거의 안 움직였을 때만 만든다. pointerdown에서 바로
        // 만들면 두 가지가 깨진다 — 타임라인을 가로로 끌어 스크롤하려는
        // 터치가 매번 타일을 남기고, 팝오버를 닫으려고 빈 곳을 클릭할 때마다
        // 타일이 생겨 "편집하지 않고 닫는" 방법이 없어진다.
        const moved =
          Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y);
        if (moved > CLICK_SLOP_PX) return;

        const rect = event.currentTarget.getBoundingClientRect();
        edit.createAt(line.id, pxToTick(event.clientX - rect.left, perBar));
      }}
      onPointerCancel={() => {
        pressRef.current = null;
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
              // 가로 스크롤이 가능한 스테이지 위에서 가로로 끌면 브라우저가
              // 패닝으로 가져가며 드래그를 취소한다. 여기서는 우리가 쓴다.
              touchAction: "none",
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (!editable) return;
              if (event.button !== 0) return;
              onSelect({ lineId: line.id, tileId: tile.id });
              const rect = event.currentTarget.getBoundingClientRect();
              // 손잡이가 타일보다 넓으면 안 된다. 최소 길이 타일(16분음표)은
              // 화면에서 5.5px라, 6px 손잡이가 타일 전체를 덮어 이동이
              // 아예 불가능해진다. 폭의 절반을 넘지 않게 묶는다.
              const handle = Math.min(RESIZE_HANDLE_PX, rect.width / 2);
              const kind =
                event.clientX >= rect.right - handle ? "resize" : "move";
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
            onPointerCancel={drag.onPointerCancel}
            onLostPointerCapture={drag.onPointerCancel}
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
