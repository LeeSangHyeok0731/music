import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  firePointer,
  installPointerCaptureStubs,
  stubLaneRect,
} from "./pointer";

afterEach(cleanup);

function Probe({ log }: { log: string[] }) {
  return (
    <div
      data-testid="lane"
      onPointerDown={(e) =>
        log.push(`down ${e.clientX},${e.clientY} id${e.pointerId} b${e.button}`)
      }
      onPointerMove={(e) => log.push(`move ${e.clientX} id${e.pointerId}`)}
      onPointerUp={(e) => log.push(`up ${e.clientX} id${e.pointerId}`)}
      onPointerCancel={(e) => log.push(`cancel id${e.pointerId}`)}
    />
  );
}

describe("firePointer", () => {
  it("React의 포인터 핸들러에 clientX·clientY·pointerId·button이 닿는다", () => {
    const log: string[] = [];
    const { getByTestId } = render(<Probe log={log} />);
    const el = getByTestId("lane");

    firePointer(el, "pointerdown", { clientX: 40, clientY: 7, pointerId: 3 });
    firePointer(el, "pointermove", { clientX: 55, pointerId: 3 });
    firePointer(el, "pointerup", { clientX: 60, pointerId: 3 });
    firePointer(el, "pointercancel", { clientX: 0, pointerId: 4 });
    firePointer(el, "pointerdown", { clientX: 1, button: 2 });

    expect(log).toEqual([
      "down 40,7 id3 b0",
      "move 55 id3",
      "up 60 id3",
      "cancel id4",
      "down 1,0 id1 b2",
    ]);
  });
});

describe("stubLaneRect", () => {
  it("getBoundingClientRect를 지정한 값으로 바꾼다", () => {
    const { getByTestId } = render(<Probe log={[]} />);
    const el = getByTestId("lane");
    stubLaneRect(el, { left: 96, width: 1280 });
    const rect = el.getBoundingClientRect();
    expect(rect.left).toBe(96);
    expect(rect.right).toBe(96 + 1280);
    expect(rect.top).toBe(0);
    expect(rect.width).toBe(1280);
  });
});

describe("installPointerCaptureStubs", () => {
  it("설치하면 호출할 수 있고 포인터별로 잡힘 상태를 기억하며 복원하면 원래대로 돌아간다", () => {
    const before = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "setPointerCapture",
    );
    const restore = installPointerCaptureStubs();
    const el = document.createElement("div");

    expect(el.hasPointerCapture(1)).toBe(false);
    el.setPointerCapture(1);
    expect(el.hasPointerCapture(1)).toBe(true);
    expect(el.hasPointerCapture(2)).toBe(false);
    el.releasePointerCapture(1);
    expect(el.hasPointerCapture(1)).toBe(false);

    const spy = vi.spyOn(HTMLElement.prototype, "setPointerCapture");
    el.setPointerCapture(5);
    expect(spy).toHaveBeenCalledWith(5);
    spy.mockRestore();

    restore();
    expect(
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, "setPointerCapture"),
    ).toEqual(before);
  });
});
