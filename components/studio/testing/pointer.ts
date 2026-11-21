import { fireEvent } from "@testing-library/react";

/**
 * 편집 UI 테스트용 포인터 도우미(Task 8~10이 쓴다). jsdom 28은 `PointerEvent`를
 * 가지고 있어 `clientX`·`pointerId`가 그대로 React의 `onPointer*` 핸들러에 닿는다.
 * 레이아웃이 없으므로 `getBoundingClientRect`·포인터 캡처는 스텁으로 채운다.
 *
 * ```ts
 * const restore = installPointerCaptureStubs(); // beforeEach (afterEach에서 restore())
 * stubLaneRect(lane, { left: 96, width: 1280 });
 * firePointer(lane, "pointerdown", { clientX: 96 + 160, pointerId: 1 });
 * firePointer(lane, "pointermove", { clientX: 96 + 200, pointerId: 1 });
 * firePointer(lane, "pointerup", { clientX: 96 + 200, pointerId: 1 });
 * ```
 */

export type PointerType =
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel";

export interface PointerInit {
  clientX: number;
  clientY?: number;
  pointerId?: number;
  /** 0 = 주 버튼(기본), 2 = 우클릭. */
  button?: number;
}

/** 포인터 이벤트를 보낸다. `fireEvent`를 거치므로 React 갱신이 `act`로 감싸진다. */
export function firePointer(
  el: Element,
  type: PointerType,
  { clientX, clientY = 0, pointerId = 1, button = 0 }: PointerInit,
): boolean {
  return fireEvent(
    el,
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      pointerId,
      button,
    }),
  );
}

export interface LaneRect {
  left: number;
  top?: number;
  width?: number;
  height?: number;
}

/** 요소의 `getBoundingClientRect`를 고정값으로 바꾼다(jsdom은 전부 0을 준다). */
export function stubLaneRect(
  el: Element,
  { left, top = 0, width = 0, height = 0 }: LaneRect,
): void {
  const rect = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } satisfies DOMRect;
  el.getBoundingClientRect = () => rect;
}

const CAPTURE_METHODS = [
  "setPointerCapture",
  "releasePointerCapture",
  "hasPointerCapture",
] as const;

/**
 * `HTMLElement.prototype`에 포인터 캡처 스텁을 단다. 요소마다 잡힌 포인터 id를
 * 기억한다. 돌려주는 함수가 원래 속성(없었으면 삭제)으로 되돌린다.
 */
export function installPointerCaptureStubs(): () => void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const originals = CAPTURE_METHODS.map(
    (name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const,
  );
  const captured = new WeakMap<object, Set<number>>();
  const idsOf = (el: object) => {
    let ids = captured.get(el);
    if (!ids) {
      ids = new Set();
      captured.set(el, ids);
    }
    return ids;
  };

  const define = (name: string, value: unknown) =>
    Object.defineProperty(proto, name, {
      value,
      configurable: true,
      writable: true,
    });
  define("setPointerCapture", function (this: object, id: number) {
    idsOf(this).add(id);
  });
  define("releasePointerCapture", function (this: object, id: number) {
    idsOf(this).delete(id);
  });
  define("hasPointerCapture", function (this: object, id: number) {
    return idsOf(this).has(id);
  });

  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else delete proto[name];
    }
  };
}
