import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { songLengthTicks } from "@/lib/score/time";

import { BeatGrid } from "./BeatGrid";
import { Ruler } from "./Ruler";
import { Studio } from "./Studio";
import { PX_PER_BAR, tickToX } from "./geometry";
import {
  CHORD_LANE_HEIGHT,
  HEADER_WIDTH,
  RULER_HEIGHT,
  TRACK_LANE_HEIGHT,
} from "./layout";
import { installAudioContextStub, renderWithStudio } from "./testing/harness";

let restoreAudio: () => void;
let frames: FrameRequestCallback[];

beforeEach(() => {
  restoreAudio = installAudioContextStub();
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  restoreAudio();
});

describe("Studio", () => {
  it("Provider 안에서 데모 곡의 트랙 4개와 마디 눈금 8개를 그린다", () => {
    const { studio } = renderWithStudio(<Studio />);
    const song = studio().song;

    expect(song.tracks).toHaveLength(4);
    const ruler = screen.getByTestId("ruler");
    expect(within(ruler).getAllByText(/^\d+$/).map((e) => e.textContent)).toEqual(
      Array.from({ length: song.bars }, (_, i) => String(i + 1)),
    );
    expect(song.bars).toBe(8);
  });

  it("트랙 헤더는 곡의 트랙 순서대로 한국어 악기 이름을 보인다", () => {
    renderWithStudio(<Studio />);
    const headers = within(screen.getByTestId("track-headers"));

    expect(
      headers.getAllByTestId(/^track-header-/).map((e) => e.textContent),
    ).toEqual(["피아노", "기타", "베이스", "드럼"]);
    expect(headers.getByText("코드")).toBeTruthy();
    expect(screen.getByTestId("track-headers").style.width).toBe(`${HEADER_WIDTH}px`);
  });

  it("타임라인 폭은 bars × PX_PER_BAR이고 스크롤 영역 클래스를 가진다", () => {
    const { studio } = renderWithStudio(<Studio />);
    const timeline = screen.getByTestId("timeline");
    expect(timeline.className).toContain("timeline-scroll");
    expect(screen.getByTestId("stage").style.width).toBe(
      `${studio().song.bars * PX_PER_BAR}px`,
    );
  });

  it("4/4의 박 구분선은 마디당 4개다", () => {
    const { studio } = renderWithStudio(<Studio />);
    const lines = screen.getByTestId("timeline").querySelectorAll("[data-beat-line]");
    expect(lines).toHaveLength(studio().song.bars * 4);
  });

  it("코드 레인과 트랙 레인 자리가 헤더와 같은 높이 상수로 놓인다", () => {
    const { studio } = renderWithStudio(<Studio />);
    expect(screen.getByTestId("chord-lane").style.height).toBe(`${CHORD_LANE_HEIGHT}px`);
    expect(screen.getByTestId("chord-lane-header").style.height).toBe(
      `${CHORD_LANE_HEIGHT}px`,
    );
    expect(screen.getByTestId("ruler").style.height).toBe(`${RULER_HEIGHT}px`);
    for (const track of studio().song.tracks) {
      expect(screen.getByTestId(`track-lane-${track.id}`).style.height).toBe(
        `${TRACK_LANE_HEIGHT}px`,
      );
      expect(screen.getByTestId(`track-header-${track.id}`).style.height).toBe(
        `${TRACK_LANE_HEIGHT}px`,
      );
    }
  });

  it("상단 바가 같이 그려진다", () => {
    renderWithStudio(<Studio />);
    expect(screen.getByRole("button", { name: "재생" })).toBeTruthy();
    expect(screen.getByLabelText("템포")).toBeTruthy();
  });

  it("재생하면 플레이헤드가 엔진 틱을 따라 움직이고 곡 끝에서 멈춘다", async () => {
    const { fake, studio } = renderWithStudio(<Studio />);
    const playhead = screen.getByTestId("playhead");
    expect(playhead.style.transform).toBe("translateX(0px)");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "재생" }));
    });
    fake.engine.currentTick.mockReturnValue(960);
    act(() => frames.splice(0).forEach((cb) => cb(0)));
    expect(playhead.style.transform).toBe("translateX(80px)");

    const length = songLengthTicks(studio().song);
    fake.engine.currentTick.mockReturnValue(length + 999);
    act(() => frames.splice(0).forEach((cb) => cb(0)));
    expect(playhead.style.transform).toBe(`translateX(${tickToX(length - 1)}px)`);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "정지" }));
    });
    expect(playhead.style.transform).toBe("translateX(0px)");
  });
});

describe("Ruler", () => {
  it("마디 번호 1..bars 라벨을 bars개 그린다", () => {
    render(<Ruler bars={3} />);
    const labels = screen.getAllByText(/^\d+$/);
    expect(labels.map((e) => e.textContent)).toEqual(["1", "2", "3"]);
    expect(labels[0].className).toContain("tabular-nums");
  });

  it("bars가 0이면 라벨이 없다", () => {
    render(<Ruler bars={0} />);
    expect(screen.queryAllByText(/^\d+$/)).toHaveLength(0);
  });
});

describe("BeatGrid", () => {
  it("마디당 박 수만큼 선을 그리고 마디의 첫 선만 마디선이다", () => {
    const { container } = render(<BeatGrid bars={2} beatsPerBar={3} />);
    const lines = container.querySelectorAll<HTMLElement>("[data-beat-line]");

    expect(lines).toHaveLength(6);
    expect(Array.from(lines).map((l) => l.style.left)).toEqual([
      "0px",
      `${PX_PER_BAR / 3}px`,
      `${(PX_PER_BAR * 2) / 3}px`,
      `${PX_PER_BAR}px`,
      `${PX_PER_BAR + PX_PER_BAR / 3}px`,
      `${PX_PER_BAR + (PX_PER_BAR * 2) / 3}px`,
    ]);
    expect(Array.from(lines).map((l) => l.hasAttribute("data-bar-line"))).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
  });
});
