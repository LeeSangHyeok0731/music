"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getAttribute("aria-hidden") !== "true",
  );
}

export interface UseFocusTrapOptions {
  /** 열릴 때 포커스를 줄 요소. 없으면 안의 첫 포커스 가능 요소. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * 닫힐 때 포커스를 돌려줄 요소. 호출 시점에 평가한다(그동안 요소가 바뀌었을 수 있다).
   * `null`이거나 문서에서 떨어진 요소면 아무것도 하지 않는다.
   */
  returnFocus?: () => HTMLElement | null;
}

/**
 * 모달의 포커스 가두기. 마운트 동안만 동작한다.
 *
 * - 열릴 때 `initialFocusRef`(없으면 첫 포커스 가능 요소)로 포커스를 옮긴다.
 * - `Tab`/`Shift+Tab`이 끝에서 반대편 끝으로 돈다. 포커스가 안에 없으면(body 등) 끌어온다.
 *   가운데에서는 브라우저의 기본 순서에 맡긴다. `defaultPrevented`인 키는 건너뛴다.
 * - 정리(닫기·언마운트)에서 `returnFocus`가 가리키는 요소로 포커스를 돌려준다. 포털 안의
 *   요소가 사라지면 포커스가 body로 떨어지므로, 연 요소로 돌려 키보드 사용자가 자리를 잃지 않게 한다.
 */
export function useFocusTrap(
  rootRef: RefObject<HTMLElement | null>,
  { initialFocusRef, returnFocus }: UseFocusTrapOptions = {},
): void {
  const initialRef = useRef(initialFocusRef);
  const returnRef = useRef(returnFocus);
  useEffect(() => {
    initialRef.current = initialFocusRef;
    returnRef.current = returnFocus;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const target = initialRef.current?.current ?? focusables(root)[0];
    target?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && root.contains(active);
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const back = returnRef.current?.();
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [rootRef]);
}
