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
 *
 * 실제 브라우저처럼 **포인터 캡처를 따른다**: `setPointerCapture`가 잡은 포인터의
 * 이후 이벤트는 `firePointer`에 넘긴 요소가 아니라 캡처한 요소로 간다(jsdom은 이벤트를
 * 다시 겨냥하지 않는다). 캡처 없이 다른 요소에 전달되는 경우를 흉내 내려면
 * `retarget: false`. 캡처 없는 마우스는 눌린 요소 밖으로 나가면 이벤트를 잃는다.
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
  /** 눌린 버튼 비트. 기본: pointerdown·pointermove는 1(주 버튼 누름), pointerup·pointercancel은 0. */
  buttons?: number;
  /** 기본 "mouse". */
  pointerType?: string;
  /** false면 캡처를 무시하고 넘긴 요소로 그대로 보낸다. 기본 true. */
  retarget?: boolean;
}

/** `setPointerCapture`로 잡힌 포인터 id -> 캡처한 요소(`installPointerCaptureStubs`가 관리). */
const captureTargets = new Map<number, Element>();

function deliveryTarget(el: Element, pointerId: number, retarget: boolean) {
  const captured = captureTargets.get(pointerId);
  return retarget && captured && captured.isConnected ? captured : el;
}

/** 포인터 이벤트를 보낸다. `fireEvent`를 거치므로 React 갱신이 `act`로 감싸진다. */
export function firePointer(
  el: Element,
  type: PointerType,
  {
    clientX,
    clientY = 0,
    pointerId = 1,
    button = 0,
    buttons = type === "pointerdown" || type === "pointermove" ? 1 : 0,
    pointerType = "mouse",
    retarget = true,
  }: PointerInit,
): boolean {
  return fireEvent(
    deliveryTarget(el, pointerId, retarget),
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      pointerId,
      button,
      buttons,
      pointerType,
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
  define("setPointerCapture", function (this: Element, id: number) {
    idsOf(this).add(id);
    captureTargets.set(id, this);
  });
  define("releasePointerCapture", function (this: Element, id: number) {
    idsOf(this).delete(id);
    if (captureTargets.get(id) === this) captureTargets.delete(id);
  });
  define("hasPointerCapture", function (this: object, id: number) {
    return idsOf(this).has(id);
  });

  captureTargets.clear();
  return () => {
    captureTargets.clear();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else delete proto[name];
    }
  };
}

/** 테스트 레인의 화면상 왼쪽(`stubLaneRect`로 맞춘다). 헤더 열 폭과 같다. */
export const LANE_LEFT = 96;

/** 곡 틱을 레인 왼쪽이 `LANE_LEFT`일 때의 화면 x로. 1px = 12틱. */
export function xAt(tick: number, laneLeft = LANE_LEFT): number {
  return laneLeft + tick / 12;
}

/**
 * jsdom의 PointerEvent는 NaN `clientX`를 거부한다. 만든 뒤 값을 덮어써 비정상 입력을
 * 흉내 낸다.
 */
export function fireBadPointer(
  el: Element,
  type: PointerType,
  clientX: number,
  pointerId = 1,
): void {
  const ev = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId,
    buttons: type === "pointerdown" || type === "pointermove" ? 1 : 0,
    pointerType: "mouse",
  });
  Object.defineProperty(ev, "clientX", { value: clientX });
  fireEvent(deliveryTarget(el, pointerId, true), ev);
}
