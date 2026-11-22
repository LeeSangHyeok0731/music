"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { Clip } from "@/lib/score/model";
import { displayRange, type GridUnit, type NoteKey } from "@/lib/score/notes";
import { ticksToBarBeat } from "@/lib/score/time";
import { useStudio } from "@/state/useStudio";

import { Playhead } from "../Playhead";
import { hasActiveGesture } from "../gestures";
import { INSTRUMENT_LABEL } from "../instruments";
import { useModalOpenCount } from "../modal";
import { KeyColumn } from "./KeyColumn";
import { NoteGrid, RollChordStrip } from "./NoteGrid";
import { RollHeader } from "./RollHeader";
import { SelectionBox } from "./SelectionBox";
import { VelocityLane } from "./VelocityLane";
import {
  KEY_COLUMN_WIDTH,
  ROLL_CHORD_STRIP_HEIGHT,
  ROW_HEIGHT,
  initialScrollTop,
  rollTickToX,
} from "./geometry";
import { useFocusTrap } from "./useFocusTrap";
import { liveSelection, useNoteGestures } from "./useNoteGestures";
import { useNoteKeys } from "./useNoteKeys";

export interface PianoRollProps {
  trackId: string;
  clipId: string;
  onClose(): void;
  /**
   * 모달을 연 요소(편집 버튼·클립 본문). 닫을 때 포커스를 돌려준다. 문서에서 떨어졌으면(팝오버
   * 버튼처럼) 클립 본문 버튼으로 돌려준다.
   */
  opener?: HTMLElement | null;
  /** 테스트용: 격자와 코드 띠(둘 다 memo)가 커밋될 때마다 부른다. 재생 위치 갱신에는 불리지 않아야 한다. */
  onGridRender?: () => void;
  /** 테스트용: 음 하나가 커밋될 때마다 그 음의 키로 부른다. */
  onNoteRender?: (key: NoteKey) => void;
}

const NO_NOTES: never[] = [];
const NO_KEYS: readonly NoteKey[] = [];

/** 클립 타일의 본문 버튼(`ClipBlock`의 `data-clip-id` 래퍼 안 첫 버튼). */
function clipBodyButton(clipId: string): HTMLElement | null {
  for (const tile of document.querySelectorAll("[data-clip-id]")) {
    if (tile.getAttribute("data-clip-id") === clipId) {
      return tile.querySelector<HTMLElement>("button");
    }
  }
  return null;
}

/**
 * 음 클립 편집 모달(화면 전체). `document.body`로 포털하고, 열려 있는 동안 `useModalOpenCount`로
 * 전역 단축키에 알린다. 음 조작(추가·선택·박스·이동·길이)은 `useNoteGestures`가 격자에 붙인다.
 *
 * - 음 선택(`NoteKey` 목록)은 이 모달의 지역 상태다. 곡이 바뀌어(되돌리기 등) 사라진 키는 렌더 때
 *   파생으로 걸러 낸다. 모달이 닫히면(언마운트) 사라진다.
 * - 닫기: `← 돌아가기`, Esc. Esc는 `document` **캡처 단계**에서 처리하고 `preventDefault`로 표시한다.
 *   한 번의 Esc는 한 겹만: 이미 처리된 Esc(`defaultPrevented`)나 진행 중 제스처(`hasActiveGesture`)가
 *   있으면 건너뛰고(제스처 훅이 자기 취소에 쓴다), 선택이 있으면 선택만 풀고, 없으면 닫는다.
 * - 포커스: 열릴 때 격자 스크롤 영역(탭 가능)으로, 안에 가둔다. 닫으면 연 요소로 돌려준다.
 *   첫 포커스를 닫기 버튼에 두지 않는 건, 키보드로 연 직후 Space(재생)가 포커스된 버튼의 클릭이 되어
 *   모달을 닫아 버리기 때문이다.
 * - 재생 중·재생 대기 중에도 열려 있고(헤더에 알림), 편집만 막힌다.
 * - 스크롤은 격자 영역 하나가 소유한다(가로·세로). 건반 열·코드 띠·세기 레인은 그 안의 `sticky`다
 *   (세기 레인은 아래쪽에 붙고, 가로 스크롤은 격자와 저절로 맞는다).
 * - 키보드 음 편집(`useNoteKeys`)과 세기 레인(`VelocityLane`)이 음 조작을 마저 맡는다.
 * - 렌더 비용: 이 컴포넌트는 `useStudio()` 전체를 읽으므로 10Hz 위치 표본마다 함께 다시 렌더된다
 *   (함수 본문과 헤더). 무거운 자식인 격자(`NoteGrid`)·건반(`KeyColumn`)·코드 띠(`RollChordStrip`)는
 *   `memo`에 안정된 props만 받아 다시 그려지지 않고, 플레이헤드는 rAF로 transform만 쓴다.
 */
export function PianoRoll({
  trackId,
  clipId,
  onClose,
  opener,
  onGridRender,
  onNoteRender,
}: PianoRollProps) {
  const { song, playing, getEngine, editable, edit } = useStudio();
  useModalOpenCount(true);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [unit, setUnit] = useState<GridUnit>("1/8");

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const track = song.tracks.find((t) => t.id === trackId);
  const clip: Clip | undefined = track?.clips.find((c) => c.id === clipId);
  const instrument =
    track && track.instrument !== "drums" ? track.instrument : null;
  const notes = clip?.body.type === "notes" ? clip.body.notes : NO_NOTES;
  const range = instrument ? displayRange(instrument, notes) : null;

  const [rawSelection, setSelection] = useState<readonly NoteKey[]>(NO_KEYS);
  // 곡에 없는 키(되돌리기로 사라진 음 등)는 거른다. 바뀐 게 없으면 같은 배열이라 격자 memo가 유지된다.
  const selection = useMemo(
    () =>
      liveSelection(
        clip?.body.type === "notes" ? clip.body.notes : NO_NOTES,
        rawSelection,
      ),
    [clip, rawSelection],
  );
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  });

  const gestures = useNoteGestures({
    song,
    trackId,
    clipId,
    editable,
    unit,
    hi: range?.hi ?? 0,
    selection,
    setSelection,
    edit: edit.notes,
  });

  useNoteKeys({
    song,
    trackId,
    clipId,
    editable,
    unit,
    selection,
    setSelection,
    edit: edit.notes,
    scrollRef,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      if (hasActiveGesture()) return;
      e.preventDefault();
      if (selectionRef.current.length > 0) {
        setSelection(NO_KEYS);
        return;
      }
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useFocusTrap(rootRef, {
    initialFocusRef: scrollRef,
    returnFocus: () =>
      opener?.isConnected ? opener : clipBodyButton(clipId),
  });

  // 처음 열 때 한 번만 세로 스크롤을 맞춘다(음 범위 가운데, 음이 없으면 C4 근처).
  const initial = useRef({ notes, hi: range?.hi ?? 0 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { notes: first, hi } = initial.current;
    el.scrollTop = initialScrollTop(first, hi, el.clientHeight);
  }, []);

  // Studio가 먼저 걸러 주지만, 곡에 없는 클립이거나 드럼·패턴 클립이면 그리지 않는다.
  if (!track || !clip || !instrument || !range || clip.body.type !== "notes") {
    return null;
  }

  const startBar = ticksToBarBeat(clip.start, song.timeSignature).bar;
  const endBar = ticksToBarBeat(
    clip.start + clip.length - 1,
    song.timeSignature,
  ).bar;
  const gridWidth = rollTickToX(clip.length);
  const gridHeight = (range.hi - range.lo + 1) * ROW_HEIGHT;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="피아노롤"
      className="fixed inset-0 z-50 flex flex-col bg-[#0b0c0f] text-zinc-200"
    >
      <RollHeader
        title={`${INSTRUMENT_LABEL[instrument]} · ${startBar}~${endBar}마디`}
        unit={unit}
        onUnitChange={setUnit}
        onClose={() => onCloseRef.current()}
      />
      <div
        ref={scrollRef}
        tabIndex={0}
        role="group"
        aria-label="음 격자"
        data-testid="roll-scroll"
        className="timeline-scroll min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 focus-visible:ring-inset"
      >
        <div
          className="flex min-h-full flex-col"
          style={{ width: KEY_COLUMN_WIDTH + gridWidth }}
        >
          <div
            className="sticky top-0 z-40 flex shrink-0"
            style={{ height: ROLL_CHORD_STRIP_HEIGHT }}
          >
            <div
              aria-hidden
              className="sticky left-0 z-10 shrink-0 border-r border-white/10 bg-[#141519]"
              style={{ width: KEY_COLUMN_WIDTH }}
            />
            <RollChordStrip
              song={song}
              clip={clip}
              onViewRender={onGridRender}
            />
          </div>
          <div className="flex shrink-0">
            <KeyColumn lo={range.lo} hi={range.hi} />
            <div
              className="relative shrink-0"
              style={{ width: gridWidth, height: gridHeight }}
            >
              <NoteGrid
                song={song}
                clip={clip}
                instrument={instrument}
                lo={range.lo}
                hi={range.hi}
                unit={unit}
                selection={selection}
                preview={gestures.preview}
                editable={editable}
                handlers={gestures.handlers}
                onViewRender={onGridRender}
                onNoteRender={onNoteRender}
              />
              {gestures.box && <SelectionBox box={gestures.box} />}
              <Playhead
                engine={getEngine()}
                playing={playing}
                lengthTicks={clip.length}
                offsetTick={clip.start}
                toX={rollTickToX}
              />
            </div>
          </div>
          <VelocityLane
            trackId={trackId}
            clipId={clipId}
            clip={clip}
            instrument={instrument}
            selection={selection}
            editable={editable}
            edit={edit.notes}
            width={gridWidth}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
