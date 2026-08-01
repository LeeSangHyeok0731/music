import { memo } from "react";

import type { Line } from "@/lib/score/types";

import {
  DRUM_LINE_HEIGHT,
  DRUM_ROWS,
  DRUM_ROW_HEIGHT,
  PX_PER_BAR,
  tickToPx,
} from "./layout";

/** 16분음표 격자. 배경은 CSS로, 켜진 칸만 DOM 노드로 그린다. */
function DrumGridImpl({ line, perBar }: { line: Line; perBar: number }) {
  const stepWidth = PX_PER_BAR / 16;

  return (
    <div
      className="relative border-b border-white/10"
      style={{
        height: DRUM_LINE_HEIGHT,
        backgroundImage: [
          `repeating-linear-gradient(to right, rgb(255 255 255 / 0.06) 0 1px, transparent 1px ${stepWidth}px)`,
          `repeating-linear-gradient(to bottom, rgb(255 255 255 / 0.08) 0 1px, transparent 1px ${DRUM_ROW_HEIGHT}px)`,
        ].join(","),
      }}
    >
      {line.tiles.map((tile) => {
        // 첫 노트 하나만 보고 행을 정한다 — 한 칸에 노트 하나라고 가정한다.
        // notes는 드럼도 number[]라 여러 개 들어갈 수 있지만, 지금 픽스처는
        // 전부 한 개짜리라 드러나지 않는다. 다중 노트 드럼 타일이 생기면
        // 나머지는 조용히 안 그려진다.
        const row = DRUM_ROWS.indexOf(
          tile.notes[0] as (typeof DRUM_ROWS)[number],
        );
        if (row < 0) return null;

        return (
          <div
            key={tile.id}
            className="absolute rounded-sm border border-pink-300/70 bg-pink-500/45"
            style={{
              left: tickToPx(tile.start, perBar) + 1,
              top: row * DRUM_ROW_HEIGHT + 3,
              width: Math.max(tickToPx(tile.length, perBar) - 2, 4),
              height: DRUM_ROW_HEIGHT - 6,
            }}
          />
        );
      })}
    </div>
  );
}

// TileLine과 같은 이유 — 재생 중 context value가 바뀔 때마다 이 격자를
// 다시 그리지 않도록 line/perBar가 그대로면 리렌더를 건너뛴다.
export const DrumGrid = memo(DrumGridImpl);
