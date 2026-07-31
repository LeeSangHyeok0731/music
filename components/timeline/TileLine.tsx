import { midiToName } from "@/lib/score/notes";
import type { Line } from "@/lib/score/types";

import { PITCHED_LINE_HEIGHT, tickToPx } from "./layout";

const COLORS: Record<string, string> = {
  piano: "bg-indigo-500/30 border-indigo-400/70 text-indigo-100",
  guitar: "bg-emerald-500/30 border-emerald-400/70 text-emerald-100",
  bass: "bg-amber-500/30 border-amber-400/70 text-amber-100",
  drums: "bg-pink-500/30 border-pink-400/70 text-pink-100",
};

export function TileLine({ line, perBar }: { line: Line; perBar: number }) {
  const color = COLORS[line.instrument] ?? COLORS.piano;

  return (
    <div
      className="relative border-b border-white/10"
      style={{ height: PITCHED_LINE_HEIGHT }}
    >
      {line.tiles.map((tile) => (
        <div
          key={tile.id}
          className={`absolute top-1 flex items-center overflow-hidden rounded border px-1 text-[10px] leading-none whitespace-nowrap ${color}`}
          style={{
            left: tickToPx(tile.start, perBar),
            width: Math.max(tickToPx(tile.length, perBar) - 2, 4),
            height: PITCHED_LINE_HEIGHT - 8,
          }}
        >
          {tile.notes.map(midiToName).join("·")}
        </div>
      ))}
    </div>
  );
}
