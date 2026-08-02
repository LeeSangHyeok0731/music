import { memo } from "react";

import type { InstrumentId, Line } from "@/lib/score/types";

import {
  DRUM_ROWS,
  DRUM_ROW_HEIGHT,
  HEADER_WIDTH,
  ROW_DIVIDER,
  RULER_HEIGHT,
  lineHeight,
} from "./layout";

const DRUM_ROW_NAMES = ["킥", "스네어", "하이햇"];

/**
 * 헤더 열의 악기 이름 옆에 붙는 색 점. 타일 색과 같은 계열로 맞춘다.
 * InstrumentId 전부를 키로 요구하므로 fallback이 필요 없다.
 */
const DOT_COLORS: Record<InstrumentId, string> = {
  piano: "bg-indigo-400",
  guitar: "bg-emerald-400",
  bass: "bg-amber-400",
  drums: "bg-rose-400",
};

function LineHeadersImpl({ lines }: { lines: Line[] }) {
  return (
    <div
      className="shrink-0 border-r border-white/10 bg-[#141519]"
      style={{ width: HEADER_WIDTH }}
    >
      {/* 스테이지의 눈금자와 행을 맞추기 위한 빈 칸 */}
      <div style={{ height: RULER_HEIGHT, boxShadow: ROW_DIVIDER }} />

      {lines.map((line) => (
        <div
          key={line.id}
          className="flex flex-col justify-center px-3"
          style={{ height: lineHeight(line.kind), boxShadow: ROW_DIVIDER }}
        >
          {line.kind === "drum" ? (
            DRUM_ROWS.map((_, i) => (
              <div
                key={i}
                className="flex items-center text-[11px] text-zinc-500"
                style={{ height: DRUM_ROW_HEIGHT }}
              >
                {DRUM_ROW_NAMES[i]}
              </div>
            ))
          ) : (
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${DOT_COLORS[line.instrument]}`}
              />
              <span className="truncate text-[13px] text-zinc-300">
                {line.name}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// song은 state이고 replaceLine이 편집마다 새 lines 배열을 만들므로, 편집
// 중에는 이 memo가 매번 풀린다 — 그래도 재생 중에는(편집이 없는 구간) props가
// 그대로라 memo가 그대로 유효하다. 10Hz로 바뀌는 context value 때문에 재생
// 중 트랙 헤더까지 다시 그릴 필요는 없다는 게 이 memo가 지키는 케이스다.
export const LineHeaders = memo(LineHeadersImpl);
