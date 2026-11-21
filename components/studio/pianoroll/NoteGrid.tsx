"use client";

import { memo, useEffect } from "react";

import { chordLabel } from "@/lib/score/chords";
import type { Clip, Note, Song } from "@/lib/score/model";
import { noteKey, type ChordalInstrument, type GridUnit } from "@/lib/score/notes";
import { ticksPerBeat, ticksToBarBeat } from "@/lib/score/time";

import { INSTRUMENT_TILE } from "../instruments";
import { ROW_DIVIDER } from "../layout";
import {
  ROLL_CHORD_STRIP_HEIGHT,
  ROW_HEIGHT,
  ROW_LINES_BACKGROUND,
  chordSegmentsInClip,
  chordToneRows,
  gridBackground,
  lengthLabel,
  noteName,
  noteRect,
  pitchToY,
  rollTickToX,
} from "./geometry";

/**
 * 음 하나. 아직 읽기 전용이다(Task 4가 선택·이동·길이 조작을 붙인다). 실제 `<button>`이고 이름은
 * "C4, 3마디 1박, 길이 1/8" — 마디·박은 클립이 아니라 **곡** 시작 기준이다.
 */
export function NoteBlock({
  note,
  clipStart,
  timeSignature,
  instrument,
  hi,
  selected = false,
}: {
  note: Note;
  clipStart: number;
  timeSignature: Song["timeSignature"];
  instrument: ChordalInstrument;
  hi: number;
  selected?: boolean;
}) {
  const { bar, beat } = ticksToBarBeat(clipStart + note.start, timeSignature);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${noteName(note.pitch)}, ${bar}마디 ${beat}박, 길이 ${lengthLabel(note.length)}`}
      data-note-key={noteKey(note)}
      className={`absolute box-border overflow-hidden rounded-sm border ${INSTRUMENT_TILE[instrument]} ${
        selected ? "ring-1 ring-zinc-300" : ""
      }`}
      style={noteRect(note, hi)}
    />
  );
}

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
  /** 테스트용: 이 격자가 커밋(렌더 결과 반영)될 때마다 부른다. 안정된 함수를 넘긴다. */
  onViewRender?: () => void;
}

/**
 * 음 격자. 세로 격자선(마디·박·선택한 단위)과 행 구분선은 CSS 배경이라 DOM 요소가 아니다. 그
 * 위에 코드 구성음 행 색칠(코드 띠 구간 단위 레이어)과 음이 있다. 플레이헤드는 이 안에 두지 않는다
 * (재생 중 이 컴포넌트가 다시 그려지면 안 된다) — `memo`라서 10Hz 위치 표본에는 반응하지 않는다.
 */
export const NoteGrid = memo(function NoteGrid({
  song,
  clip,
  instrument,
  lo,
  hi,
  unit,
  onViewRender,
}: NoteGridProps) {
  useEffect(() => {
    onViewRender?.();
  });

  const notes = clip.body.type === "notes" ? clip.body.notes : [];
  const { timeSignature } = song;
  const background = `${gridBackground(unit, ticksPerBeat(timeSignature), timeSignature[0])}, ${ROW_LINES_BACKGROUND}`;

  // 같은 (start, pitch)가 둘인 손으로 고친 곡에서도 React 키가 겹치지 않게 한다.
  const seen = new Map<string, number>();

  return (
    <div
      data-testid="roll-grid"
      className="absolute inset-0"
      style={{ background }}
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
        return (
          <NoteBlock
            key={n === 0 ? base : `${base}#${n}`}
            note={note}
            clipStart={clip.start}
            timeSignature={timeSignature}
            instrument={instrument}
            hi={hi}
          />
        );
      })}
    </div>
  );
});
