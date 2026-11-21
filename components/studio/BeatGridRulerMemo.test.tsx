import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Studio } from "./Studio";
import * as geometry from "./geometry";
import {
  installAudioContextStub,
  renderWithStudio,
  startPlaying,
} from "./testing/harness";

// BeatGrid와 Ruler는 렌더마다 barLabels를 부른다(BeatGrid 2번, Ruler 1번). 호출 수로
// 두 컴포넌트가 다시 렌더됐는지 센다 — 다른 컴포넌트는 barLabels를 쓰지 않는다.
vi.mock("./geometry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./geometry")>();
  return { ...actual, barLabels: vi.fn(actual.barLabels) };
});

let restoreAudio: () => void;

beforeEach(() => {
  restoreAudio = installAudioContextStub();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // 재생 중 10Hz 위치 표본 타이머만 가짜로 돌린다.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.mocked(geometry.barLabels).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  restoreAudio();
});

const labelCalls = () => vi.mocked(geometry.barLabels).mock.calls.length;

describe("BeatGrid·Ruler 렌더 비용", () => {
  it("재생 위치(10Hz)가 바뀌어도 격자와 눈금자는 다시 렌더되지 않는다", async () => {
    const h = renderWithStudio(<Studio />);
    h.fake.engine.currentTick.mockReturnValue(1920 * 2);
    await startPlaying(h);
    expect(labelCalls()).toBeGreaterThan(0); // 최초 렌더는 그렸다

    const before = labelCalls();
    const pos = h.studio().position;
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(h.studio().position).not.toEqual(pos); // 위치는 실제로 바뀌었다
    expect(labelCalls()).toBe(before);
  });

  it("마디 수가 바뀌면 격자와 눈금자가 다시 렌더된다", () => {
    const h = renderWithStudio(<Studio />);
    const before = labelCalls();
    act(() => h.studio().edit.setBars(h.studio().song.bars + 1));
    // BeatGrid(2) + Ruler(1)
    expect(labelCalls()).toBe(before + 3);
  });
});
