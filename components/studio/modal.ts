"use client";

import { useEffect } from "react";

/**
 * 지금 열려 있는(마운트된) 모달 수. 전역 단축키(`useShortcuts`)가 동기적으로 읽어, 모달이 열린
 * 동안 Delete/Backspace와 Esc 선택 해제를 모달에 맡긴다(`popover.ts`의 팝오버 카운터와 같은 방식).
 */
let openModalCount = 0;

/** 어느 모달이든 열려 있는가(`useModalOpenCount`가 열린 동안 센다). */
export function hasOpenModal(): boolean {
  return openModalCount > 0;
}

/**
 * 모달 컴포넌트가 부른다. `open`이 참인 동안만 센다. 마운트 effect에서 올리고 정리에서 내리므로
 * 닫히거나 언마운트되거나 StrictMode의 모의 언마운트가 와도 균형이 맞는다(effect마다 정리는 한 번이다).
 */
export function useModalOpenCount(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    openModalCount++;
    return () => {
      openModalCount--;
    };
  }, [open]);
}
