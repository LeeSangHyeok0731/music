import { memo } from "react";

import { midiToName } from "@/lib/score/notes";
import type { Line } from "@/lib/score/types";

import { PITCHED_LINE_HEIGHT, ROW_DIVIDER, tickToPx } from "./layout";

const COLORS: Record<string, string> = {
  piano: "bg-indigo-500/25 border-indigo-400/60 text-indigo-100",
  guitar: "bg-emerald-500/25 border-emerald-400/60 text-emerald-100",
  bass: "bg-amber-500/25 border-amber-400/60 text-amber-100",
  drums: "bg-rose-500/25 border-rose-400/60 text-rose-100",
};

const TILE_INSET = 6;

function TileLineImpl({ line, perBar }: { line: Line; perBar: number }) {
  const color = COLORS[line.instrument] ?? COLORS.piano;

  return (
    <div
      className="relative"
      style={{ height: PITCHED_LINE_HEIGHT, boxShadow: ROW_DIVIDER }}
    >
      {line.tiles.map((tile) => (
        <div
          key={tile.id}
          className={`absolute flex items-center overflow-hidden rounded-md border px-1.5 font-mono text-[11px] leading-none whitespace-nowrap ${color}`}
          style={{
            left: tickToPx(tile.start, perBar),
            top: TILE_INSET,
            width: Math.max(tickToPx(tile.length, perBar) - 2, 4),
            height: PITCHED_LINE_HEIGHT - TILE_INSET * 2,
          }}
        >
          {tile.notes.map(midiToName).join(" ")}
        </div>
      ))}
    </div>
  );
}

// 재생 중엔 StudioProvider의 context value가 10Hz로 바뀌어 Timeline이
// 매번 리렌더된다. line/perBar가 그대로면 이 ~272개 타일 div를 다시
// 그릴 이유가 없으므로 memo로 끊는다 — 안 그러면 재생 중 매 리렌더가
// 스케줄러 타이머와 같은 메인 스레드를 잡아먹어 오디오가 튄다.
export const TileLine = memo(TileLineImpl);
