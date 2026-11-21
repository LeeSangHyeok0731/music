"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { addClip, moveClip, resizeClip } from "@/lib/score/edit";
import type { Clip, Song } from "@/lib/score/model";

import { deltaTicks } from "./geometry";
import { boundaryTickFromPointer } from "./useBoundaryDrag";

/**
 * 클립 이동·길이 드래그와 클릭 판정. 규칙(스냅·이웃·곡 끝 클램프)은 `lib/score/edit.ts`의
 * 순수 함수가 갖고 있고, 여기는 포인터 → 틱 변환, 5px 임계값, 미리보기만 한다.
 */

/** 누른 자리에서 이 거리(px) 이상 움직이면 드래그, 안 움직이면 클릭이다. */
export const DRAG_THRESHOLD_PX = 5;

/** `dx`·`dy`(px) 이동이 클릭의 허용 범위를 넘었는가. 유한하지 않으면 아니다. */
export function movedPastThreshold(dx: number, dy: number): boolean {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/**
 * 포인터의 화면 x를 곡 틱으로(빈 곳 클릭의 추가 위치). `laneLeft`는 레인 요소의
 * `getBoundingClientRect().left`다 — 이미 가로 스크롤을 반영하므로 `scrollLeft`를 또
 * 더하지 않는다. 유한하지 않으면 null.
 */
export const laneTickFromPointer = boundaryTickFromPointer;

export function findClip(
  song: Song,
  trackId: string,
  clipId: string,
): Clip | undefined {
  return song.tracks
    .find((t) => t.id === trackId)
    ?.clips.find((c) => c.id === clipId);
}

/** 클립 `clipId`의 시작을 `startTick`으로 옮긴 미리보기 곡. 바뀌는 게 없거나 거절되면 원본 참조. */
export function previewMove(
  original: Song,
  trackId: string,
  clipId: string,
  startTick: number,
): Song {
  try {
    return moveClip(original, trackId, clipId, startTick);
  } catch {
    return original;
  }
}

/** 클립 `clipId`의 길이를 `lengthTicks`로 바꾼 미리보기 곡. 바뀌는 게 없거나 거절되면 원본 참조. */
export function previewResize(
  original: Song,
  trackId: string,
  clipId: string,
  lengthTicks: number,
): Song {
  try {
    return resizeClip(original, trackId, clipId, lengthTicks);
  } catch {
    return original;
  }
}

/**
 * `startTick`에 클립을 추가하면 생기는 새 클립의 id. 자리가 없어 `addClip`이 곡을 그대로
 * 돌려주면(또는 던지면) null. 실제 추가는 `edit.addClip`이 한다 — 이 함수는 호출 전에
 * "추가될지, 새 id가 무엇일지"만 묻는다.
 */
export function planAddClip(
  song: Song,
  trackId: string,
  startTick: number,
): string | null {
  let next: Song;
  try {
    next = addClip(song, trackId, startTick);
  } catch {
    return null;
  }
  if (next === song) return null;
  const before = new Set(
    song.tracks.find((t) => t.id === trackId)?.clips.map((c) => c.id),
  );
  const added = next.tracks
    .find((t) => t.id === trackId)
    ?.clips.find((c) => !before.has(c.id));
  return added?.id ?? null;
}

type DragKind = "move" | "resize";

interface Gesture {
  kind: DragKind;
  clipId: string;
  pointerId: number;
  startX: number;
  startY: number;
  original: Song;
  /** 누른 시점의 클립 `start`(이동) 또는 `length`(길이). */
  base: number;
  /** 마지막 미리보기 값(스냅 전). */
  value: number;
  dragging: boolean;
  target: Element;
}

interface PreviewState {
  kind: DragKind;
  clipId: string;
  original: Song;
  value: number;
}

function previewSong(p: PreviewState, trackId: string): Song {
  return p.kind === "move"
    ? previewMove(p.original, trackId, p.clipId, p.value)
    : previewResize(p.original, trackId, p.clipId, p.value);
}

function releaseCapture(target: Element, pointerId: number) {
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // 이미 풀렸거나 요소가 떨어졌다.
  }
}

export interface ClipHandleProps {
  onPointerDown(e: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(e: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(e: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(e: ReactPointerEvent<HTMLElement>): void;
  onLostPointerCapture(e: ReactPointerEvent<HTMLElement>): void;
}
export interface ClipBodyProps extends ClipHandleProps {
  /** 키보드(Enter·Space)로 누른 클릭. 마우스 클릭은 `pointerup`이 이미 처리했다. */
  onClick(e: ReactMouseEvent<HTMLElement>): void;
}

export interface UseClipDragOptions {
  song: Song;
  trackId: string;
  editable: boolean;
  /** 이동·길이 드래그가 임계값을 넘어 시작될 때(선택하고 팝오버를 닫는다). */
  onDragStart(clipId: string): void;
  /** 클릭(임계값 안에서 놓음, 또는 키보드). `button`은 누른 클립 버튼(팝오버의 앵커). */
  onClick(clipId: string, button: HTMLElement): void;
  /** 놓을 때 한 번, 미리보기가 원본과 다를 때만. `start`는 미리보기에서 본 그 값이다. */
  onMove(clipId: string, start: number): void;
  onResize(clipId: string, length: number): void;
}

/**
 * 한 트랙의 클립 제스처. 한 번에 제스처 하나만 있다.
 *
 * - 클립 본문: 누르고 5px 안에서 놓으면 클릭(`onClick`), 넘기면 이동 드래그.
 * - 오른쪽 핸들: 5px 넘기면 길이 드래그, 안 넘기고 놓으면 아무 일 없다.
 * - 드래그가 시작되면 포인터를 캡처하고(실패하면 제스처를 버린다) 곡은 건드리지 않은 채
 *   `clips`(미리보기)만 돌려주다가, 놓을 때 **마지막 미리보기 값**으로 커밋을 한 번 부른다.
 * - `pointercancel`·`lostpointercapture`(놓기 없이)·`Esc`·`editable` 거짓이 되면 커밋 없이 취소.
 *
 * 핸들러가 읽는 진실은 ref(같은 틱의 연속 이벤트에도 정확), 렌더용 미리보기는 state다.
 */
export function useClipDrag({
  song,
  trackId,
  editable,
  onDragStart,
  onClick,
  onMove,
  onResize,
}: UseClipDragOptions) {
  const activeRef = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // 포인터로 시작한 제스처 뒤에 브라우저가 따로 보내는 click(마우스는 detail > 0)을 한 번 삼킨다.
  // 클릭·드래그 결과는 이미 pointerup이 처리했다.
  const swallowClickRef = useRef(false);

  const cancel = useCallback(() => {
    const active = activeRef.current;
    activeRef.current = null;
    if (active?.dragging) releaseCapture(active.target, active.pointerId);
    setPreview(null);
  }, []);

  // 드래그 중 편집 불가가 되면(재생 시작) 미리보기를 지운다.
  if (preview && !editable) setPreview(null);
  useEffect(() => {
    if (editable) return;
    const active = activeRef.current;
    activeRef.current = null;
    if (active?.dragging) releaseCapture(active.target, active.pointerId);
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

  const bindGesture = (kind: DragKind, clipId: string): ClipHandleProps => ({
    onPointerDown(e) {
      swallowClickRef.current = false;
      if (!editable || e.button !== 0) return;
      if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
      // 캡처한 드래그는 건드리지 않는다. 캡처 전(놓은 자리가 클립 밖이라 up을 못 받은)
      // 묵은 제스처는 새로 누른 것이 대체한다.
      if (activeRef.current?.dragging) return;
      const clip = findClip(song, trackId, clipId);
      if (!clip) return;
      if (kind === "move") swallowClickRef.current = true;
      const base = kind === "move" ? clip.start : clip.length;
      activeRef.current = {
        kind,
        clipId,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        original: song,
        base,
        value: base,
        dragging: false,
        target: e.currentTarget,
      };
    },
    onPointerMove(e) {
      const active = activeRef.current;
      if (!active || e.pointerId !== active.pointerId) return;
      if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
      // 캡처 전에 포인터가 다른 클립 위로 지나가며 보내는 move는 누른 요소의 것이 아니다.
      if (!active.dragging && e.currentTarget !== active.target) return;
      if (!active.dragging) {
        if (
          !movedPastThreshold(
            e.clientX - active.startX,
            e.clientY - active.startY,
          )
        ) {
          return;
        }
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // 캡처 없이 끌면 요소 밖에서 move·up이 끊겨 굳는다. 제스처를 버린다.
          activeRef.current = null;
          return;
        }
        active.dragging = true;
        onDragStart(active.clipId);
      }
      const value = active.base + deltaTicks(active.startX, e.clientX);
      if (value === active.value && preview) return;
      active.value = value;
      setPreview({
        kind: active.kind,
        clipId: active.clipId,
        original: active.original,
        value,
      });
    },
    onPointerUp(e) {
      const active = activeRef.current;
      if (!active || e.pointerId !== active.pointerId) return;
      activeRef.current = null;
      if (!active.dragging) {
        if (active.kind === "move") onClick(active.clipId, e.currentTarget);
        return;
      }
      releaseCapture(active.target, active.pointerId);
      setPreview(null);
      // 마지막 미리보기 값을 커밋한다 — 사용자가 본 것과 같은 위치·길이.
      const result = previewSong(
        {
          kind: active.kind,
          clipId: active.clipId,
          original: active.original,
          value: active.value,
        },
        trackId,
      );
      if (result === active.original) return;
      const clip = findClip(result, trackId, active.clipId);
      if (!clip) return;
      if (active.kind === "move") onMove(active.clipId, clip.start);
      else onResize(active.clipId, clip.length);
    },
    onPointerCancel(e) {
      if (activeRef.current?.pointerId === e.pointerId) cancel();
    },
    onLostPointerCapture(e) {
      if (activeRef.current?.pointerId === e.pointerId) cancel();
    },
  });

  const bindBody = (clipId: string): ClipBodyProps => ({
    ...bindGesture("move", clipId),
    onClick(e) {
      if (!editable) return;
      if (e.detail > 0 && swallowClickRef.current) {
        swallowClickRef.current = false;
        return;
      }
      onClick(clipId, e.currentTarget);
    },
  });

  const bindHandle = (clipId: string): ClipHandleProps =>
    bindGesture("resize", clipId);

  const shown = preview && editable ? previewSong(preview, trackId) : song;
  const clips = shown.tracks.find((t) => t.id === trackId)?.clips ?? [];

  return {
    clips,
    dragging:
      preview && editable
        ? { clipId: preview.clipId, kind: preview.kind }
        : null,
    bindBody,
    bindHandle,
  };
}
