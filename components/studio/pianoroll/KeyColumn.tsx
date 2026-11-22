"use client";

import { memo } from "react";

import { ROW_DIVIDER } from "../layout";
import { KEY_COLUMN_WIDTH, ROW_HEIGHT, isBlackKey, noteName } from "./geometry";

export interface KeyColumnProps {
  /** 표시 범위의 최저·최고 음높이(맨 위 행이 hi). */
  lo: number;
  hi: number;
}

/**
 * 왼쪽 건반 열: 음 이름 행, 검은 건반은 어둡게. 스크롤 영역 안에서 `sticky left-0`이라 가로로
 * 스크롤해도 보이고 세로 스크롤은 격자와 한 몸이다. props가 안 바뀌면 다시 그리지 않는다.
 */
export const KeyColumn = memo(function KeyColumn({ lo, hi }: KeyColumnProps) {
  const rows: number[] = [];
  for (let pitch = hi; pitch >= lo; pitch--) rows.push(pitch);
  return (
    <div
      data-testid="roll-keys"
      className="sticky left-0 z-30 shrink-0 border-r border-white/10"
      style={{ width: KEY_COLUMN_WIDTH }}
    >
      {rows.map((pitch) => {
        const black = isBlackKey(pitch);
        return (
          <div
            key={pitch}
            data-pitch={pitch}
            data-black={black ? "true" : undefined}
            className={`flex items-center justify-end pr-2 font-mono text-[10px] tabular-nums ${
              black ? "bg-[#0e0f12] text-zinc-500" : "bg-[#1b1c22] text-zinc-300"
            }`}
            style={{ height: ROW_HEIGHT, boxShadow: ROW_DIVIDER }}
          >
            {noteName(pitch)}
          </div>
        );
      })}
    </div>
  );
});
