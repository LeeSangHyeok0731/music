"use client";

import {
  memo,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { Song } from "@/lib/score/model";
import type { Selection, StudioEdits } from "@/state/types";
import { useStudio } from "@/state/useStudio";

import { ClipBlock } from "./ClipBlock";
import { PatternPopover } from "./PatternPopover";
import { ROW_DIVIDER, TRACK_LANE_HEIGHT } from "./layout";
import { hasOpenPopover, popoverPosition } from "./popover";
import {
  findClip,
  laneTickFromPointer,
  movedPastThreshold,
  planAddClip,
  useClipDrag,
} from "./useClipDrag";

interface OpenPopover {
  clipId: string;
  anchor: HTMLElement;
  position: { left: number; top: number };
}

interface PendingAdd {
  pointerId: number;
  x: number;
  y: number;
  /** 누른 자리의 곡 틱. 놓을 때의 위치가 아니라 누른 위치에 추가한다. */
  tick: number;
  /** Shift를 누르고 눌렀다: 패턴 클립 대신 빈 음 클립을 만든다(화음 악기만). */
  shift: boolean;
}

interface TrackLaneViewProps {
  song: Song;
  trackId: string;
  editable: boolean;
  /** 이 트랙에서 선택된 클립 id(다른 트랙이면 null). 객체 대신 문자열이라 memo가 유지된다. */
  selectedClipId: string | null;
  edit: Pick<
    StudioEdits,
    | "addClip"
    | "moveClip"
    | "resizeClip"
    | "removeClip"
    | "setClipPattern"
    | "setTrackPattern"
    | "bakeClipToNotes"
    | "emptyNotesClip"
  >;
  select(selection: Selection): void;
  /** 피아노롤을 연다. `opener`는 닫을 때 포커스를 돌려받을 요소. 없으면 열지 않는다(레인만 단독으로 쓰는 경우). */
  onOpenRoll?(trackId: string, clipId: string, opener: HTMLElement): void;
  /** 테스트용: 이 뷰가 커밋(렌더 결과 반영)될 때마다 부른다. */
  onViewRender?: () => void;
}

/**
 * 렌더 비용을 지키려고 `TrackLane`과 나눴다(`ChordLane`과 같은 구조). 컨텍스트 값은 10Hz
 * 재생 위치가 바뀔 때마다 새로워지지만, 이 뷰는 곡·편집 가능 여부·선택·(안정된) 함수만
 * props로 받고 `memo`라서 위치 변화에는 다시 그려지지 않는다.
 */
const TrackLaneView = memo(function TrackLaneView({
  song,
  trackId,
  editable,
  selectedClipId,
  edit,
  select,
  onOpenRoll,
  onViewRender,
}: TrackLaneViewProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingAddRef = useRef<PendingAdd | null>(null);
  const [open, setOpen] = useState<OpenPopover | null>(null);

  useEffect(() => {
    onViewRender?.();
  });

  const track = song.tracks.find((t) => t.id === trackId);

  const openClip = open ? findClip(song, trackId, open.clipId) : undefined;
  // 팝오버는 편집 가능한 동안, 그 클립이 패턴 클립으로 있을 때만 유지한다
  // (재생 시작·실행취소·삭제로 사라지면 닫는다).
  if (open && (!editable || openClip?.body.type !== "pattern")) setOpen(null);
  const openPattern =
    open && editable && openClip?.body.type === "pattern"
      ? openClip.body.pattern
      : null;

  const closePopover = (returnFocus: boolean) => {
    const clipId = open?.clipId;
    setOpen(null);
    if (returnFocus && clipId !== undefined) {
      buttonRefs.current.get(clipId)?.focus({ preventScroll: true });
    }
  };

  // 팝오버의 두 버튼: 클립을 음 클립으로 바꾸고 팝오버를 닫은 다음(포커스는 클립 본문으로)
  // 피아노롤을 연다. 팝오버 버튼은 곧 사라지므로 포커스를 돌려받을 요소는 클립 본문(앵커)이다.
  const openRollFromPopover = (
    from: OpenPopover,
    convert: (trackId: string, clipId: string) => void,
  ) => {
    convert(trackId, from.clipId);
    closePopover(true);
    onOpenRoll?.(trackId, from.clipId, from.anchor);
  };

  const { clips, dragging, bindBody, bindHandle } = useClipDrag({
    song,
    trackId,
    editable,
    onDragStart(clipId) {
      select({ trackId, clipId });
      setOpen(null);
    },
    onClick(clipId, button) {
      if (!editable) return;
      select({ trackId, clipId });
      const clip = findClip(song, trackId, clipId);
      if (clip?.body.type !== "pattern") {
        setOpen(null);
        return;
      }
      if (open?.clipId === clipId) {
        closePopover(true);
        return;
      }
      setOpen({
        clipId,
        anchor: button,
        position: popoverPosition(
          button.getBoundingClientRect(),
          window.innerWidth,
        ),
      });
    },
    onMove: (clipId, start) => edit.moveClip(trackId, clipId, start),
    onResize: (clipId, length) => edit.resizeClip(trackId, clipId, length),
  });

  if (!track) return null;

  // 빈 곳 클릭 = 레인 배경에서 누르고 5px 안에서 놓는다. 클립·핸들 위에서 시작한 누름은
  // 대상이 레인이 아니라서 여기서 걸러진다.
  const onLaneDown = (e: ReactPointerEvent<HTMLElement>) => {
    pendingAddRef.current = null;
    // 팝오버가 열려 있으면(이 레인의 것이든 다른 레인·코드 레인의 것이든) 이 누름은
    // 팝오버를 닫는 것이지 클립을 추가하는 게 아니다. 닫기는 document 리스너가 하고 React의
    // 루트 핸들러가 먼저 오므로, 아직 열려 있는 팝오버 수를 동기적으로 읽는다.
    if (hasOpenPopover()) return;
    if (!editable || e.button !== 0 || e.target !== e.currentTarget) return;
    if (!Number.isFinite(e.clientY)) return;
    const lane = laneRef.current;
    if (!lane) return;
    // 레인의 화면 left가 이미 가로 스크롤을 반영한다 — scrollLeft를 또 더하지 않는다.
    const tick = laneTickFromPointer(
      e.clientX,
      lane.getBoundingClientRect().left,
    );
    if (tick === null) return;
    pendingAddRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      tick,
      shift: e.shiftKey,
    };
  };
  // 지운 클립 다음(없으면 이전) 클립 본문으로 포커스를 옮겨 키보드 포커스를 잃지 않게 한다.
  const deleteClip = (clipId: string) => {
    const clipsNow = track.clips;
    const at = clipsNow.findIndex((c) => c.id === clipId);
    const neighbour = clipsNow[at + 1] ?? clipsNow[at - 1];
    if (neighbour) {
      buttonRefs.current.get(neighbour.id)?.focus({ preventScroll: true });
    }
    edit.removeClip(trackId, clipId);
  };
  const onLaneUp = (e: ReactPointerEvent<HTMLElement>) => {
    const pending = pendingAddRef.current;
    if (!pending || pending.pointerId !== e.pointerId) return;
    pendingAddRef.current = null;
    if (!editable || e.target !== e.currentTarget) return;
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    if (movedPastThreshold(e.clientX - pending.x, e.clientY - pending.y)) {
      return;
    }
    const clipId = planAddClip(song, trackId, pending.tick);
    if (clipId === null) return;
    edit.addClip(trackId, pending.tick);
    // Shift+클릭: 같은 자리를 빈 음 클립으로 바꾼다(기록은 두 칸이다 — 되돌리기 한 번은 패턴 클립까지).
    if (pending.shift && track.instrument !== "drums") {
      edit.emptyNotesClip(trackId, clipId);
    }
    select({ trackId, clipId });
  };

  return (
    <div
      ref={laneRef}
      data-testid={`track-lane-${trackId}`}
      className="relative"
      style={{ height: TRACK_LANE_HEIGHT, boxShadow: ROW_DIVIDER }}
      onPointerDown={onLaneDown}
      onPointerUp={onLaneUp}
      onPointerCancel={() => {
        pendingAddRef.current = null;
      }}
    >
      {clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          instrument={track.instrument}
          selected={clip.id === selectedClipId}
          expanded={openPattern !== null && open?.clipId === clip.id}
          editable={editable}
          dragging={dragging?.clipId === clip.id}
          body={bindBody(clip.id)}
          handle={bindHandle(clip.id)}
          onEdit={
            onOpenRoll && clip.body.type === "notes" && track.instrument !== "drums"
              ? (opener) => onOpenRoll(trackId, clip.id, opener)
              : undefined
          }
          buttonRef={(el) => {
            if (el) buttonRefs.current.set(clip.id, el);
            else buttonRefs.current.delete(clip.id);
          }}
          onDelete={() => deleteClip(clip.id)}
        />
      ))}
      {open && openPattern !== null && (
        <PatternPopover
          key={open.clipId}
          anchor={open.anchor}
          position={open.position}
          instrument={track.instrument}
          current={openPattern}
          onPickClip={(id) => edit.setClipPattern(trackId, open.clipId, id)}
          onPickTrack={(id) => edit.setTrackPattern(trackId, id)}
          onBake={() => openRollFromPopover(open, edit.bakeClipToNotes)}
          onEmpty={() => openRollFromPopover(open, edit.emptyNotesClip)}
          onClose={closePopover}
        />
      )}
    </div>
  );
});

/** 트랙 한 줄. `data-testid="track-lane-<id>"`가 타임라인 안의 한 행이다. */
export function TrackLane({
  trackId,
  onOpenRoll,
  onViewRender,
}: {
  trackId: string;
  /** `Studio`가 내려주는 안정된 콜백. */
  onOpenRoll?: TrackLaneViewProps["onOpenRoll"];
  onViewRender?: () => void;
}) {
  const { song, editable, edit, selection, select } = useStudio();
  return (
    <TrackLaneView
      song={song}
      trackId={trackId}
      editable={editable}
      selectedClipId={selection?.trackId === trackId ? selection.clipId : null}
      edit={edit}
      select={select}
      onOpenRoll={onOpenRoll}
      onViewRender={onViewRender}
    />
  );
}
