"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { patternLabel } from "@/lib/score/pattern-labels";
import { patternsFor } from "@/lib/score/patterns";
import type { InstrumentId } from "@/lib/score/model";

import { POPOVER_WIDTH, usePopoverDismiss } from "./popover";

export interface PatternPopoverProps {
  /** 팝오버를 연 클립 버튼. 바깥 누르기 판정에서 제외한다(그 버튼의 클릭이 토글한다). */
  anchor: HTMLElement;
  position: { left: number; top: number };
  instrument: InstrumentId;
  /** 클립의 현재 패턴. 부모가 곡에서 읽어 내려준다. */
  current: string;
  onPickClip(patternId: string): void;
  onPickTrack(patternId: string): void;
  /** "음으로 바꾸기": 지금 코드 진행으로 펼친 음 클립으로 바꾸고 피아노롤을 연다. 드럼에는 보이지 않는다. */
  onBake(): void;
  /** "빈 음 클립으로": 같은 자리의 빈 음 클립으로 바꾸고 피아노롤을 연다. 드럼에는 보이지 않는다. */
  onEmpty(): void;
  /** `returnFocus`: 키보드로 닫을 때만 참(바깥을 눌렀다면 그 자리 포커스를 뺏지 않는다). */
  onClose(returnFocus: boolean): void;
}

const BUTTON =
  "rounded border border-white/10 px-2 py-1 text-left text-xs text-zinc-200 hover:bg-white/10 aria-pressed:bg-white/15 aria-pressed:text-zinc-100 aria-pressed:ring-1 aria-pressed:ring-zinc-400";

/**
 * 패턴 클립의 패턴을 고르는 팝오버. `document.body`로 포털해 타임라인의 스크롤 영역
 * 밖에 그린다. 고르는 즉시 적용하고 닫지 않는다. "이 트랙 전체에 적용"을 켜고 고르면
 * 트랙의 모든 패턴 클립이 바뀐다(체크는 열 때마다 꺼져 있다).
 */
export function PatternPopover({
  anchor,
  position,
  instrument,
  current,
  onPickClip,
  onPickTrack,
  onBake,
  onEmpty,
  onClose,
}: PatternPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const [wholeTrack, setWholeTrack] = useState(false);

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);

  usePopoverDismiss({ anchor, rootRef, onClose });

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="패턴 선택"
      className="z-50 rounded-md border border-white/10 bg-[#141519] p-2 shadow-lg"
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
        width: POPOVER_WIDTH,
      }}
    >
      <div className="flex flex-col gap-1">
        {patternsFor(instrument).map((pattern, i) => (
          <button
            key={pattern.id}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            className={BUTTON}
            aria-pressed={pattern.id === current}
            onClick={() =>
              wholeTrack ? onPickTrack(pattern.id) : onPickClip(pattern.id)
            }
          >
            {patternLabel(pattern.id)}
          </button>
        ))}
      </div>
      {instrument !== "drums" && (
        <div className="mt-2 flex flex-col gap-1 border-t border-white/10 pt-2">
          <button type="button" className={BUTTON} onClick={onBake}>
            음으로 바꾸기
          </button>
          <button type="button" className={BUTTON} onClick={onEmpty}>
            빈 음 클립으로
          </button>
        </div>
      )}
      <label className="mt-2 flex items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={wholeTrack}
          onChange={(e) => setWholeTrack(e.target.checked)}
        />
        이 트랙 전체에 적용
      </label>
    </div>,
    document.body,
  );
}
