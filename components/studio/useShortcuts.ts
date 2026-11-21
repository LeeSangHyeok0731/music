"use client";

import { useEffect, useRef } from "react";

import type { StudioApi } from "@/state/types";
import { useStudio } from "@/state/useStudio";

import { hasActiveGesture } from "./gestures";
import { hasOpenModal } from "./modal";

/**
 * 전역 단축키. `Studio`가 한 번만 부른다. `document`의 `keydown` 리스너 하나(버블 단계)와 Space의
 * `keyup` 리스너 하나를 마운트 동안만 걸고, 최신 `StudioApi`는 ref로 읽는다(렌더마다 다시 걸지
 * 않고 낡은 값도 안 쓴다).
 *
 * | 키 | 동작 | 조건 |
 * | --- | --- | --- |
 * | Space | 재생 중이거나 재생 대기 중이면 `stop()`, 아니면 `play()` | 반복 입력 무시. 아래 "Space와 네이티브" 대상 위에서는 처리 안 함 |
 * | Ctrl/Cmd+Z | `undo()` | `editable && canUndo`, 진행 중 드래그 없음. 텍스트 입력 위에서는 처리 안 함. Shift·Alt 변형은 처리 안 함. `key`가 z이거나 물리 키가 KeyZ |
 * | Delete / Backspace | 선택한 클립 삭제 | `editable`, 선택 있음. 텍스트 입력·select·대화상자 안에서는 처리 안 함. 모달이 열려 있으면 처리 안 함 |
 * | Esc | 선택 해제 | 선택 있음. 모달이 열려 있으면 처리 안 함 |
 *
 * 공통: 이미 `defaultPrevented`인 이벤트(다른 곳이 처리함)와 `isComposing`, 문자열이 아닌 `key`는
 * 무시한다. Space·Delete·Backspace는 Ctrl/Meta/Alt가 눌려 있으면 무시한다(Shift는 허용). 처리했을
 * 때만 `preventDefault`한다(선택 해제 Esc는 하지 않는다).
 *
 * **Space와 네이티브:** 클립·슬라이더를 마우스로 만지면 그 요소가 포커스를 가진다. 포커스된 모든
 * 요소 위의 Space를 무시하면 평소 흐름에서 Space가 죽는다. 그래서 Space를 네이티브에 맡기는 대상은
 * 입력 계열(텍스트·select·textarea·contenteditable·체크박스·라디오·파일·색), `summary`, `a`,
 * `[role=dialog]` 안, 그리고 **키보드로 포커스된**(`:focus-visible`) 버튼 계열(`button`,
 * `[role=button]`, `[role=separator]`, 버튼형 `input`)뿐이다. 마우스로 포커스된 버튼과 range 슬라이더
 * (Space 동작이 없다) 위에서는 재생/정지한다. 처리한 Space의 `keyup`은 막는다(브라우저에 따라 버튼의
 * 클릭이 keyup에서 일어난다).
 *
 * **모달:** 모달이 열려 있는 동안(`hasOpenModal()`) 이 리스너는 Delete/Backspace(클립 삭제)와 Esc(선택 해제)를
 * 처리하지 않는다 — 모달이 자기 키를 처리한다(음 삭제, 모달 닫기). Space·Ctrl+Z는 그대로다.
 *
 * **Esc 단계:** 한 번의 Esc는 한 겹만 닫는다 — 진행 중인 드래그 → 열린 팝오버 → 선택. 드래그 훅과
 * 팝오버 훅이 **캡처 단계** 리스너에서 처리하고 `preventDefault`로 표시하므로, 이 버블 단계
 * 리스너는 마운트 순서와 무관하게 늘 그 뒤에 돌고, 표시가 있으면 아무것도 하지 않는다.
 *
 * **진행 중 드래그 동안의 실행취소:** 막는다(처리도 `preventDefault`도 하지 않는다). 드래그는
 * 시작 때의 곡 스냅샷으로 미리보기와 커밋을 계산하므로, 도중에 곡이 바뀌면 놓을 때 낡은 곡 위에
 * 커밋된다(`gestures.ts`).
 */

/** Space를 항상 네이티브(또는 자체 키 처리)에 맡기는 요소. */
const SPACE_NATIVE =
  'select, textarea, summary, a, [contenteditable]:not([contenteditable="false"]), [role="dialog"]';

/** 키보드로 포커스됐을 때만 Space를 네이티브에 맡기는 버튼 계열. */
const BUTTON_LIKE = 'button, [role="button"], [role="separator"]';
const BUTTON_INPUT_TYPES = new Set(["button", "submit", "reset", "image"]);

/**
 * 키보드로 포커스된 요소인가(`:focus-visible`). 마우스로 포커스된 버튼은 아니다. 선택자를 모르는
 * 환경이면 키보드 포커스로 본다 — 접근성에 안전한 쪽(네이티브 Space를 살린다).
 */
function matchesFocusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** 이 Space는 대상 요소의 네이티브 동작에 맡겨야 하는가. */
function spaceBelongsToTarget(target: Element | null): boolean {
  if (!target) return false;
  if (target.closest(SPACE_NATIVE)) return true;
  const input = target.closest("input");
  if (input) {
    // range는 Space 동작이 없다.
    if (input.type === "range") return false;
    if (BUTTON_INPUT_TYPES.has(input.type)) return matchesFocusVisible(input);
    return true;
  }
  const button = target.closest(BUTTON_LIKE);
  return button !== null && matchesFocusVisible(button);
}

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
    // 처리한 Space의 keyup. 반복 keydown은 이 표시를 지우지 않는다.
    let spaceHandled = false;

    const isSpace = (e: KeyboardEvent) => e.key === " " || e.code === "Space";

    const onKeyDown = (e: KeyboardEvent) => {
      // 다른 곳(캡처 단계의 드래그·팝오버 등)이 이미 처리했다. 문자열이 아닌 key는 자동완성 등
      // 합성 이벤트다.
      if (e.defaultPrevented || e.isComposing) return;
      if (typeof e.key !== "string") return;
      if (!(isSpace(e) && e.repeat)) spaceHandled = false;
      const studio = apiRef.current;
      const target = e.target instanceof Element ? e.target : null;

      if (e.key === "Escape") {
        if (hasOpenModal() || !studio.selection) return;
        studio.select(null);
        return;
      }

      if (isSpace(e)) {
        if (hasCommandModifier(e) || e.repeat) return;
        if (spaceBelongsToTarget(target)) return;
        spaceHandled = true;
        e.preventDefault();
        // 대기 중(샘플 받는 중)에도 정지한다: 받기가 끝나지 않을 때의 탈출구다. 그 뒤에 온
        // 옛 play() 결과는 Provider의 세션 토큰이 버리므로 play()를 다시 부르지 않는다.
        if (studio.playing || studio.pending) studio.stop();
        else void studio.play();
        return;
      }

      // 한글 IME 등 비라틴 배열에서는 key가 ASCII가 아니므로(예: "ㅋ") 물리 키 KeyZ로도 본다.
      // key가 ASCII면 그대로 믿는다 — Dvorak 같은 배열에서 KeyZ 위치의 다른 글자(;)를 z로 오인하지 않는다.
      const isZ =
        e.key.toLowerCase() === "z" ||
        (e.code === "KeyZ" && /[^\x00-\x7f]/.test(e.key));
      if (isZ) {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
        if (isTextLike(target)) return;
        if (!studio.editable || !studio.canUndo) return;
        // 드래그 중에는 곡을 바꾸지 않는다(처리도 기본 동작 차단도 하지 않는다).
        if (hasActiveGesture()) return;
        e.preventDefault();
        studio.undo();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (hasCommandModifier(e) || hasOpenModal()) return;
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

    const onKeyUp = (e: KeyboardEvent) => {
      if (!spaceHandled || !isSpace(e)) return;
      spaceHandled = false;
      e.preventDefault();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}
