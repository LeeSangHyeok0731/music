import { memo } from "react";

import { PX_PER_BAR } from "./layout";

/** 마디선과 박선. repeating-linear-gradient라 DOM 노드가 0개다. */
function BarLinesImpl({ width }: { width: number }) {
  const beatWidth = PX_PER_BAR / 4;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0"
      style={{
        width,
        backgroundImage: [
          `repeating-linear-gradient(to right, rgb(255 255 255 / 0.11) 0 1px, transparent 1px ${PX_PER_BAR}px)`,
          `repeating-linear-gradient(to right, rgb(255 255 255 / 0.035) 0 1px, transparent 1px ${beatWidth}px)`,
        ].join(","),
      }}
    />
  );
}

// width는 song 길이에서만 바뀐다 — 재생 중 리렌더에 휩쓸려 이 배경
// 그라디언트 노드를 매번 다시 계산할 이유가 없다.
export const BarLines = memo(BarLinesImpl);
