import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Playhead } from "./Playhead";
import { tickToX } from "./geometry";

const LENGTH = 1920 * 8;

let callbacks: Map<number, FrameRequestCallback>;
let nextId: number;
let raf: ReturnType<typeof vi.fn>;
let caf: ReturnType<typeof vi.fn>;

/** 대기 중인 프레임 콜백을 한 번 돌린다(그 안에서 다음 프레임이 예약된다). */
function runFrame() {
  const pending = [...callbacks.entries()];
  callbacks.clear();
  for (const [, cb] of pending) cb(0);
}

beforeEach(() => {
  callbacks = new Map();
  nextId = 1;
  raf = vi.fn((cb: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  });
  caf = vi.fn((id: number) => {
    callbacks.delete(id);
  });
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", caf);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function transformOf(container: HTMLElement): string {
  return container.querySelector<HTMLElement>("[data-testid='playhead']")!.style
    .transform;
}

function engineAt(tick: number | (() => number)) {
  return { currentTick: vi.fn(typeof tick === "function" ? tick : () => tick) };
}

describe("Playhead", () => {
  it("재생 중 한 프레임 돌리면 틱을 px로 바꿔 transform에 쓴다 (960틱 → 80px)", () => {
    const { container } = render(
      <Playhead engine={engineAt(960)} playing lengthTicks={LENGTH} />,
    );
    runFrame();
    expect(transformOf(container)).toBe("translateX(80px)");
  });

  it("곡 끝을 넘는 틱은 (lengthTicks - 1)에 클램프한다", () => {
    const { container } = render(
      <Playhead engine={engineAt(LENGTH + 5000)} playing lengthTicks={LENGTH} />,
    );
    runFrame();
    expect(transformOf(container)).toBe(`translateX(${tickToX(LENGTH - 1)}px)`);
  });

  it.each([NaN, Infinity, -Infinity, -50])(
    "비정상 틱 %s는 0으로 본다",
    (tick) => {
      const { container } = render(
        <Playhead engine={engineAt(tick)} playing lengthTicks={LENGTH} />,
      );
      runFrame();
      expect(transformOf(container)).toBe("translateX(0px)");
    },
  );

  it("프레임마다 다음 프레임을 예약해 엔진 틱을 따라간다", () => {
    let tick = 0;
    const { container } = render(
      <Playhead engine={engineAt(() => tick)} playing lengthTicks={LENGTH} />,
    );
    tick = 480;
    runFrame();
    expect(transformOf(container)).toBe("translateX(40px)");
    tick = 1920;
    runFrame();
    expect(transformOf(container)).toBe("translateX(160px)");
  });

  it("정지하면 루프를 마지막 프레임 id로 취소하고 translateX(0px)로 돌아간다", () => {
    const engine = engineAt(960);
    const { container, rerender } = render(
      <Playhead engine={engine} playing lengthTicks={LENGTH} />,
    );
    runFrame();
    expect(transformOf(container)).toBe("translateX(80px)");
    const lastId = raf.mock.results.at(-1)!.value as number;

    rerender(<Playhead engine={engine} playing={false} lengthTicks={LENGTH} />);

    expect(caf).toHaveBeenCalledWith(lastId);
    expect(callbacks.size).toBe(0);
    expect(transformOf(container)).toBe("translateX(0px)");
  });

  it("정지 뒤에는 더 이상 엔진을 읽지 않는다", () => {
    const engine = engineAt(960);
    const { rerender } = render(
      <Playhead engine={engine} playing lengthTicks={LENGTH} />,
    );
    runFrame();
    const reads = engine.currentTick.mock.calls.length;
    rerender(<Playhead engine={engine} playing={false} lengthTicks={LENGTH} />);
    runFrame();
    expect(engine.currentTick.mock.calls.length).toBe(reads);
  });

  it("언마운트하면 루프를 취소한다", () => {
    const { unmount } = render(
      <Playhead engine={engineAt(0)} playing lengthTicks={LENGTH} />,
    );
    runFrame();
    const lastId = raf.mock.results.at(-1)!.value as number;
    unmount();
    expect(caf).toHaveBeenCalledWith(lastId);
    expect(callbacks.size).toBe(0);
  });

  it("playing이 거짓이면 rAF를 한 번도 요청하지 않고 0px에 있다", () => {
    const engine = engineAt(960);
    const { container } = render(
      <Playhead engine={engine} playing={false} lengthTicks={LENGTH} />,
    );
    expect(raf).not.toHaveBeenCalled();
    expect(engine.currentTick).not.toHaveBeenCalled();
    expect(transformOf(container)).toBe("translateX(0px)");
  });

  it("빨간 세로선이고 포인터를 가로채지 않는다", () => {
    const { container } = render(
      <Playhead engine={engineAt(0)} playing={false} lengthTicks={LENGTH} />,
    );
    const el = container.querySelector("[data-testid='playhead']")!;
    expect(el.className).toContain("bg-red-500");
    expect(el.className).toContain("pointer-events-none");
  });
});
