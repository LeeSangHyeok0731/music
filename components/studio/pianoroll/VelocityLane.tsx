"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import type { Clip, Note } from "@/lib/score/model";
import {
  noteKey,
  type ChordalInstrument,
  type NoteKey,
} from "@/lib/score/notes";
import type { StudioNoteEdits } from "@/state/types";

import { beginGesture, hasActiveGesture } from "../gestures";
import { INSTRUMENT_BAR } from "../instruments";
import { movedPastThreshold } from "../useClipDrag";
import {
  KEY_COLUMN_WIDTH,
  VELOCITY_BAR_WIDTH,
  VELOCITY_LANE_HEIGHT,
  noteName,
  rollTickToX,
  velocityFromY,
} from "./geometry";

/** 키보드로 바꾸는 세기의 한 걸음(5%). */
export const VELOCITY_KEY_STEP = 0.05;

/** 키 한 걸음 뒤의 세기. 부동소수 찌꺼기(0.8 + 0.05)를 소수 둘째 자리로 정리하고 `[0.05, 1]`로 자른다. */
export function steppedVelocity(velocity: number, direction: 1 | -1): number {
  const next = Math.round((velocity + direction * VELOCITY_KEY_STEP) * 100) / 100;
  return Math.min(Math.max(next, 0.05), 1);
}

interface VelocityPreview {
  /** 미리보기 값이 적용되는 음(선택 전체, 또는 누른 음 하나). */
  keys: ReadonlySet<NoteKey>;
  velocity: number;
}

interface VelocityGesture {
  pointerId: number;
  startX: number;
  startY: number;
  /** 누른 음. */
  key: NoteKey;
  /** 대상: 누른 음이 선택에 있으면 선택 전체, 없으면 그 음만. 누를 때 정한다. */
  keys: readonly NoteKey[];
  dragging: boolean;
  /** 마지막 유효 값(커밋 값). */
  value: number | null;
  /** 누른 시점의 클립 객체. 곡에서 바뀌면 제스처를 버린다. */
  originalClip: Clip;
  target: HTMLElement;
  onKey(e: KeyboardEvent): void;
  release(): void;
}

function releaseCapture(target: Element, pointerId: number) {
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // 이미 풀렸거나 요소가 떨어졌다.
  }
}

/** 제스처를 끝낸다: ref를 **먼저** 비우고(뒤따르는 lostpointercapture가 no-op) 캡처·Esc·카운터를 거둔다. */
function finishGesture(
  ref: RefObject<VelocityGesture | null>,
  g: VelocityGesture,
) {
  if (ref.current === g) ref.current = null;
  document.removeEventListener("keydown", g.onKey, true);
  releaseCapture(g.target, g.pointerId);
  g.release();
}

/** 클립에서 키가 가리키는 첫 음. */
function noteByKey(clip: Clip, key: NoteKey): Note | undefined {
  if (clip.body.type !== "notes") return undefined;
  return clip.body.notes.find((n) => noteKey(n) === key);
}

const VelocityBar = memo(function VelocityBar({
  id,
  pitch,
  velocity,
  left,
  selected,
  instrument,
  editable,
}: {
  id: NoteKey;
  pitch: number;
  velocity: number;
  left: number;
  selected: boolean;
  instrument: ChordalInstrument;
  editable: boolean;
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`${noteName(pitch)} 세기`}
      aria-orientation="vertical"
      aria-valuemin={5}
      aria-valuemax={100}
      aria-valuenow={Math.round(velocity * 100)}
      aria-disabled={editable ? undefined : true}
      data-velocity-key={id}
      data-selected={selected ? "true" : undefined}
      // 세기가 낮은 막대를 위에 둔다 — 같은 자리의 화음 음에서 키 큰 막대도 윗부분이 잡힌다.
      className="pointer-events-none absolute top-0 outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
      style={{
        left,
        width: VELOCITY_BAR_WIDTH,
        height: "100%",
        zIndex: Math.round((1 - velocity) * 100),
      }}
    >
      <div
        className={`pointer-events-auto absolute inset-x-0 bottom-0 rounded-t-sm ${
          selected ? "bg-zinc-200" : INSTRUMENT_BAR[instrument]
        } ${editable ? "cursor-ns-resize" : ""}`}
        style={{ height: velocity * VELOCITY_LANE_HEIGHT }}
      />
    </div>
  );
});

export interface VelocityLaneProps {
  trackId: string;
  clipId: string;
  clip: Clip;
  instrument: ChordalInstrument;
  /** 선택된 키(클립에 있는 음으로 걸러진 것). */
  selection: readonly NoteKey[];
  editable: boolean;
  edit: StudioNoteEdits;
  /** 격자 폭(px). */
  width: number;
}

/**
 * 격자 아래 세기 레인. 격자와 **같은 스크롤 영역 안**의 `sticky bottom-0` 행이라 가로 스크롤은
 * 격자와 저절로 맞는다(스크롤바를 만들지 않는다). 음마다 막대 하나(높이 = 세기 × 레인 높이)가
 * `role="slider"`다.
 *
 * - 세로 드래그: 누르는 순간 막대 영역에 포인터를 캡처하고(실패하면 제스처를 만들지 않는다), 5px부터
 *   드래그다. 값은 `velocityFromY`(누른 y 그대로, 반올림 없음). 미리보기는 막대 높이만 바꾸고 놓을 때
 *   `setVelocities`를 **한 번** 부른다. 누른 음이 선택에 있으면 선택 전체, 없으면 그 음만(선택은
 *   바뀌지 않는다). 5px 안쪽 클릭은 아무 일도 하지 않는다.
 * - 키보드: 막대에 포커스가 있으면 `↑/↓`로 ±5%(같은 대상 규칙).
 * - 취소(커밋 없음): `Esc`(캡처 단계 + `preventDefault`), `pointercancel`, `lostpointercapture`,
 *   편집 불가, 언마운트, 그 클립이 곡에서 바뀜, 캡처 요소가 문서에서 떨어짐, 버튼이 떼어진 move.
 * - `memo`: 10Hz 재생 위치 표본으로는 다시 그리지 않는다.
 */
export const VelocityLane = memo(function VelocityLane({
  trackId,
  clipId,
  clip,
  instrument,
  selection,
  editable,
  edit,
  width,
}: VelocityLaneProps) {
  const activeRef = useRef<VelocityGesture | null>(null);
  const [preview, setPreview] = useState<VelocityPreview | null>(null);

  const cancel = useCallback(() => {
    const active = activeRef.current;
    if (active) finishGesture(activeRef, active);
    setPreview(null);
  }, []);

  // 편집 불가가 되면 미리보기를 지우고 제스처를 거둔다.
  if (!editable && preview !== null) setPreview(null);
  useEffect(() => {
    if (editable) return;
    const active = activeRef.current;
    if (active) finishGesture(activeRef, active);
  }, [editable]);

  useEffect(
    () => () => {
      const active = activeRef.current;
      if (active) finishGesture(activeRef, active);
    },
    [],
  );

  // 제스처 중인 클립이 바뀌거나 사라지면 버린다(커밋은 낡은 곡 위가 된다).
  useEffect(() => {
    const active = activeRef.current;
    if (active && active.originalClip !== clip) cancel();
  }, [clip, cancel]);

  const handlers = useMemo(
    () => ({
      onPointerDown(e: ReactPointerEvent<HTMLElement>) {
        if (!editable || e.button !== 0) return;
        if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
        const area = e.currentTarget;
        const target = e.target instanceof Element ? e.target : null;
        const barEl = target?.closest<HTMLElement>("[data-velocity-key]") ?? null;
        if (!barEl || !area.contains(barEl)) return;
        const key = barEl.getAttribute("data-velocity-key");
        if (key === null || !noteByKey(clip, key)) return;
        // 캡처한 요소가 문서에서 떨어졌다면 lostpointercapture를 못 받는다. 묵은 제스처는 버린다.
        if (activeRef.current && !activeRef.current.target.isConnected) cancel();
        const current = activeRef.current;
        if (current && current.pointerId !== e.pointerId) return;
        if (current) cancel();
        try {
          area.setPointerCapture(e.pointerId);
        } catch {
          // 캡처 없이 시작하면 영역 밖에서 move·up이 끊겨 굳는다. 제스처를 만들지 않는다.
          return;
        }
        const gesture: VelocityGesture = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          key,
          keys: selection.includes(key) ? selection : [key],
          dragging: false,
          value: null,
          originalClip: clip,
          target: area,
          onKey(k) {
            if (k.key !== "Escape" || k.defaultPrevented || k.isComposing) return;
            k.preventDefault();
            cancel();
          },
          release: beginGesture(),
        };
        document.addEventListener("keydown", gesture.onKey, true);
        activeRef.current = gesture;
      },

      onPointerMove(e: ReactPointerEvent<HTMLElement>) {
        const active = activeRef.current;
        if (!active || e.pointerId !== active.pointerId) return;
        // 마우스 버튼이 이미 떼어졌다면 up을 놓친 것이다. 호버를 드래그로 오인하지 않는다.
        if (e.pointerType === "mouse" && (e.buttons & 1) === 0) {
          cancel();
          return;
        }
        if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
        if (
          !active.dragging &&
          !movedPastThreshold(
            e.clientX - active.startX,
            e.clientY - active.startY,
          )
        ) {
          return;
        }
        active.dragging = true;
        const rect = active.target.getBoundingClientRect();
        const velocity = velocityFromY(
          e.clientY - rect.top,
          VELOCITY_LANE_HEIGHT,
        );
        if (velocity === null || velocity === active.value) return;
        active.value = velocity;
        setPreview({ keys: new Set(active.keys), velocity });
      },

      onPointerUp(e: ReactPointerEvent<HTMLElement>) {
        const active = activeRef.current;
        if (!active || e.pointerId !== active.pointerId) return;
        finishGesture(activeRef, active);
        setPreview(null);
        if (!active.dragging || active.value === null) return;
        edit.setVelocities(trackId, clipId, active.keys, active.value);
      },

      onPointerCancel(e: ReactPointerEvent<HTMLElement>) {
        if (activeRef.current?.pointerId === e.pointerId) cancel();
      },

      onLostPointerCapture(e: ReactPointerEvent<HTMLElement>) {
        if (activeRef.current?.pointerId === e.pointerId) cancel();
      },

      onKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        if (e.defaultPrevented || e.nativeEvent.isComposing) return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (!editable || hasActiveGesture()) return;
        const target = e.target instanceof Element ? e.target : null;
        const barEl = target?.closest<HTMLElement>("[data-velocity-key]") ?? null;
        const key = barEl?.getAttribute("data-velocity-key") ?? null;
        if (key === null) return;
        const note = noteByKey(clip, key);
        if (!note) return;
        e.preventDefault();
        edit.setVelocities(
          trackId,
          clipId,
          selection.includes(key) ? selection : [key],
          steppedVelocity(note.velocity, e.key === "ArrowUp" ? 1 : -1),
        );
      },
    }),
    [clip, trackId, clipId, editable, selection, edit, cancel],
  );

  const notes = clip.body.type === "notes" ? clip.body.notes : [];
  const selected = new Set(selection);
  // 같은 (start, pitch)가 둘인 손으로 고친 곡에서도 React 키가 겹치지 않게 한다. 키로 가리키는
  // 편집은 첫 음만 다룬다(`lib/score/notes.ts`와 같다).
  const seen = new Map<string, number>();

  return (
    <div
      data-testid="roll-velocity"
      className="sticky bottom-0 z-30 mt-auto flex shrink-0 bg-[#141519]"
      style={{
        height: VELOCITY_LANE_HEIGHT,
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.1)",
      }}
    >
      <div
        aria-hidden
        className="sticky left-0 z-10 shrink-0 border-r border-white/10 bg-[#141519]"
        style={{ width: KEY_COLUMN_WIDTH }}
      />
      <div
        role="group"
        aria-label="세기"
        data-testid="roll-velocity-bars"
        className="relative shrink-0 touch-none select-none"
        style={{ width, height: VELOCITY_LANE_HEIGHT }}
        {...handlers}
      >
        {notes.map((note) => {
          const base = noteKey(note);
          const n = seen.get(base) ?? 0;
          seen.set(base, n + 1);
          const first = n === 0;
          const shown =
            first && preview?.keys.has(base) ? preview.velocity : note.velocity;
          return (
            <VelocityBar
              key={first ? base : `${base}#${n}`}
              id={base}
              pitch={note.pitch}
              velocity={shown}
              left={rollTickToX(note.start)}
              selected={first && selected.has(base)}
              instrument={instrument}
              editable={editable}
            />
          );
        })}
      </div>
    </div>
  );
});
