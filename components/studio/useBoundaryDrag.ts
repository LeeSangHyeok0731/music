"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { moveBoundary } from "@/lib/score/edit";
import type { ChordSegment, Song } from "@/lib/score/model";

import { pointerToTick } from "./geometry";

/**
 * 코드 경계 드래그의 순수 부분. 규칙(스냅·클램프)은 `lib/score/edit.ts`의
 * `moveBoundary`가 갖고 있고, 여기는 포인터 → 틱 변환과 미리보기만 한다.
 */

/**
 * 포인터의 화면 x를 곡 틱으로. `laneLeft`는 레인 요소의 `getBoundingClientRect().left`다 —
 * 이미 가로 스크롤을 반영하므로 `scrollLeft`를 또 더하지 않는다. 유한하지 않으면 null.
 */
export function boundaryTickFromPointer(
  clientX: number,
  laneLeft: number,
): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(laneLeft)) return null;
  const tick = pointerToTick(clientX, laneLeft, 0);
  return Number.isFinite(tick) ? tick : null;
}

/**
 * 경계 `index`를 `tick`으로 옮긴 미리보기 곡. 바뀌는 게 없거나 편집 함수가 거절하면
 * (`RangeError`) 원본과 **같은 참조**를 돌려준다.
 */
export function previewBoundary(
  original: Song,
  index: number,
  tick: number,
): Song {
  try {
    return moveBoundary(original, index, tick);
  } catch {
    return original;
  }
}

interface ActiveDrag {
  index: number;
  pointerId: number;
  original: Song;
  tick: number;
  target: Element;
}

interface PreviewState {
  index: number;
  original: Song;
  tick: number;
}

export interface BoundaryHandleProps {
  onPointerDown(e: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(e: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(e: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(e: ReactPointerEvent<HTMLElement>): void;
  onLostPointerCapture(e: ReactPointerEvent<HTMLElement>): void;
}

export interface UseBoundaryDragOptions {
  song: Song;
  editable: boolean;
  /** 레인 요소. 틱 계산이 이 요소의 화면상 left를 기준으로 한다. */
  laneRef: RefObject<HTMLElement | null>;
  /** 놓을 때 한 번, 미리보기가 원본과 다를 때만. `tick`은 스냅 전 값이다. */
  onCommit(index: number, tick: number): void;
}

function releaseCapture(target: Element, pointerId: number) {
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // 이미 풀렸거나 요소가 떨어졌다.
  }
}

/**
 * 경계 핸들 드래그. 드래그 중에는 곡을 바꾸지 않고 `progression`(미리보기)만 돌려주며,
 * 놓을 때 `onCommit`을 한 번 부른다. `pointercancel`·`lostpointercapture`(놓기 없이)·
 * `Esc`·편집 불가로의 전환은 커밋 없이 취소한다.
 *
 * 쓰는 법: 핸들마다 `{...bind(index)}`를 펼친다.
 */
export function useBoundaryDrag({
  song,
  editable,
  laneRef,
  onCommit,
}: UseBoundaryDragOptions) {
  // 핸들러가 읽는 진실은 ref(같은 틱의 연속 이벤트에도 정확), 렌더용 미리보기는 state.
  const activeRef = useRef<ActiveDrag | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const cancel = useCallback(() => {
    const active = activeRef.current;
    activeRef.current = null;
    if (active) releaseCapture(active.target, active.pointerId);
    setPreview(null);
  }, []);

  // 드래그 중 편집 불가가 되면(재생 시작) 미리보기를 지운다.
  if (preview && !editable) setPreview(null);
  useEffect(() => {
    if (editable) return;
    const active = activeRef.current;
    activeRef.current = null;
    if (active) releaseCapture(active.target, active.pointerId);
  }, [editable]);

  const dragging = preview !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dragging, cancel]);

  const tickOf = (e: ReactPointerEvent<HTMLElement>): number | null => {
    const lane = laneRef.current;
    if (!lane) return null;
    return boundaryTickFromPointer(
      e.clientX,
      lane.getBoundingClientRect().left,
    );
  };

  const bind = (index: number): BoundaryHandleProps => ({
    onPointerDown(e) {
      if (!editable || e.button !== 0 || activeRef.current) return;
      if (tickOf(e) === null) return;
      const original = song;
      const start = original.progression[index + 1]?.start;
      if (start === undefined) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // 캡처 없이 시작하면 요소 밖으로 나가는 순간 move·up이 끊겨 드래그가 굳는다.
        // 시작하지 않는다(activeRef도 만들지 않으므로 다음 pointerdown이 바로 동작한다).
        return;
      }
      e.preventDefault();
      activeRef.current = {
        index,
        pointerId: e.pointerId,
        original,
        tick: start,
        target: e.currentTarget,
      };
      setPreview({ index, original, tick: start });
    },
    onPointerMove(e) {
      const active = activeRef.current;
      if (!active || e.pointerId !== active.pointerId) return;
      const tick = tickOf(e);
      if (tick === null || tick === active.tick) return;
      active.tick = tick;
      setPreview({ index: active.index, original: active.original, tick });
    },
    onPointerUp(e) {
      const active = activeRef.current;
      if (!active || e.pointerId !== active.pointerId) return;
      activeRef.current = null;
      releaseCapture(active.target, active.pointerId);
      setPreview(null);
      // 마지막 미리보기 틱을 커밋한다 — 사용자가 본 것과 같은 값. up 이벤트 자신의 x는
      // 마지막 move와 어긋날 수 있어(브라우저가 move를 합치거나 up 좌표가 다를 때)
      // 쓰면 화면에 없던 위치로 커밋된다.
      const tick = active.tick;
      if (
        previewBoundary(active.original, active.index, tick) !== active.original
      ) {
        onCommit(active.index, tick);
      }
    },
    onPointerCancel(e) {
      if (activeRef.current?.pointerId === e.pointerId) cancel();
    },
    onLostPointerCapture(e) {
      if (activeRef.current?.pointerId === e.pointerId) cancel();
    },
  });

  const progression: ChordSegment[] =
    preview && editable
      ? previewBoundary(preview.original, preview.index, preview.tick)
          .progression
      : song.progression;

  return { progression, bind };
}
