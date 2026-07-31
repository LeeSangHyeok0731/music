import type { Line } from "@/lib/score/types";

import {
  DRUM_LINE_HEIGHT,
  DRUM_ROWS,
  DRUM_ROW_HEIGHT,
  PX_PER_BAR,
  tickToPx,
} from "./layout";

/** 16분음표 격자. 배경은 CSS로, 켜진 칸만 DOM 노드로 그린다. */
export function DrumGrid({ line, perBar }: { line: Line; perBar: number }) {
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
