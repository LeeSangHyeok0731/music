"use client";

import { useEffect, useRef } from "react";

import type { StudioApi } from "@/state/types";
import { useStudio } from "@/state/useStudio";

/**
 * 전역 단축키. `Studio`가 한 번만 부른다. `document`의 `keydown` 리스너 하나(버블 단계)를
 * 마운트 동안만 걸고, 최신 `StudioApi`는 ref로 읽는다(렌더마다 다시 걸지 않고 낡은 값도 안 쓴다).
 *
 * | 키 | 동작 | 조건 |
 * | --- | --- | --- |
 * | Space | 재생 중이면 `stop()`, 대기 중이면 무시, 아니면 `play()` | 반복 입력 무시. 아래 "네이티브 우선" 대상 위에서는 처리 안 함 |
 * | Ctrl/Cmd+Z | `undo()` | `editable && canUndo`. 텍스트 입력 위에서는 처리 안 함. Shift·Alt 변형은 처리 안 함 |
 * | Delete / Backspace | 선택한 클립 삭제 | `editable`, 선택 있음. 텍스트 입력·select·대화상자 안에서는 처리 안 함 |
 * | Esc | 선택 해제 | 선택 있음, 그리고 아직 아무도 처리하지 않은 이벤트(`defaultPrevented`가 아님) |
 *
 * Space·Delete·Backspace는 Ctrl/Meta/Alt가 눌려 있으면 무시한다(Shift는 허용). IME 조합 중
 * (`isComposing`)의 키는 모두 무시한다. 처리했을 때만 `preventDefault`한다.
 *
 * **Esc 단계:** 한 번의 Esc는 한 겹만 닫는다 — 진행 중인 드래그 → 열린 팝오버 → 선택. 드래그 훅과
 * 팝오버 훅이 **캡처 단계** 리스너에서 처리하고 `preventDefault`로 표시하므로, 이 버블 단계
 * 리스너는 마운트 순서와 무관하게 늘 그 뒤에 돌고, 표시가 있으면 선택을 건드리지 않는다.
 */

/** Space가 네이티브 동작을 가지는(또는 자체 키 처리를 하는) 요소 — 이 위에서는 가로채지 않는다. */
const SPACE_NATIVE =
  'button, a, summary, select, textarea, input, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="separator"], [role="dialog"]';

/** 글자를 입력하는 요소가 아닌 `input` 종류. 이들 위에서는 되돌리기·삭제를 가로채도 입력을 해치지 않는다. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** 네이티브 텍스트 되돌리기·삭제를 가지는 요소인가. 슬라이더·체크박스·버튼은 아니다. */
function isTextLike(target: Element | null): boolean {
  if (!target) return false;
  if (
    target.closest('textarea, [contenteditable]:not([contenteditable="false"])')
  ) {
    return true;
  }
  const input = target.closest("input");
  return input !== null && !NON_TEXT_INPUT_TYPES.has(input.type);
}

function hasCommandModifier(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}

export function useShortcuts(): void {
  const api = useStudio();
  const apiRef = useRef<StudioApi>(api);
  useEffect(() => {
    apiRef.current = api;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const studio = apiRef.current;
      const target = e.target instanceof Element ? e.target : null;

      if (e.key === "Escape") {
        // 드래그·팝오버가 이미 이 Esc를 처리했으면(캡처 단계에서 preventDefault) 선택은 그대로다.
        if (e.defaultPrevented || !studio.selection) return;
        studio.select(null);
        return;
      }

      if (e.key === " " || e.code === "Space") {
        if (hasCommandModifier(e) || e.repeat) return;
        if (target?.closest(SPACE_NATIVE)) return;
        if (studio.playing) {
          e.preventDefault();
          studio.stop();
        } else if (!studio.pending) {
          e.preventDefault();
          void studio.play();
        }
        return;
      }

      if (e.key.toLowerCase() === "z") {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
        if (isTextLike(target)) return;
        if (!studio.editable || !studio.canUndo) return;
        e.preventDefault();
        studio.undo();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (hasCommandModifier(e)) return;
        if (isTextLike(target) || target?.closest('select, [role="dialog"]')) {
          return;
        }
        const selection = studio.selection;
        if (!studio.editable || !selection) return;
        // Backspace는 일부 브라우저에서 뒤로 가기이기도 하다.
        e.preventDefault();
        // 삭제 뒤 포커스: 여기서는 옮기지 않는다. 포커스가 지워지는 클립 안에 있었다면
        // 브라우저가 body로 돌려보내고(키보드로 다시 Tab), 그 외에는 그대로다.
        studio.edit.removeClip(selection.trackId, selection.clipId);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
