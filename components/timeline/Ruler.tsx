import { memo } from "react";

import { PX_PER_BAR, ROW_DIVIDER, RULER_HEIGHT } from "./layout";

/**
 * 마디 번호 눈금자. 마디 수만큼만 노드를 만든다(16마디면 16개).
 * 지금 어디를 보고 있는지 알려주는 유일한 기준이라 스테이지 맨 위에 둔다.
 */
function RulerImpl({ bars }: { bars: number }) {
  return (
    <div
      className="relative"
      style={{ height: RULER_HEIGHT, boxShadow: ROW_DIVIDER }}
    >
      {Array.from({ length: bars }, (_, i) => (
        <div
          key={i}
          className="absolute top-0 flex h-full items-center pl-1.5 font-mono text-[10px] tabular-nums text-zinc-500"
          style={{ left: i * PX_PER_BAR }}
        >
          {i + 1}
        </div>
      ))}
    </div>
  );
}

// 마디 수는 곡 길이에서만 바뀐다 — 재생 중 리렌더에 휩쓸릴 이유가 없다.
export const Ruler = memo(RulerImpl);
