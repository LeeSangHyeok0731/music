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
  /**
   * 피아노롤을 연다(`notes` 클립이고 드럼이 아닐 때만 준다). `opener`는 누른 요소 — 모달이
   * 닫힐 때 포커스가 돌아온다. 편집 가능할 때만 부른다.
   */
  onEdit?(opener: HTMLElement): void;
}

/**
 * 클립 하나. 래퍼가 `clipRect` 위치의 타일(색·테두리·선택 링)이고, 안에 본문 `button`
 * (선택·팝오버·이동, 키보드로 닿는다), 오른쪽 가장자리 길이 핸들(포인터 전용), 선택됐을
 * 때의 삭제 버튼이 있다 — 버튼 안에 버튼을 넣을 수 없어 형제로 둔다.
 *
 * `onEdit`이 있으면(음 클립) 선택됐을 때 "음 편집" 버튼이 더 생기고, 본문 버튼의 더블클릭과
 * 키보드 클릭(`detail 0`: Enter, Space도 포함)으로도 연다. 마우스 클릭 한 번은 선택만 한다.
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
  onEdit,
}: ClipBlockProps) {
  const { left, width } = clipRect(clip.start, clip.length);
  const isPattern = clip.body.type === "pattern";
  const label =
    clip.body.type === "pattern" ? patternLabel(clip.body.pattern) : "음";

  return (
    <div
      data-testid={`clip-${clip.id}`}
      data-clip-id={clip.id}
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
        onClick={(e) => {
          body.onClick(e);
          // 키보드로 누른 클릭만 연다. 마우스 클릭은 pointerup이 선택을 처리했고 detail > 0이다.
          if (e.detail === 0 && editable) onEdit?.(e.currentTarget);
        }}
        onDoubleClick={(e) => {
          if (editable) onEdit?.(e.currentTarget);
        }}
      >
        {label}
      </button>
      {selected && onEdit && (
        <button
          type="button"
          aria-label="음 편집"
          aria-disabled={editable ? undefined : true}
          className="absolute top-0 right-6 z-10 px-1 text-zinc-300 hover:text-zinc-100"
          onClick={(e) => {
            if (editable) onEdit(e.currentTarget);
          }}
        >
          ✎
        </button>
      )}
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
