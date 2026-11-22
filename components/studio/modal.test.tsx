import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { hasOpenModal, useModalOpenCount } from "./modal";

function Modal({ open }: { open: boolean }) {
  useModalOpenCount(open);
  return null;
}

afterEach(() => {
  cleanup();
  // 카운터가 새면(정리 누락) 다음 테스트와 전역 단축키로 번진다.
  expect(hasOpenModal()).toBe(false);
});

describe("모달 열림 표시", () => {
  it("열린 동안 켜지고 닫히면 꺼진다", () => {
    const { rerender } = render(<Modal open={false} />);
    expect(hasOpenModal()).toBe(false);
    rerender(<Modal open />);
    expect(hasOpenModal()).toBe(true);
    rerender(<Modal open={false} />);
    expect(hasOpenModal()).toBe(false);
  });

  it("열린 채 언마운트되면 꺼진다", () => {
    const { unmount } = render(<Modal open />);
    expect(hasOpenModal()).toBe(true);
    unmount();
    expect(hasOpenModal()).toBe(false);
  });

  it("열려 있는 채 다시 렌더해도 한 번만 센다(멱등)", () => {
    const { rerender } = render(<Modal open />);
    rerender(<Modal open />);
    rerender(<Modal open />);
    rerender(<Modal open={false} />);
    expect(hasOpenModal()).toBe(false);
  });

  it("열고 닫기를 되풀이해도 균형이 맞는다", () => {
    const { rerender } = render(<Modal open={false} />);
    for (let i = 0; i < 3; i++) {
      rerender(<Modal open />);
      expect(hasOpenModal()).toBe(true);
      rerender(<Modal open={false} />);
      expect(hasOpenModal()).toBe(false);
    }
  });

  it("여러 모달이 겹치면 모두 닫혀야 꺼진다", () => {
    const a = render(<Modal open />);
    const b = render(<Modal open />);
    a.unmount();
    expect(hasOpenModal()).toBe(true);
    b.unmount();
    expect(hasOpenModal()).toBe(false);
  });

  it("StrictMode의 모의 언마운트·재마운트에서도 균형이 맞는다", () => {
    const strict = (open: boolean) => (
      <StrictMode>
        <Modal open={open} />
      </StrictMode>
    );
    const opened = render(strict(true));
    expect(hasOpenModal()).toBe(true);
    opened.unmount();
    expect(hasOpenModal()).toBe(false);

    const toggled = render(strict(false));
    expect(hasOpenModal()).toBe(false);
    toggled.rerender(strict(true));
    expect(hasOpenModal()).toBe(true);
    toggled.rerender(strict(false));
    expect(hasOpenModal()).toBe(false);
  });
});
