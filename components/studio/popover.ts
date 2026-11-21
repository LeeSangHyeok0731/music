"use client";

import { useEffect, useRef, type RefObject } from "react";

/** 팝오버 폭(px). 위치 클램프(`popoverPosition`)와 스타일이 함께 쓴다. */
export const POPOVER_WIDTH = 224;
const GAP = 4;
const MARGIN = 8;

/**
 * 앵커(구간·클립 버튼)의 화면 사각형 아래에 붙이고 가로로는 뷰포트 안에 가둔다.
 * 팝오버가 `position: fixed`라서 타임라인의 `overflow`에 잘리지 않는다.
 */
export function popoverPosition(
  anchor: { left: number; bottom: number },
  viewportWidth: number,
): { left: number; top: number } {
  const max = Math.max(MARGIN, viewportWidth - POPOVER_WIDTH - MARGIN);
  return {
    left: Math.min(Math.max(anchor.left, MARGIN), max),
    top: anchor.bottom + GAP,
  };
}

/**
 * 지금 열려 있는(마운트된) 팝오버 수. 닫기 리스너는 `document`에 있어서 React의 루트
 * 핸들러(레인의 pointerdown)보다 **나중에** 돈다 — 그래서 레인이 "이 누름은 팝오버를
 * 닫는 것"임을 알려면 이 값을 동기적으로 읽는다. 레인마다 자기 팝오버만 알면 다른 레인의
 * 팝오버를 닫는 클릭이 이 레인에 클립을 추가해 버린다.
 */
let openPopoverCount = 0;

/** 어느 레인이든 팝오버가 열려 있는가(`usePopoverDismiss`가 마운트 동안 센다). */
export function hasOpenPopover(): boolean {
  return openPopoverCount > 0;
}

export interface UsePopoverDismissOptions {
  /** 팝오버를 연 버튼. 바깥 누르기 판정에서 제외한다(그 버튼의 클릭이 토글한다). */
  anchor: HTMLElement;
  rootRef: RefObject<HTMLElement | null>;
  /** `returnFocus`: 키보드로 닫을 때만 참(바깥을 눌렀다면 그 자리 포커스를 뺏지 않는다). */
  onClose(returnFocus: boolean): void;
}

/**
 * 포털 팝오버가 닫히는 경로 모음: `Esc`(포커스 복귀), 팝오버·앵커 밖 `pointerdown`,
 * 창 크기 변경, 스크롤(위치가 fixed라 앵커에서 떨어지므로 따라가지 않고 닫는다).
 *
 * 크기 변경·스크롤로 닫을 때 포커스가 팝오버 안(곧 사라진다)이거나 body에 있으면
 * 앵커로 옮겨 키보드 포커스를 잃지 않게 한다. 다른 곳에 있으면 뺏지 않는다.
 */
export function usePopoverDismiss({
  anchor,
  rootRef,
  onClose,
}: UsePopoverDismissOptions): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    openPopoverCount++;
    return () => {
      openPopoverCount--;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current(true);
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      // 열어 준 버튼은 자기 클릭이 토글하므로 여기서 닫지 않는다.
      if (
        target &&
        (rootRef.current?.contains(target) || anchor.contains(target))
      ) {
        return;
      }
      closeRef.current(false);
    };
    const onMove = () => {
      const active = document.activeElement;
      if (
        !active ||
        active === document.body ||
        rootRef.current?.contains(active)
      ) {
        anchor.focus({ preventScroll: true });
      }
      closeRef.current(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [anchor, rootRef]);
}
