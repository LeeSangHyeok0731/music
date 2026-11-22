"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { PPQ, type Clip, type Note, type Song } from "@/lib/score/model";
import {
  GRID_UNITS,
  noteKey,
  planAddNote,
  planMoveNotes,
  planResizeNotes,
  selectNotesInBox,
  snapTickDelta,
  type GridUnit,
  type NoteBox,
  type NoteKey,
  type NotePlan,
} from "@/lib/score/notes";
import type { StudioNoteEdits } from "@/state/types";

import { beginGesture } from "../gestures";
import { hasOpenPopover } from "../popover";
import { findClip, movedPastThreshold } from "../useClipDrag";
import { ROLL_PX_PER_BEAT, ROW_HEIGHT, rollXToTick, yToPitch } from "./geometry";

/**
 * 피아노롤 음 제스처(추가·선택·박스·이동·길이). 규칙(스냅·겹침·경계·클램프·박스 교차)은
 * `lib/score/notes.ts`의 순수 계획 함수가 갖고 있고, 여기는 포인터 → 격자 좌표 변환, 5px 임계값,
 * 미리보기, 선택 갱신만 한다. 2a의 `useClipDrag`와 같은 제스처 규칙을 따른다(그 훅은 건드리지 않는다).
 */

// 2a의 5px 임계값을 그대로 쓴다(복사하지 않는다).
export { movedPastThreshold };

// ---------------------------------------------------------------------------
// 순수 도우미
// ---------------------------------------------------------------------------

/** 격자의 화면 사각형(`getBoundingClientRect`). `width`·`height`는 격자 전체 크기다. */
export interface GridRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** `gridRect`에 **아직 반영되지 않은** 스크롤 오프셋(px). */
export interface ScrollOffset {
  left: number;
  top: number;
}

/**
 * 격자 요소 자신의 `getBoundingClientRect()`는 스크롤 영역 안에서 이미 스크롤을 반영한다 —
 * 그 사각형을 넘길 때는 이것을 쓴다(스크롤을 또 더하면 두 번 보정된다).
 */
export const NO_SCROLL: ScrollOffset = Object.freeze({ left: 0, top: 0 });

/** 격자 안 좌표(px, 격자 왼쪽 위 = 0,0). */
export interface GridPoint {
  x: number;
  y: number;
}

/**
 * 포인터의 화면 좌표 → 그 점이 든 칸 `{ tick(칸의 시작으로 내림), pitch(그 행) }`. 격자 안 x는
 * `clientX − gridRect.left + scroll.left`(y도 같다). 유한하지 않은 값이나 격자 밖(음수, 폭·높이
 * 이상)이면 null.
 */
export function cellFromPointer(
  clientX: number,
  clientY: number,
  gridRect: GridRect,
  scroll: ScrollOffset,
  hi: number,
  unit: GridUnit,
): { tick: number; pitch: number } | null {
  const px = clientX - gridRect.left + scroll.left;
  const py = clientY - gridRect.top + scroll.top;
  if (![px, py, gridRect.width, gridRect.height, hi].every(Number.isFinite)) {
    return null;
  }
  if (px < 0 || py < 0 || px >= gridRect.width || py >= gridRect.height) {
    return null;
  }
  const u = GRID_UNITS[unit];
  // 반올림한 틱이 아니라 정확한 틱으로 내린다(칸 경계 바로 앞 px가 다음 칸으로 넘어가지 않게).
  const tick = Math.floor((px * PPQ) / ROLL_PX_PER_BEAT / u) * u + 0;
  return { tick, pitch: yToPitch(py, hi) };
}

const NAN_BOX: NoteBox = Object.freeze({
  startTick: Number.NaN,
  endTick: Number.NaN,
  loPitch: Number.NaN,
  hiPitch: Number.NaN,
});

/**
 * 박스 선택의 두 꼭짓점(격자 안 px, 방향 무관) → `selectNotesInBox`의 박스. 틱은 화면에 그린 박스
 * 그대로(격자로 스냅하지 않는다 — 박스가 닿아 보이는 음만 고른다), 음높이는 두 y가 든 행 사이.
 * 격자 밖 점도 그대로 환산한다. 유한하지 않으면 NaN 박스(고르는 음 없음).
 */
export function boxFromPoints(a: GridPoint, b: GridPoint, hi: number): NoteBox {
  if (![a.x, a.y, b.x, b.y, hi].every(Number.isFinite)) return NAN_BOX;
  return {
    startTick: rollXToTick(Math.min(a.x, b.x)),
    endTick: rollXToTick(Math.max(a.x, b.x)),
    loPitch: yToPitch(Math.max(a.y, b.y), hi),
    hiPitch: yToPitch(Math.min(a.y, b.y), hi),
  };
}

export type DragKind = "move" | "resize";

export type PreviewResult =
  | { status: "zero" }
  | { status: "rejected" }
  | { status: "valid"; dTicks: number; dPitch: number; plan: NotePlan };

const ZERO: PreviewResult = Object.freeze({ status: "zero" });
const REJECTED: PreviewResult = Object.freeze({ status: "rejected" });

/**
 * 드래그 변화량(격자 안 px) → 미리보기 판정. `dTicks = rollXToTick(Δx)`, 이동이면
 * `dPitch = −round(Δy / ROW_HEIGHT)`(길이는 Δy 무시).
 *
 * - `zero`: 칸으로 스냅한 변화량이 0(제자리) — 원래 위치를 보이고 커밋할 게 없다.
 * - `rejected`: 이동이 거부됐다(겹침·경계·음높이 한계, 계획 함수가 같은 참조) — 마지막 유효
 *   미리보기를 유지한다. 비유한 변화량도 여기다.
 * - `valid`: 새 미리보기. 커밋은 이 `dTicks`/`dPitch` 그대로다.
 *
 * 길이는 계획 함수가 덩어리째 **클램프**하므로 같은 참조는 "유효 변화 없음"이다 → `zero`.
 * `keys`는 클립에 있는 음으로 이미 걸러진 키여야 한다.
 */
export function previewDelta(
  kind: DragKind,
  original: Song,
  trackId: string,
  clipId: string,
  keys: readonly NoteKey[],
  dx: number,
  dy: number,
  unit: GridUnit,
): PreviewResult {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return REJECTED;
  const dTicks = rollXToTick(dx);
  const dPitch = kind === "move" ? -Math.round(dy / ROW_HEIGHT) + 0 : 0;
  if (snapTickDelta(dTicks, unit) === 0 && dPitch === 0) return ZERO;
  let plan: NotePlan;
  try {
    plan =
      kind === "move"
        ? planMoveNotes(original, trackId, clipId, keys, dTicks, dPitch, unit)
        : planResizeNotes(original, trackId, clipId, keys, dTicks, unit);
  } catch {
    return REJECTED;
  }
  if (plan.song === original) return kind === "move" ? REJECTED : ZERO;
  return { status: "valid", dTicks, dPitch, plan };
}

/**
 * 원래 키 → 미리보기 음. 계획의 `keys[i]`가 입력 `keys[i]`(걸러진 키)의 결과라서 짝지을 수 있다.
 * 음은 원래 키로 계속 그린다(다시 마운트하지 않는다).
 */
export function previewNotes(
  plan: NotePlan,
  trackId: string,
  clipId: string,
  keys: readonly NoteKey[],
): Map<NoteKey, Note> {
  const out = new Map<NoteKey, Note>();
  const clip = findClip(plan.song, trackId, clipId);
  if (!clip || clip.body.type !== "notes" || plan.keys.length !== keys.length) {
    return out;
  }
  const byKey = new Map<NoteKey, Note>();
  for (const n of clip.body.notes) {
    const k = noteKey(n);
    if (!byKey.has(k)) byKey.set(k, n);
  }
  keys.forEach((k, i) => {
    const n = byKey.get(plan.keys[i]);
    if (n) out.set(k, n);
  });
  return out;
}

/** 선택을 클립에 실제로 있는 음으로 거르고 중복을 없앤다. 바뀐 게 없으면 같은 배열. */
export function liveSelection(
  notes: readonly Note[],
  selection: readonly NoteKey[],
): readonly NoteKey[] {
  const present = new Set(notes.map(noteKey));
  const seen = new Set<NoteKey>();
  const out: NoteKey[] = [];
  for (const k of selection) {
    if (!present.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out.length === selection.length ? selection : out;
}

export function toggleKey(
  selection: readonly NoteKey[],
  key: NoteKey,
): NoteKey[] {
  return selection.includes(key)
    ? selection.filter((k) => k !== key)
    : [...selection, key];
}

export function unionKeys(
  a: readonly NoteKey[],
  b: readonly NoteKey[],
): NoteKey[] {
  return [...a, ...b.filter((k) => !a.includes(k))];
}

// ---------------------------------------------------------------------------
// 훅
// ---------------------------------------------------------------------------

type GestureKind = DragKind | "empty";

interface Gesture {
  kind: GestureKind;
  pointerId: number;
  /** 누른 화면 좌표(임계값 판정). */
  startX: number;
  startY: number;
  /** 누른 격자 안 좌표와 마지막 move의 격자 안 좌표(박스). 매번 격자 사각형을 다시 읽어 스크롤을 따른다. */
  start: GridPoint;
  last: GridPoint;
  original: Song;
  /** 누른 시점의 클립 객체. 곡에서 이 객체가 바뀌면(편집·되돌리기·삭제) 제스처를 버린다. */
  originalClip: Clip | undefined;
  unit: GridUnit;
  hi: number;
  /** 누른 음(본문·핸들). 빈 곳이면 null. */
  key: NoteKey | null;
  /** 빈 곳: 누른 칸(클릭이면 여기에 추가). */
  cell: { tick: number; pitch: number } | null;
  shift: boolean;
  dragging: boolean;
  /** 드래그가 시작될 때 정한 대상 키(선택 전체, 또는 누른 음 하나). */
  keys: readonly NoteKey[];
  /** 마지막 유효 미리보기(커밋 값). null이면 제자리. */
  valid: Extract<PreviewResult, { status: "valid" }> | null;
  /** 지금 그린 미리보기의 서명(같으면 다시 그리지 않는다). */
  sig: string;
  /** 캡처를 잡은 요소(격자). */
  target: HTMLElement;
  onKey(e: KeyboardEvent): void;
  /** 진행 중 제스처 수(`gestures.ts`)에서 이 제스처를 거둔다. */
  release(): void;
}

export interface NotePreview {
  kind: DragKind;
  /** 원래 키 → 미리보기 위치·길이의 음. */
  notes: ReadonlyMap<NoteKey, Note>;
}

export interface BoxPreview {
  a: GridPoint;
  b: GridPoint;
}

export interface NoteGridHandlers {
  onPointerDown(e: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(e: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(e: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(e: ReactPointerEvent<HTMLElement>): void;
  onLostPointerCapture(e: ReactPointerEvent<HTMLElement>): void;
  /** 키보드(Enter·Space, `detail 0`)로 누른 음 클릭. 마우스 클릭은 pointerup이 이미 처리했다. */
  onClick(e: ReactMouseEvent<HTMLElement>): void;
}

export interface UseNoteGesturesOptions {
  song: Song;
  trackId: string;
  clipId: string;
  editable: boolean;
  unit: GridUnit;
  /** 표시 범위의 최고 음높이(맨 위 행). */
  hi: number;
  /** 지금 선택(클립에 있는 음으로 걸러진 키). */
  selection: readonly NoteKey[];
  setSelection(keys: readonly NoteKey[]): void;
  edit: StudioNoteEdits;
}

function releaseCapture(target: Element, pointerId: number) {
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // 이미 풀렸거나 요소가 떨어졌다.
  }
}

/** 제스처를 끝낸다: ref를 **먼저** 비우고(뒤따르는 lostpointercapture가 no-op) 캡처·Esc·카운터를 거둔다. */
function finishGesture(ref: RefObject<Gesture | null>, g: Gesture) {
  if (ref.current === g) ref.current = null;
  document.removeEventListener("keydown", g.onKey, true);
  releaseCapture(g.target, g.pointerId);
  g.release();
}

function previewSig(notes: ReadonlyMap<NoteKey, Note> | null): string {
  if (!notes) return "";
  let s = "";
  for (const [k, n] of notes) s += `${k}>${n.start}:${n.pitch}:${n.length};`;
  return s;
}

/**
 * 격자 하나의 음 제스처. 핸들러는 격자 요소에 한 번 건다(위임) — 음 본문(`[data-note-key]`)·
 * 길이 핸들(`[data-note-handle]`)·빈 곳(격자 자신)을 눌린 대상으로 가른다. 한 번에 제스처 하나.
 *
 * - **누르는 순간 격자에 포인터를 캡처한다**(실패하면 제스처를 만들지 않는다). 격자는 음이 바뀌어도
 *   남아 있는 요소라 캡처 대상으로 안전하다. 마우스는 암묵적 캡처가 없어서 5px 뒤에 잡으면 8px
 *   핸들에서 빠르게 끌 때 move·up을 놓친다.
 * - 클릭인지 드래그인지는 놓을 때 정한다(5px). 음: 클릭 = 선택(Shift는 토글), 드래그 = 이동(선택에
 *   없던 음이면 먼저 그 음만 선택). 핸들: 드래그 = 선택 전체 길이, 클릭은 아무 일 없음. 빈 곳:
 *   클릭 = 음 추가 + 선택, 드래그 = 박스 선택(Shift는 합침).
 * - 미리보기는 누른 시점의 곡(원본 스냅샷)에서 순수 계획 함수로 계산하고, 놓을 때 **마지막 유효
 *   미리보기**로 한 번 커밋한다. 곡은 커밋 전까지 그대로다.
 * - 취소(커밋 없음): `Esc`(누른 순간부터, `document` 캡처 단계 + `preventDefault`), `pointercancel`,
 *   `lostpointercapture`(놓기 없이), 편집 불가, 언마운트, 그 클립이 곡에서 바뀜, 캡처 요소가 문서에서
 *   떨어짐(다음 누름에서), 마우스 버튼이 떼어진 move.
 * - 진행 중 제스처는 `beginGesture()`로 센다(되돌리기 차단, 모달 Esc 양보).
 *
 * 핸들러가 읽는 진실은 ref, 렌더용 미리보기·박스는 state다. 핸들러 묶음은 곡·선택·편집 가능·단위가
 * 바뀔 때만 새로 만든다(10Hz 재생 위치 갱신에는 그대로 — 격자 `memo`가 유지된다).
 */
export function useNoteGestures({
  song,
  trackId,
  clipId,
  editable,
  unit,
  hi,
  selection,
  setSelection,
  edit,
}: UseNoteGesturesOptions) {
  const activeRef = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<NotePreview | null>(null);
  const [box, setBox] = useState<BoxPreview | null>(null);
  // 포인터로 시작한 제스처 뒤에 브라우저가 따로 보내는 click(마우스는 detail > 0)을 한 번 삼킨다.
  const swallowClickRef = useRef(false);

  /** 제스처와 미리보기를 버린다(커밋 없음). */
  const cancel = useCallback(() => {
    const active = activeRef.current;
    if (active) finishGesture(activeRef, active);
    setPreview(null);
    setBox(null);
  }, []);

  // 편집 불가가 되면(재생 시작) 미리보기를 지우고 제스처를 거둔다.
  if (!editable && (preview !== null || box !== null)) {
    setPreview(null);
    setBox(null);
  }
  useEffect(() => {
    if (editable) return;
    const active = activeRef.current;
    if (active) finishGesture(activeRef, active);
  }, [editable]);

  // 언마운트에서 남은 캡처·Esc 리스너·제스처 수를 거둔다.
  useEffect(
    () => () => {
      const active = activeRef.current;
      if (active) finishGesture(activeRef, active);
    },
    [],
  );

  // 제스처 중인 클립이 곡에서 바뀌거나 사라지면 버린다(커밋은 낡은 스냅샷 위가 된다).
  useEffect(() => {
    const active = activeRef.current;
    if (active && findClip(song, trackId, clipId) !== active.originalClip) {
      cancel();
    }
  }, [song, trackId, clipId, cancel]);

  const handlers = useMemo<NoteGridHandlers>(() => {
    const addAt = (cell: { tick: number; pitch: number }, u: GridUnit) => {
      const spec = { start: cell.tick, pitch: cell.pitch };
      let plan: NotePlan;
      try {
        plan = planAddNote(song, trackId, clipId, spec, u);
      } catch {
        return;
      }
      if (plan.song === song) return;
      edit.addNote(trackId, clipId, spec, u);
      setSelection(plan.keys);
    };

    return {
      onPointerDown(e) {
        // 진행 중인 제스처가 있으면 삼킴 표시를 건드리지 않는다(두 번째 누름이 첫 제스처 뒤의
        // click을 풀어 놓으면 안 된다).
        if (!activeRef.current) swallowClickRef.current = false;
        if (!editable || e.button !== 0) return;
        if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
        const grid = e.currentTarget;
        const target = e.target instanceof Element ? e.target : null;
        const noteEl = target?.closest<HTMLElement>("[data-note-key]") ?? null;
        let kind: GestureKind;
        let key: NoteKey | null = null;
        if (noteEl && grid.contains(noteEl)) {
          key = noteEl.getAttribute("data-note-key");
          kind = target?.closest("[data-note-handle]") ? "resize" : "move";
        } else if (target === grid) {
          kind = "empty";
        } else {
          return;
        }
        // 캡처한 요소가 문서에서 떨어졌다면 lostpointercapture가 document로 가서 React가 못 받는다.
        // 그 묵은 제스처는 버리고 새 누름을 받는다.
        if (activeRef.current && !activeRef.current.target.isConnected) cancel();
        const current = activeRef.current;
        // 다른 포인터의 제스처가 진행 중이면 무시, 같은 포인터의 묵은 제스처는 대체한다.
        if (current && current.pointerId !== e.pointerId) return;
        if (current) cancel();
        // 팝오버·오버레이가 열려 있으면 이 빈 곳 누름은 그것을 닫는 것이다(닫기는 document 리스너가
        // 나중에 한다 — 아직 열려 있는 수를 동기적으로 읽는다).
        if (kind === "empty" && hasOpenPopover()) return;
        const clip = findClip(song, trackId, clipId);
        if (!clip || clip.body.type !== "notes") return;
        if (key !== null && !clip.body.notes.some((n) => noteKey(n) === key)) {
          return;
        }
        const rect = grid.getBoundingClientRect();
        const start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        if (!Number.isFinite(start.x) || !Number.isFinite(start.y)) return;
        let cell: { tick: number; pitch: number } | null = null;
        if (kind === "empty") {
          cell = cellFromPointer(e.clientX, e.clientY, rect, NO_SCROLL, hi, unit);
          if (!cell) return;
        }
        try {
          grid.setPointerCapture(e.pointerId);
        } catch {
          // 캡처 없이 시작하면 격자 밖에서 move·up이 끊겨 굳는다. 제스처를 만들지 않는다.
          return;
        }
        swallowClickRef.current = true;
        const gesture: Gesture = {
          kind,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          start,
          last: start,
          original: song,
          originalClip: clip,
          unit,
          hi,
          key,
          cell,
          shift: e.shiftKey,
          dragging: false,
          keys: [],
          valid: null,
          sig: "",
          target: grid,
          // 캡처 단계 + preventDefault: 이 Esc는 제스처 취소로 쓰였다는 표시다(모달의 선택 해제·닫기가
          // 같은 Esc에 반응하지 않는다). 누른 순간부터 듣는다 — 모달은 제스처가 있으면 Esc를 양보한다.
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

      onPointerMove(e) {
        const active = activeRef.current;
        if (!active || e.pointerId !== active.pointerId) return;
        // 마우스 버튼이 이미 떼어졌다면 up을 놓친 것이다(창 밖 등). 호버를 드래그로 오인하지 않는다.
        if (e.pointerType === "mouse" && (e.buttons & 1) === 0) {
          cancel();
          return;
        }
        if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
        const rect = active.target.getBoundingClientRect();
        const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
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
          if (active.key !== null) {
            // 선택에 없던 음을 끌면 그 음만 선택하고 그 음만 옮긴다(Shift여도 단독).
            if (selection.includes(active.key)) {
              active.keys = selection;
            } else {
              active.keys = [active.key];
              setSelection(active.keys);
            }
          }
        }
        active.last = p;
        if (active.kind === "empty") {
          setBox({ a: active.start, b: p });
          return;
        }
        const r = previewDelta(
          active.kind,
          active.original,
          trackId,
          clipId,
          active.keys,
          p.x - active.start.x,
          p.y - active.start.y,
          active.unit,
        );
        // 거부: 마지막 유효 미리보기(또는 제자리)를 그대로 둔다.
        if (r.status === "rejected") return;
        const valid = r.status === "valid" ? r : null;
        const notes = valid
          ? previewNotes(valid.plan, trackId, clipId, active.keys)
          : null;
        const sig = previewSig(notes);
        // 렌더는 스냅·클램프된 결과가 바뀔 때만 다시 한다(픽셀마다 아님).
        if (sig === active.sig) return;
        active.sig = sig;
        active.valid = valid;
        setPreview(notes ? { kind: active.kind, notes } : null);
      },

      onPointerUp(e) {
        const active = activeRef.current;
        if (!active || e.pointerId !== active.pointerId) return;
        finishGesture(activeRef, active);
        if (!active.dragging) {
          if (active.kind === "move" && active.key !== null) {
            setSelection(
              active.shift
                ? toggleKey(selection, active.key)
                : [active.key],
            );
          } else if (active.kind === "empty" && active.cell) {
            addAt(active.cell, active.unit);
          }
          return;
        }
        setPreview(null);
        setBox(null);
        if (active.kind === "empty") {
          // 마지막 move 위치(화면에 보인 박스)로 고른다.
          let found: NoteKey[];
          try {
            found = selectNotesInBox(
              active.original,
              trackId,
              clipId,
              boxFromPoints(active.start, active.last, active.hi),
            );
          } catch {
            return;
          }
          setSelection(active.shift ? unionKeys(selection, found) : found);
          return;
        }
        // 마지막 유효 미리보기를 커밋한다 — 사용자가 본 것과 같은 결과. 제자리면 커밋 없음.
        const valid = active.valid;
        if (!valid) return;
        if (active.kind === "move") {
          edit.moveNotes(
            trackId,
            clipId,
            active.keys,
            valid.dTicks,
            valid.dPitch,
            active.unit,
          );
        } else {
          edit.resizeNotes(
            trackId,
            clipId,
            active.keys,
            valid.dTicks,
            active.unit,
          );
        }
        setSelection(valid.plan.keys);
      },

      onPointerCancel(e) {
        if (activeRef.current?.pointerId === e.pointerId) cancel();
      },

      onLostPointerCapture(e) {
        if (activeRef.current?.pointerId === e.pointerId) cancel();
      },

      onClick(e) {
        if (e.detail > 0 && swallowClickRef.current) {
          swallowClickRef.current = false;
          return;
        }
        if (!editable) return;
        const target = e.target instanceof Element ? e.target : null;
        const noteEl = target?.closest<HTMLElement>("[data-note-key]") ?? null;
        if (!noteEl || !e.currentTarget.contains(noteEl)) return;
        if (target?.closest("[data-note-handle]")) return;
        const key = noteEl.getAttribute("data-note-key");
        const clip = findClip(song, trackId, clipId);
        if (
          key === null ||
          clip?.body.type !== "notes" ||
          !clip.body.notes.some((n) => noteKey(n) === key)
        ) {
          return;
        }
        setSelection(e.shiftKey ? toggleKey(selection, key) : [key]);
      },
    };
  }, [
    song,
    trackId,
    clipId,
    editable,
    unit,
    hi,
    selection,
    setSelection,
    edit,
    cancel,
  ]);

  return {
    handlers,
    preview: editable ? preview : null,
    box: editable ? box : null,
  };
}
