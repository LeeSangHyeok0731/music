"use client";

import { memo, useEffect, useRef, useState } from "react";

import { chordLabel } from "@/lib/score/chords";
import type { Chord, Song } from "@/lib/score/model";
import type { StudioEdits } from "@/state/types";
import { useStudio } from "@/state/useStudio";

import { ChordPopover } from "./ChordPopover";
import { clipRect, tickToX } from "./geometry";
import { CHORD_LANE_HEIGHT, ROW_DIVIDER } from "./layout";
import { popoverPosition } from "./popover";
import { useBoundaryDrag } from "./useBoundaryDrag";

const HANDLE_WIDTH = 8;

interface OpenPopover {
  index: number;
  anchor: HTMLElement;
  position: { left: number; top: number };
}

interface ChordLaneViewProps {
  song: Song;
  editable: boolean;
  edit: Pick<
    StudioEdits,
    "setChord" | "splitSegment" | "moveBoundary" | "mergeSegments"
  >;
  /** 테스트용: 이 뷰가 커밋(렌더 결과 반영)될 때마다 부른다. */
  onViewRender?: () => void;
}

/**
 * 렌더 비용을 지키려고 `ChordLane`과 나눴다. `useStudio()`의 값은 10Hz 재생 위치가
 * 바뀔 때마다 새로워지지만, 이 뷰는 곡·편집 가능 여부·(안정된) 편집 함수만 props로 받고
 * `memo`라서 위치 변화에는 다시 그려지지 않는다.
 */
const ChordLaneView = memo(function ChordLaneView({
  song,
  editable,
  edit,
  onViewRender,
}: ChordLaneViewProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState<OpenPopover | null>(null);

  useEffect(() => {
    onViewRender?.();
  });

  const { progression, bind } = useBoundaryDrag({
    song,
    editable,
    laneRef,
    onCommit: edit.moveBoundary,
  });

  // 팝오버는 편집 가능한 동안, 그 구간이 있을 때만 유지한다(재생 시작·실행취소로 사라지면 닫는다).
  if (open && (!editable || !song.progression[open.index])) setOpen(null);
  const openSegment =
    open && editable ? song.progression[open.index] : undefined;

  const close = (returnFocus: boolean) => {
    const index = open?.index;
    setOpen(null);
    if (returnFocus && index !== undefined) {
      segmentRefs.current[index]?.focus({ preventScroll: true });
    }
  };

  const toggle = (index: number, button: HTMLButtonElement) => {
    if (!editable) return;
    if (open?.index === index) {
      close(true);
      return;
    }
    const rect = button.getBoundingClientRect();
    setOpen({
      index,
      anchor: button,
      position: popoverPosition(rect, window.innerWidth),
    });
  };

  const change = (chord: Chord) => {
    if (open) edit.setChord(open.index, chord);
  };

  return (
    <div
      ref={laneRef}
      data-testid="chord-lane"
      className="relative"
      style={{ height: CHORD_LANE_HEIGHT, boxShadow: ROW_DIVIDER }}
    >
      {progression.map((seg, i) => {
        const { left, width } = clipRect(seg.start, seg.length);
        const isOpen = open?.index === i && openSegment !== undefined;
        return (
          <button
            key={i}
            ref={(el) => {
              segmentRefs.current[i] = el;
            }}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-disabled={editable ? undefined : true}
            className={`absolute top-1 bottom-1 box-border overflow-hidden rounded border border-white/10 bg-white/5 px-2 text-left text-sm text-nowrap text-zinc-200 hover:bg-white/10 ${
              isOpen ? "ring-1 ring-zinc-400" : ""
            }`}
            style={{ left, width }}
            onClick={(e) => toggle(i, e.currentTarget)}
          >
            {chordLabel(seg.chord)}
          </button>
        );
      })}
      {progression.slice(1).map((seg, i) => (
        <div
          key={i}
          role="separator"
          aria-orientation="vertical"
          aria-label={`코드 경계 ${i + 1}`}
          aria-disabled={editable ? undefined : true}
          className={`group absolute top-0 z-10 h-full touch-none ${
            editable ? "cursor-col-resize" : ""
          }`}
          style={{
            left: tickToX(seg.start) - HANDLE_WIDTH / 2,
            width: HANDLE_WIDTH,
          }}
          {...bind(i)}
        >
          <div
            aria-hidden
            className="mx-auto h-full w-0.5 bg-transparent group-hover:bg-zinc-400"
          />
        </div>
      ))}
      {open && openSegment && (
        <ChordPopover
          anchor={open.anchor}
          position={open.position}
          segment={openSegment}
          isLast={open.index === song.progression.length - 1}
          onChange={change}
          onSplit={() => {
            edit.splitSegment(openSegment.start + openSegment.length / 2);
            close(true);
          }}
          onMerge={() => {
            edit.mergeSegments(open.index);
            close(true);
          }}
          onClose={close}
        />
      )}
    </div>
  );
});

/** 코드 진행 레인. `data-testid="chord-lane"`이 타임라인 안의 한 행이다. */
export function ChordLane({ onViewRender }: { onViewRender?: () => void }) {
  const { song, editable, edit } = useStudio();
  return (
    <ChordLaneView
      song={song}
      editable={editable}
      edit={edit}
      onViewRender={onViewRender}
    />
  );
}
