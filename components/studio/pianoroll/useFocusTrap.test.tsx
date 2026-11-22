import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useFocusTrap } from "./useFocusTrap";

afterEach(cleanup);

function Trap({
  returnTo,
  withInitial = false,
}: {
  returnTo?: () => HTMLElement | null;
  withInitial?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef, {
    initialFocusRef: withInitial ? initialRef : undefined,
    returnFocus: returnTo,
  });
  return (
    <div ref={rootRef}>
      <button type="button">첫째</button>
      <div ref={initialRef} tabIndex={0} aria-label="격자" />
      <button type="button" disabled>
        막힘
      </button>
      <button type="button" tabIndex={-1}>
        건너뜀
      </button>
      <button type="button">마지막</button>
    </div>
  );
}

function Harness({ open, returnTo }: { open: boolean; returnTo?: boolean }) {
  return (
    <>
      <button type="button">바깥</button>
      {open && <Trap returnTo={returnTo ? () => screen.getByText("바깥") : undefined} />}
    </>
  );
}

describe("useFocusTrap", () => {
  it("열리면 첫 포커스 가능 요소로 포커스를 옮긴다", () => {
    render(<Trap />);
    expect(document.activeElement).toBe(screen.getByText("첫째"));
  });

  it("initialFocusRef가 있으면 거기로 옮긴다", () => {
    render(<Trap withInitial />);
    expect(document.activeElement).toBe(screen.getByLabelText("격자"));
  });

  it("마지막 요소에서 Tab은 첫 요소로 돈다(막힌·tabindex -1 요소는 건너뛴다)", () => {
    render(<Trap />);
    screen.getByText("마지막").focus();
    const notCancelled = fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(notCancelled).toBe(false);
    expect(document.activeElement).toBe(screen.getByText("첫째"));
  });

  it("첫 요소에서 Shift+Tab은 마지막 요소로 돈다", () => {
    render(<Trap />);
    screen.getByText("첫째").focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("마지막"));
  });

  it("가운데에서의 Tab은 브라우저에 맡긴다(가로채지 않는다)", () => {
    render(<Trap />);
    screen.getByLabelText("격자").focus();
    const notCancelled = fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(notCancelled).toBe(true);
  });

  it("포커스가 바깥(body)에 있을 때 Tab은 첫 요소로, Shift+Tab은 마지막 요소로 끌어온다", () => {
    render(<Trap />);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("첫째"));
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("마지막"));
  });

  it("닫히면 returnFocus가 돌려준 요소로 포커스를 돌려준다", () => {
    const { rerender } = render(<Harness open returnTo />);
    expect(document.activeElement).toBe(screen.getByText("첫째"));
    rerender(<Harness open={false} returnTo />);
    expect(document.activeElement).toBe(screen.getByText("바깥"));
  });

  it("returnFocus가 연결 끊긴 요소나 null이면 아무것도 하지 않는다", () => {
    const detached = document.createElement("button");
    const { unmount } = render(<Trap returnTo={() => detached} />);
    expect(() => unmount()).not.toThrow();
    const again = render(<Trap returnTo={() => null} />);
    expect(() => again.unmount()).not.toThrow();
  });

  it("StrictMode의 모의 언마운트 뒤에도 포커스가 안에 있다", () => {
    render(
      <StrictMode>
        <Trap />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(screen.getByText("첫째"));
  });
});
