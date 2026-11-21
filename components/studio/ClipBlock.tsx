"use client";

import type { Clip, InstrumentId } from "@/lib/score/model";
import { patternLabel } from "@/lib/score/pattern-labels";

import { clipRect } from "./geometry";
import { INSTRUMENT_TILE } from "./instruments";
import type { ClipBodyProps, ClipHandleProps } from "./useClipDrag";

const HANDLE_WIDTH = 8;

export interface ClipBlockProps {
  clip: Clip;
  instrument: InstrumentId;
  selected: boolean;
  /** 이 클립의 패턴 팝오버가 열려 있는가(패턴 클립만). */
  expanded: boolean;
  editable: boolean;
  /** 드래그로 옮기거나 늘리는 중이라 미리보기 위치에 있다. */
  dragging: boolean;
  body: ClipBodyProps;
  handle: ClipHandleProps;
  /** 본문 버튼. 팝오버가 닫힐 때 포커스를 돌려준다. */
  buttonRef(el: HTMLButtonElement | null): void;
  onDelete(): void;
}

/**
 * 클립 하나. 래퍼가 `clipRect` 위치의 타일(색·테두리·선택 링)이고, 안에 본문 `button`
 * (선택·팝오버·이동, 키보드로 닿는다), 오른쪽 가장자리 길이 핸들(포인터 전용), 선택됐을
 * 때의 삭제 버튼이 있다 — 버튼 안에 버튼을 넣을 수 없어 형제로 둔다.
 */
export function ClipBlock({
  clip,
  instrument,
  selected,
  expanded,
  editable,
  dragging,
  body,
  handle,
  buttonRef,
  onDelete,
}: ClipBlockProps) {
  const { left, width } = clipRect(clip.start, clip.length);
  const isPattern = clip.body.type === "pattern";
  const label =
    clip.body.type === "pattern" ? patternLabel(clip.body.pattern) : "음";

  return (
    <div
      data-testid={`clip-${clip.id}`}
      data-selected={selected ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      className={`absolute top-1 bottom-1 box-border overflow-hidden rounded border text-sm text-zinc-200 select-none ${
        INSTRUMENT_TILE[instrument]
      } ${selected ? "ring-1 ring-zinc-300" : ""}`}
      style={{ left, width }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-pressed={selected}
        aria-haspopup={isPattern ? "dialog" : undefined}
        aria-expanded={isPattern ? expanded : undefined}
        aria-disabled={editable ? undefined : true}
        className="absolute inset-0 touch-none px-2 text-left text-nowrap"
        {...body}
      >
        {label}
      </button>
      {selected && (
        <button
          type="button"
          aria-label="클립 삭제"
          aria-disabled={editable ? undefined : true}
          className="absolute top-0 right-2 z-10 px-1 text-zinc-300 hover:text-zinc-100"
          onClick={() => {
            if (editable) onDelete();
          }}
        >
          ×
        </button>
      )}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="클립 길이 조절"
        aria-disabled={editable ? undefined : true}
        className={`absolute top-0 right-0 z-20 h-full touch-none ${
          editable ? "cursor-col-resize" : ""
        }`}
        style={{ width: HANDLE_WIDTH }}
        {...handle}
      />
    </div>
  );
}
