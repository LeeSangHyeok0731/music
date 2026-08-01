import { memo } from "react";

import type { Line } from "@/lib/score/types";

import { DRUM_ROWS, DRUM_ROW_HEIGHT, HEADER_WIDTH, lineHeight } from "./layout";

const DRUM_ROW_NAMES = ["킥", "스네어", "하이햇"];

function LineHeadersImpl({ lines }: { lines: Line[] }) {
  return (
    <div
      className="shrink-0 border-r border-white/15"
      style={{ width: HEADER_WIDTH }}
    >
      {lines.map((line) => (
        <div
          key={line.id}
          className="flex flex-col justify-center border-b border-white/10 px-2 text-xs text-zinc-300"
          style={{ height: lineHeight(line.kind) }}
        >
          {line.kind === "drum" ? (
            <>
              {DRUM_ROWS.map((_, i) => (
                <div
                  key={i}
                  className="flex items-center text-[10px] text-zinc-400"
                  style={{ height: DRUM_ROW_HEIGHT }}
                >
                  {DRUM_ROW_NAMES[i]}
                </div>
              ))}
            </>
          ) : (
            line.name
          )}
        </div>
      ))}
    </div>
  );
}

// lines는 song에서 useMemo로 나오는 배열이라 참조가 안정적이다 — 재생
// 중 리렌더되는 context value 때문에 트랙 헤더까지 다시 그릴 필요는 없다.
export const LineHeaders = memo(LineHeadersImpl);
