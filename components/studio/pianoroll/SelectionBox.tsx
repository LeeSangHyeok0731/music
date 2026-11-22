"use client";

import type { BoxPreview } from "./useNoteGestures";

/**
 * 박스 선택 미리보기(격자 안 px). 포인터를 받지 않는다 — 놓을 때 선택이 확정된다.
 */
export function SelectionBox({ box }: { box: BoxPreview }) {
  const { a, b } = box;
  return (
    <div
      data-testid="roll-selection-box"
      aria-hidden
      className="pointer-events-none absolute z-10 border border-zinc-300/70 bg-white/[0.06]"
      style={{
        left: Math.min(a.x, b.x),
        top: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
      }}
    />
  );
}
