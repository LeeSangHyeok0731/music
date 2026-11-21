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
import { beginGesture } from "./gestures";
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
  /** 마지막 미리보기 결과(스냅·클램프 뒤 `start`/`length`). 커밋도 이 값이다. */
  result: number;
  /** 임계값을 넘어 드래그가 시작됐는가. */
  dragging: boolean;
  /** 눌린 요소. 캡처를 잡은 요소이자 클릭의 기준(본문 버튼 = 팝오버 앵커)이다. */
  target: HTMLElement;
  /** 진행 중 제스처 수(`gestures.ts`)에서 이 제스처를 거둔다. 끝나는 모든 경로에서 부른다. */
  release(): void;
}

interface PreviewState {
  kind: DragKind;
  clipId: string;
  original: Song;
  /** 스냅·클램프된 결과 값. */
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
  /** 클릭(임계값 안에서 놓음, 또는 키보드). `button`은 누른 클립 본문 버튼(팝오버의 앵커). */
  onClick(clipId: string, button: HTMLElement): void;
  /** 놓을 때 한 번, 미리보기가 원본과 다를 때만. `start`는 미리보기에서 본 그 값이다. */
  onMove(clipId: string, start: number): void;
  onResize(clipId: string, length: number): void;
}

/**
 * 한 트랙의 클립 제스처. 한 번에 제스처 하나만 있다.
 *
 * - **누르는 순간 그 요소에 포인터를 캡처한다**(실패하면 제스처를 만들지 않는다). 마우스는
 *   암묵적 캡처가 없어서, 5px 뒤에 잡으면 8px 핸들이나 클립 가장자리에서 빠르게 끌 때
 *   포인터가 이미 요소 밖이라 move·up을 못 받는다.
 * - 클릭인지 드래그인지는 놓을 때 정한다: 본문에서 5px 안에서 놓으면 클릭(`onClick`, 누른
 *   본문 버튼 기준), 핸들은 아무 일 없다. 5px을 넘으면 그때 드래그가 시작된다(`onDragStart`).
 * - 드래그 중에는 곡을 건드리지 않고 `clips`(미리보기)만 돌려주다가, 놓을 때 **마지막
 *   미리보기 값**으로 커밋을 한 번 부른다(원본과 다를 때만).
 * - 모든 종료 경로는 `activeRef`를 먼저 비운 뒤 캡처를 푼다(뒤따르는 `lostpointercapture`가
 *   no-op이 되도록). 취소: `pointercancel`·`lostpointercapture`(놓기 없이)·`Esc`·`editable`
 *   거짓·언마운트·마우스 버튼이 이미 떼어진 move(놓기를 놓친 유령 드래그).
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

  /** 제스처를 버린다(커밋 없음). ref를 먼저 비우고 캡처를 푼다. */
  const cancel = useCallback(() => {
    const active = activeRef.current;
    activeRef.current = null;
    if (active) {
      releaseCapture(active.target, active.pointerId);
      active.release();
    }
    setPreview(null);
  }, []);

  // 드래그 중 편집 불가가 되면(재생 시작) 미리보기를 지운다.
  if (preview && !editable) setPreview(null);
  useEffect(() => {
    if (editable) return;
    const active = activeRef.current;
    activeRef.current = null;
    if (active) {
      releaseCapture(active.target, active.pointerId);
      active.release();
    }
  }, [editable]);

  // 언마운트(클립이 사라지는 편집 포함)에서 남은 캡처를 푼다.
  useEffect(
    () => () => {
      const active = activeRef.current;
      activeRef.current = null;
      if (active) {
        releaseCapture(active.target, active.pointerId);
        active.release();
      }
    },
    [],
  );

  // 제스처 중인 클립이 곡에서 사라지면(실행취소·삭제) 제스처를 버린다.
  useEffect(() => {
    const active = activeRef.current;
    if (active && !findClip(song, trackId, active.clipId)) cancel();
  }, [song, trackId, cancel]);

  const dragging = preview !== null;
  useEffect(() => {
    if (!dragging) return;
    // 캡처 단계 + preventDefault: 이 Esc는 드래그 취소로 쓰였다는 표시다. 팝오버 닫기와
    // 선택 해제(`useShortcuts`, 버블 단계)가 같은 Esc에 또 반응하지 않게 한다. 마운트 순서와 무관.
    const onKeyDown = (e: KeyboardEvent) => {
      // 이미 처리된 Esc에는 반응하지 않는다(한 번의 Esc가 두 겹을 닫지 않게 하는 이중 안전장치).
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      cancel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [dragging, cancel]);

  const bindGesture = (kind: DragKind, clipId: string): ClipHandleProps => ({
    onPointerDown(e) {
      // 진행 중인 제스처가 있으면 삼킴 표시를 건드리지 않는다(두 번째 손가락·버튼의 누름이
      // 첫 제스처 뒤에 오는 click을 풀어 놓으면 안 된다).
      if (!activeRef.current) swallowClickRef.current = false;
      if (!editable || e.button !== 0) return;
      if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
      const clip = findClip(song, trackId, clipId);
      if (!clip) return;
      // 다른 포인터의 제스처가 진행 중이면 무시한다. 같은 포인터의 묵은 제스처(up·cancel을
      // 놓친)는 새로 누른 것이 대체한다.
      // 캡처한 요소가 사라졌다면(실행취소로 클립이 없어지는 등) 스펙상 lostpointercapture가
      // document로 가서 React가 못 받는다. 그 묵은 제스처는 버리고 새 누름을 받는다.
      if (activeRef.current && !activeRef.current.target.isConnected) cancel();
      const current = activeRef.current;
      if (current && current.pointerId !== e.pointerId) return;
      if (current) cancel();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // 캡처 없이 시작하면 요소 밖에서 move·up이 끊겨 굳는다. 제스처를 만들지 않는다.
        return;
      }
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
        result: base,
        dragging: false,
        target: e.currentTarget,
        release: beginGesture(),
      };
    },
    onPointerMove(e) {
      const active = activeRef.current;
      if (!active || e.pointerId !== active.pointerId) return;
      // 마우스 버튼이 이미 떼어졌다면 up을 놓친 것이다(창 밖 등). 호버를 드래그로 오인하지 않는다.
      if (e.pointerType === "mouse" && (e.buttons & 1) === 0) {
        cancel();
        return;
      }
      if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
      if (!active.dragging) {
        if (
          !movedPastThreshold(
            e.clientX - active.startX,
            e.clientY - active.startY,
          )
        ) {
          return;
        }
        active.dragging = true;
        onDragStart(active.clipId);
      }
      // 렌더는 스냅·클램프된 결과가 바뀔 때만 다시 한다(픽셀마다 아님).
      const raw = active.base + deltaTicks(active.startX, e.clientX);
      const probe = previewSong(
        {
          kind: active.kind,
          clipId: active.clipId,
          original: active.original,
          value: raw,
        },
        trackId,
      );
      const shown = findClip(probe, trackId, active.clipId);
      const result =
        shown === undefined
          ? active.result
          : active.kind === "move"
            ? shown.start
            : shown.length;
      if (preview && result === active.result) return;
      active.result = result;
      setPreview({
        kind: active.kind,
        clipId: active.clipId,
        original: active.original,
        value: result,
      });
    },
    onPointerUp(e) {
      const active = activeRef.current;
      if (!active || e.pointerId !== active.pointerId) return;
      activeRef.current = null;
      releaseCapture(active.target, active.pointerId);
      active.release();
      if (!active.dragging) {
        // 클릭은 이 제스처의 본문 버튼으로 푼다(up 이벤트의 요소가 아니라).
        if (active.kind === "move") onClick(active.clipId, active.target);
        return;
      }
      setPreview(null);
      // 마지막 미리보기 값을 커밋한다 — 사용자가 본 것과 같은 위치·길이.
      if (active.result === active.base) return;
      if (active.kind === "move") onMove(active.clipId, active.result);
      else onResize(active.clipId, active.result);
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
