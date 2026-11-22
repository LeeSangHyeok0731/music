"use client";

import { memo, useEffect } from "react";

import type { Note, Song } from "@/lib/score/model";
import type { ChordalInstrument, NoteKey } from "@/lib/score/notes";
import { ticksToBarBeat } from "@/lib/score/time";

import { INSTRUMENT_TILE } from "../instruments";
import { lengthLabel, noteName, noteRect } from "./geometry";

/** 음 오른쪽 가장자리 길이 핸들의 폭(px). */
export const NOTE_HANDLE_WIDTH = 8;

export interface NoteBlockProps {
  /** 이 음의 키(드래그 미리보기 중에도 **원래** 키 — 요소를 다시 마운트하지 않는다). */
  id: NoteKey;
  /** 그릴 음(미리보기 중이면 미리보기 위치·길이). */
  note: Note;
  clipStart: number;
  timeSignature: Song["timeSignature"];
  instrument: ChordalInstrument;
  hi: number;
  selected: boolean;
  /** 이동·길이 미리보기 위치에 그려지는 중. */
  dragging: boolean;
  editable: boolean;
  /** 테스트용: 커밋될 때마다 부른다. 안정된 함수를 넘긴다. */
  onRender?: (id: NoteKey) => void;
}

/**
 * 음 하나. 래퍼가 `noteRect` 위치의 칸이고(`data-note-key`), 안에 본문 `<button>`(선택·이동, 이름은
 * "C4, 3마디 1박, 길이 1/8" — 마디·박은 곡 기준)과 오른쪽 가장자리 8px 길이 핸들(포인터 전용
 * `separator`)이 형제로 있다. 포인터 핸들러는 격자가 위임으로 갖고 있어서 여기엔 없다 — 그래서
 * `memo`가 선택·미리보기가 바뀐 음만 다시 그린다.
 */
export const NoteBlock = memo(function NoteBlock({
  id,
  note,
  clipStart,
  timeSignature,
  instrument,
  hi,
  selected,
  dragging,
  editable,
  onRender,
}: NoteBlockProps) {
  useEffect(() => {
    onRender?.(id);
  });
  const { bar, beat } = ticksToBarBeat(clipStart + note.start, timeSignature);
  return (
    <div
      data-note-key={id}
      data-selected={selected ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      className={`absolute ${dragging ? "z-10" : ""}`}
      style={noteRect(note, hi)}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${noteName(note.pitch)}, ${bar}마디 ${beat}박, 길이 ${lengthLabel(note.length)}`}
        aria-disabled={editable ? undefined : true}
        className={`absolute inset-0 box-border touch-none overflow-hidden rounded-sm border ${INSTRUMENT_TILE[instrument]} ${
          selected ? "ring-1 ring-zinc-300" : ""
        }`}
      />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="음 길이 조절"
        aria-disabled={editable ? undefined : true}
        data-note-handle=""
        className={`absolute top-0 right-0 z-10 h-full touch-none ${
          editable ? "cursor-ew-resize" : ""
        }`}
        style={{ width: NOTE_HANDLE_WIDTH }}
      />
    </div>
  );
});
