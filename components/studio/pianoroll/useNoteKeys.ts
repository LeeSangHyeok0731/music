"use client";

import { useEffect, useRef, type RefObject } from "react";

import type { Song } from "@/lib/score/model";
import {
  GRID_UNITS,
  noteKey,
  planMoveNotes,
  planRemoveNotes,
  planResizeNotes,
  type GridUnit,
  type NoteKey,
  type NotePlan,
} from "@/lib/score/notes";
import type { StudioNoteEdits } from "@/state/types";

import { hasActiveGesture } from "../gestures";
import { findClip } from "../useClipDrag";

/** 키 하나가 뜻하는 음 편집. */
export type NoteKeyCommand =
  | { type: "move"; dTicks: number; dPitch: number }
  | { type: "resize"; dTicks: number }
  | { type: "remove" }
  | { type: "selectAll" };

type KeyInfo = Pick<
  KeyboardEvent,
  "key" | "code" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey"
>;

/**
 * 키 입력 → 명령(순수). 어느 요소에 포커스가 있는지, 선택이 있는지는 보지 않는다.
 *
 * | 키 | 명령 |
 * | --- | --- |
 * | ←/→ | 시간 이동 ±격자 단위 |
 * | ↑/↓ | 반음 ±1 |
 * | Shift+↑/↓ | 옥타브 ±12 |
 * | Alt+←/→ | 길이 ±격자 단위 |
 * | Delete/Backspace | 삭제 |
 * | Ctrl/Cmd+A | 전체 선택 |
 *
 * 그 밖의 조합(Ctrl/Cmd+방향키 — 브라우저 단축키, Alt+↑/↓, Shift+←/→ 등)은 null이다.
 */
export function noteKeyCommand(
  e: KeyInfo,
  unitTicks: number,
): NoteKeyCommand | null {
  const { key, code, shiftKey, altKey, ctrlKey, metaKey } = e;
  // 한글 IME 등 비라틴 배열에서는 key가 ASCII가 아니므로 물리 키로도 본다(`useShortcuts`의 z와 같다).
  const isA =
    key.toLowerCase() === "a" || (code === "KeyA" && /[^\x00-\x7f]/.test(key));
  if (isA) {
    return (ctrlKey || metaKey) && !shiftKey && !altKey
      ? { type: "selectAll" }
      : null;
  }
  if (ctrlKey || metaKey) return null;

  if (key === "Delete" || key === "Backspace") {
    return shiftKey || altKey ? null : { type: "remove" };
  }
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const dir = key === "ArrowRight" ? 1 : -1;
    if (shiftKey) return null;
    return altKey
      ? { type: "resize", dTicks: dir * unitTicks }
      : { type: "move", dTicks: dir * unitTicks, dPitch: 0 };
  }
  if (key === "ArrowUp" || key === "ArrowDown") {
    const dir = key === "ArrowUp" ? 1 : -1;
    if (altKey) return null;
    return { type: "move", dTicks: 0, dPitch: dir * (shiftKey ? 12 : 1) };
  }
  return null;
}

/** 글자를 입력하는 요소는 자기 키를 가진다. 건드리지 않는다. */
const TEXT_KEYS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** `role=slider`(세기 막대)도 자기 키(↑/↓)를 가진다. */
const OWN_KEYS = `${TEXT_KEYS}, [role="slider"]`;

/**
 * 이 키 입력이 격자 편집을 향한 것인가: 포커스가 격자 스크롤 영역 안(음 버튼 포함)이거나, 포커스가
 * 어디에도 없을 때(body — 음을 끌어 옮기면 포커스를 쥔 음 버튼이 다시 만들어져 사라진다)다.
 * `allowSlider`는 슬라이더가 자기 키로 쓰지 않는 명령(전체 선택)용이다 — 세기 막대를 끌고 난 뒤
 * 포커스가 막대에 남아 있어도 `Ctrl/Cmd+A`가 브라우저의 페이지 텍스트 전체 선택으로 새지 않게 한다.
 */
function targetsGrid(
  target: Element | null,
  scroll: HTMLElement | null,
  allowSlider = false,
): boolean {
  if (!target || target.closest(allowSlider ? TEXT_KEYS : OWN_KEYS)) {
    return false;
  }
  if (target === document.body || target === document.documentElement) {
    return true;
  }
  return scroll !== null && scroll.contains(target);
}

function planOrNull(make: () => NotePlan): NotePlan | null {
  try {
    return make();
  } catch {
    return null;
  }
}

const NO_KEYS: readonly NoteKey[] = [];

export interface UseNoteKeysOptions {
  song: Song;
  trackId: string;
  clipId: string;
  editable: boolean;
  unit: GridUnit;
  /** 지금 선택(클립에 있는 음으로 걸러진 키). */
  selection: readonly NoteKey[];
  setSelection(keys: readonly NoteKey[]): void;
  edit: StudioNoteEdits;
  /** 격자 스크롤 영역. 음 키 편집은 여기로 포커스를 돌려준다. */
  scrollRef: RefObject<HTMLElement | null>;
}

/**
 * 피아노롤의 키보드 음 편집. `document`의 `keydown` 리스너 하나(버블 단계)를 모달이 마운트된 동안만
 * 걸고, 최신 값은 ref로 읽는다(`useShortcuts`와 같은 패턴). 규칙은 순수 계획 함수가 갖고 있고
 * 여기는 키 → 명령 → 계획 → 커밋만 한다. 키 한 번 = 편집 함수 한 번 = 히스토리 한 칸(거부·경계면 0칸).
 *
 * - 대상: 포커스가 격자 영역 안이거나 어디에도 없을 때. 입력 요소·`role=slider`(세기 막대)·헤더 컨트롤
 *   위에서는 처리하지 않는다.
 * - 건너뜀: `defaultPrevented`, `isComposing`, 편집 불가(재생 중·재생 대기 중), 진행 중 제스처(드래그 중
 *   곡 변경 방지). 선택이 없으면 이동·길이·삭제는 처리하지 않는다(Ctrl/Cmd+A는 선택이 없어도).
 * - 처리했을 때만 `preventDefault`(방향키 스크롤 방지). 경계·겹침으로 거부돼도 선택이 있으면 처리한
 *   것이다(곡은 그대로, 격자가 덩달아 스크롤되지 않게).
 * - 편집 뒤 포커스를 격자 영역으로 옮긴다: 음 키가 `start:pitch`라 옮긴 음의 버튼이 다시 만들어지고,
 *   삭제하면 사라지므로 포커스가 body로 떨어지는 것을 막는다.
 */
export function useNoteKeys(options: UseNoteKeysOptions): void {
  const ref = useRef(options);
  useEffect(() => {
    ref.current = options;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (typeof e.key !== "string") return;
      const o = ref.current;
      const target = e.target instanceof Element ? e.target : null;
      const cmd = noteKeyCommand(e, GRID_UNITS[o.unit]);
      if (!cmd) return;
      if (
        !targetsGrid(target, o.scrollRef.current, cmd.type === "selectAll")
      ) {
        return;
      }
      if (hasActiveGesture()) return;
      const { song, trackId, clipId, unit, selection } = o;

      if (cmd.type === "selectAll") {
        const clip = findClip(song, trackId, clipId);
        if (clip?.body.type !== "notes") return;
        const all = [...new Set(clip.body.notes.map(noteKey))];
        if (all.length === 0) return;
        e.preventDefault();
        o.setSelection(all);
        return;
      }

      if (!o.editable || selection.length === 0) return;
      e.preventDefault();
      o.scrollRef.current?.focus({ preventScroll: true });

      if (cmd.type === "remove") {
        const plan = planOrNull(() =>
          planRemoveNotes(song, trackId, clipId, selection),
        );
        if (!plan || plan.song === song) return;
        o.edit.removeNotes(trackId, clipId, selection);
        o.setSelection(NO_KEYS);
        return;
      }

      if (cmd.type === "move") {
        const plan = planOrNull(() =>
          planMoveNotes(
            song,
            trackId,
            clipId,
            selection,
            cmd.dTicks,
            cmd.dPitch,
            unit,
          ),
        );
        if (!plan || plan.song === song) return;
        o.edit.moveNotes(
          trackId,
          clipId,
          selection,
          cmd.dTicks,
          cmd.dPitch,
          unit,
        );
        o.setSelection(plan.keys);
        return;
      }

      const plan = planOrNull(() =>
        planResizeNotes(song, trackId, clipId, selection, cmd.dTicks, unit),
      );
      if (!plan || plan.song === song) return;
      o.edit.resizeNotes(trackId, clipId, selection, cmd.dTicks, unit);
      o.setSelection(plan.keys);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
