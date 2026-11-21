"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { ROOT_NAMES } from "@/lib/score/chords";
import { SNAP_TICKS } from "@/lib/score/edit";
import {
  CHORD_QUALITIES,
  type Chord,
  type ChordQuality,
  type ChordSegment,
} from "@/lib/score/model";

/** 팝오버 폭(px). 위치 클램프(`popoverPosition`)와 스타일이 함께 쓴다. */
export const POPOVER_WIDTH = 224;
const GAP = 4;
const MARGIN = 8;

const QUALITY_TEXT: Record<ChordQuality, string> = {
  maj: "maj",
  min: "m",
  dom7: "7",
  maj7: "maj7",
  min7: "m7",
};

const QUALITY_NAME: Record<ChordQuality, string> = {
  maj: "메이저",
  min: "마이너",
  dom7: "도미넌트 7",
  maj7: "메이저 7",
  min7: "마이너 7",
};

/**
 * 구간 버튼의 화면 사각형 아래에 붙이고 가로로는 뷰포트 안에 가둔다. 팝오버가
 * `position: fixed`라서 타임라인의 `overflow`에 잘리지 않는다.
 */
export function popoverPosition(
  anchor: { left: number; bottom: number },
  viewportWidth: number,
): { left: number; top: number } {
  const max = Math.max(MARGIN, viewportWidth - POPOVER_WIDTH - MARGIN);
  return {
    left: Math.min(Math.max(anchor.left, MARGIN), max),
    top: anchor.bottom + GAP,
  };
}

export interface ChordPopoverProps {
  /** 팝오버를 연 구간 버튼. 바깥 클릭 판정에서 제외한다(그 버튼의 onClick이 토글한다). */
  anchor: HTMLElement;
  position: { left: number; top: number };
  segment: ChordSegment;
  /** 마지막 구간이면 합치기가 없다. */
  isLast: boolean;
  onChange(chord: Chord): void;
  onSplit(): void;
  onMerge(): void;
  /** `returnFocus`: 키보드로 닫을 때만 참(바깥을 눌렀다면 그 자리 포커스를 뺏지 않는다). */
  onClose(returnFocus: boolean): void;
}

const BUTTON =
  "rounded border border-white/10 px-1 py-1 text-xs text-zinc-200 hover:bg-white/10 aria-pressed:bg-white/15 aria-pressed:text-zinc-100 aria-pressed:ring-1 aria-pressed:ring-zinc-400 disabled:text-zinc-500 disabled:hover:bg-transparent";

/**
 * 구간의 코드를 고르는 팝오버. `document.body`로 포털해 타임라인의 스크롤 영역
 * 밖에 그린다. 현재 값(`segment.chord`)은 부모가 곡에서 읽어 내려준다 — 근음을
 * 바꾸면 종류를 유지하고 반대도 같다. 근음·종류는 고르는 즉시 적용하고 닫지 않는다.
 */
export function ChordPopover({
  anchor,
  position,
  segment,
  isLast,
  onChange,
  onSplit,
  onMerge,
  onClose,
}: ChordPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current(true);
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      // 열어 준 구간 버튼은 자기 onClick이 토글하므로 여기서 닫지 않는다.
      if (
        target &&
        (rootRef.current?.contains(target) || anchor.contains(target))
      ) {
        return;
      }
      closeRef.current(false);
    };
    // 위치가 fixed라 스크롤·크기 변경으로 구간에서 떨어진다. 따라가지 않고 닫는다.
    const onMove = () => closeRef.current(false);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [anchor]);

  const { chord } = segment;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="코드 선택"
      className="z-50 rounded-md border border-white/10 bg-[#141519] p-2 shadow-lg"
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
        width: POPOVER_WIDTH,
      }}
    >
      <div className="grid grid-cols-6 gap-1">
        {ROOT_NAMES.map((name, root) => (
          <button
            key={name}
            ref={root === 0 ? firstRef : undefined}
            type="button"
            className={BUTTON}
            aria-pressed={chord.root === root}
            onClick={() => onChange({ root, quality: chord.quality })}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1">
        {CHORD_QUALITIES.map((quality) => (
          <button
            key={quality}
            type="button"
            className={BUTTON}
            aria-label={QUALITY_NAME[quality]}
            aria-pressed={chord.quality === quality}
            onClick={() => onChange({ root: chord.root, quality })}
          >
            {QUALITY_TEXT[quality]}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <button
          type="button"
          className={BUTTON}
          disabled={segment.length < 2 * SNAP_TICKS}
          onClick={onSplit}
        >
          가운데에서 나누기
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={isLast}
          onClick={onMerge}
        >
          오른쪽과 합치기
        </button>
      </div>
    </div>,
    document.body,
  );
}
