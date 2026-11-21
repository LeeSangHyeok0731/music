"use client";

import { PX_PER_BAR, barLabels } from "./geometry";

interface BeatGridProps {
  bars: number;
  beatsPerBar: number;
}

/**
 * 스테이지 전체 높이를 덮는 박 구분선 레이어. 마디당 `beatsPerBar`개이고 마디의
 * 첫 선(`data-bar-line`)만 마디선 농도(white/0.11)다, 나머지는 박선(white/0.035).
 * 클릭을 가로채지 않으며 레인보다 아래에 깔린다(레인 배경은 투명해야 보인다).
 */
export function BeatGrid({ bars, beatsPerBar }: BeatGridProps) {
  const beats = barLabels(beatsPerBar).map((b) => b - 1);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
      {barLabels(bars).flatMap((bar) =>
        beats.map((beat) => (
          <div
            key={`${bar}-${beat}`}
            data-beat-line=""
            data-bar-line={beat === 0 ? "" : undefined}
            className="absolute top-0 bottom-0 w-px"
            style={{
              left: (bar - 1) * PX_PER_BAR + (beat * PX_PER_BAR) / beatsPerBar,
              backgroundColor:
                beat === 0
                  ? "rgb(255 255 255 / 0.11)"
                  : "rgb(255 255 255 / 0.035)",
            }}
          />
        )),
      )}
    </div>
  );
}
