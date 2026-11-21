"use client";

import { PX_PER_BAR, barLabels } from "./geometry";
import { RULER_HEIGHT, ROW_DIVIDER } from "./layout";

interface RulerProps {
  bars: number;
}

/** 마디 번호 눈금자. 폭은 부모(스테이지)가 정하고, 마디 하나는 `PX_PER_BAR`px이다. */
export function Ruler({ bars }: RulerProps) {
  return (
    <div
      data-testid="ruler"
      className="flex"
      style={{ height: RULER_HEIGHT, boxShadow: ROW_DIVIDER }}
    >
      {barLabels(bars).map((bar) => (
        <span
          key={bar}
          className="shrink-0 pt-1 pl-1.5 font-mono text-xs tabular-nums text-zinc-500"
          style={{ width: PX_PER_BAR }}
        >
          {bar}
        </span>
      ))}
    </div>
  );
}
