"use client";

import { memo, useEffect } from "react";

import { chordLabel } from "@/lib/score/chords";
import type { Clip, Song } from "@/lib/score/model";
import {
  noteKey,
  type ChordalInstrument,
  type GridUnit,
  type NoteKey,
} from "@/lib/score/notes";
import { ticksPerBeat } from "@/lib/score/time";

import { ROW_DIVIDER } from "../layout";
import { NoteBlock } from "./NoteBlock";
import {
  ROLL_CHORD_STRIP_HEIGHT,
  ROW_HEIGHT,
  ROW_LINES_BACKGROUND,
  chordSegmentsInClip,
  chordToneRows,
  gridBackground,
  pitchToY,
  rollTickToX,
} from "./geometry";
import type { NoteGridHandlers, NotePreview } from "./useNoteGestures";

/**
 * 격자 위 코드 띠(읽기 전용). 클립 구간의 코드 구간을 클립 기준 x에 그린다. `memo`라서 곡·클립이
 * 안 바뀌면(재생 위치 10Hz 갱신) 다시 그리지 않는다.
 */
export const RollChordStrip = memo(function RollChordStrip({
  song,
  clip,
  onViewRender,
}: {
  song: Song;
  clip: Clip;
  /** 테스트용: 커밋될 때마다 부른다. 안정된 함수를 넘긴다. */
  onViewRender?: () => void;
}) {
  useEffect(() => {
    onViewRender?.();
  });
  return (
    <div
      data-testid="roll-chord-strip"
      className="relative bg-[#141519]"
      style={{
        width: rollTickToX(clip.length),
        height: ROLL_CHORD_STRIP_HEIGHT,
        boxShadow: ROW_DIVIDER,
      }}
    >
      {chordSegmentsInClip(song, clip).map((seg) => (
        <div
          key={seg.start}
          data-testid="roll-chord-label"
          className="absolute top-0 bottom-0 flex items-center overflow-hidden border-l border-white/10 px-2 text-xs text-zinc-300"
          style={{
            left: rollTickToX(seg.start),
            width: rollTickToX(seg.length),
          }}
        >
          {chordLabel(seg.chord)}
        </div>
      ))}
    </div>
  );
});

export interface NoteGridProps {
  song: Song;
  clip: Clip;
  instrument: ChordalInstrument;
  /** 표시 범위(`displayRange`). */
  lo: number;
  hi: number;
  unit: GridUnit;
  /** 선택된 키(클립에 있는 음으로 걸러진 것). */
  selection: readonly NoteKey[];
  /** 이동·길이 드래그 미리보기. 곡은 커밋 전까지 그대로다. */
  preview: NotePreview | null;
  editable: boolean;
  /** 음 제스처 핸들러(`useNoteGestures`). 격자 요소에 위임으로 건다. 안정된 묶음을 넘긴다. */
  handlers: NoteGridHandlers;
  /** 테스트용: 이 격자가 커밋(렌더 결과 반영)될 때마다 부른다. 안정된 함수를 넘긴다. */
  onViewRender?: () => void;
  /** 테스트용: 음 하나가 커밋될 때마다 그 음의 키로 부른다. 안정된 함수를 넘긴다. */
  onNoteRender?: (key: NoteKey) => void;
}

/**
 * 음 격자. 세로 격자선(마디·박·선택한 단위)과 행 구분선은 CSS 배경이라 DOM 요소가 아니다. 그
 * 위에 코드 구성음 행 색칠(코드 띠 구간 단위 레이어)과 음이 있다. 플레이헤드는 이 안에 두지 않는다
 * (재생 중 이 컴포넌트가 다시 그려지면 안 된다) — `memo`라서 10Hz 위치 표본에는 반응하지 않는다.
 *
 * 이 요소가 음 제스처의 표면이다: 포인터 핸들러를 여기 한 번 걸고(음 본문·핸들·빈 곳을 대상으로
 * 가른다) 누를 때 이 요소에 포인터를 캡처한다. 음(`NoteBlock`)은 핸들러를 받지 않아 `memo`로
 * 선택·미리보기가 바뀐 음만 다시 그린다. 미리보기 중인 음은 원래 키 그대로 미리보기 위치에 그린다.
 */
export const NoteGrid = memo(function NoteGrid({
  song,
  clip,
  instrument,
  lo,
  hi,
  unit,
  selection,
  preview,
  editable,
  handlers,
  onViewRender,
  onNoteRender,
}: NoteGridProps) {
  useEffect(() => {
    onViewRender?.();
  });

  const notes = clip.body.type === "notes" ? clip.body.notes : [];
  const { timeSignature } = song;
  const background = `${gridBackground(unit, ticksPerBeat(timeSignature), timeSignature[0])}, ${ROW_LINES_BACKGROUND}`;
  const selected = new Set(selection);

  // 같은 (start, pitch)가 둘인 손으로 고친 곡에서도 React 키가 겹치지 않게 한다. 키로 가리키는
  // 편집(선택·미리보기)은 첫 음만 다룬다(`lib/score/notes.ts`와 같다).
  const seen = new Map<string, number>();

  return (
    <div
      data-testid="roll-grid"
      className="absolute inset-0 touch-none select-none"
      style={{ background }}
      {...handlers}
    >
      {chordSegmentsInClip(song, clip).map((seg, index) => {
        const tones = new Set(chordToneRows(seg.chord));
        const rows: number[] = [];
        for (let pitch = hi; pitch >= lo; pitch--) {
          if (tones.has(pitch % 12)) rows.push(pitch);
        }
        return rows.map((pitch) => (
          <div
            key={`${index}:${pitch}`}
            aria-hidden
            data-chord-tone={pitch}
            data-chord-segment={index}
            className="pointer-events-none absolute bg-white/[0.045]"
            style={{
              left: rollTickToX(seg.start),
              width: rollTickToX(seg.length),
              top: pitchToY(pitch, hi),
              height: ROW_HEIGHT,
            }}
          />
        ));
      })}
      {notes.map((note) => {
        const base = noteKey(note);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const first = n === 0;
        const shown = first ? preview?.notes.get(base) : undefined;
        return (
          <NoteBlock
            key={first ? base : `${base}#${n}`}
            id={base}
            note={shown ?? note}
            clipStart={clip.start}
            timeSignature={timeSignature}
            instrument={instrument}
            hi={hi}
            selected={first && selected.has(base)}
            dragging={shown !== undefined}
            editable={editable}
            onRender={onNoteRender}
          />
        );
      })}
    </div>
  );
});
