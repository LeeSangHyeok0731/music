import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AUTOSAVE_KEY, serializeSong } from "@/lib/score/autosave";
import { buildDemoSong } from "@/lib/score/demo-song";
import { MAX_BARS_UI } from "@/lib/score/edit";
import type { Song } from "@/lib/score/model";
import { ticksPerBar } from "@/lib/score/time";

import { BarsControl } from "./BarsControl";
import { installAudioContextStub, renderWithStudio } from "./testing/harness";

let restoreAudio: () => void;
beforeEach(() => {
  restoreAudio = installAudioContextStub();
});
afterEach(() => {
  cleanup();
  restoreAudio();
});

const add = () => screen.getByRole<HTMLButtonElement>("button", { name: "마디 추가" });
const remove = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "마디 삭제" });

/** 클립 없이 `bars`마디(65 이상도 된다)인 곡을 저장소에 넣어 불러오게 한다. */
function storedWithBars(bars: number): Record<string, string> {
  const demo = buildDemoSong();
  const length = bars * ticksPerBar(demo.timeSignature);
  const song: Song = {
    ...demo,
    bars,
    progression: [{ ...demo.progression[0], start: 0, length }],
    tracks: demo.tracks.map((t) => ({ ...t, clips: [] })),
  };
  return { [AUTOSAVE_KEY]: serializeSong(song) };
}

describe("BarsControl", () => {
  it("＋는 마디를 하나 늘리고 －는 하나 줄인다", () => {
    const { studio } = renderWithStudio(<BarsControl />);
    fireEvent.click(add());
    expect(studio().song.bars).toBe(9);
    fireEvent.click(remove());
    fireEvent.click(remove());
    expect(studio().song.bars).toBe(7);
  });

  it("64마디에서는 ＋가 진짜 disabled이고 －는 눌린다", () => {
    const { studio } = renderWithStudio(<BarsControl />, {
      stored: storedWithBars(MAX_BARS_UI),
    });
    expect(studio().song.bars).toBe(MAX_BARS_UI);
    expect(add().disabled).toBe(true);
    expect(remove().disabled).toBe(false);
    fireEvent.click(add());
    expect(studio().song.bars).toBe(MAX_BARS_UI);
  });

  it("1마디에서는 －가 진짜 disabled이고 ＋는 눌린다", () => {
    const { studio } = renderWithStudio(<BarsControl />, {
      stored: storedWithBars(1),
    });
    expect(remove().disabled).toBe(true);
    expect(add().disabled).toBe(false);
    fireEvent.click(remove());
    expect(studio().song.bars).toBe(1);
  });

  it("65마디 이상 곡은 두 버튼 모두 disabled라 클릭해도 곡이 그대로다(64로 잘려 내용을 잃지 않는다)", () => {
    const { studio } = renderWithStudio(<BarsControl />, {
      stored: storedWithBars(100),
    });
    const loaded = studio().song;
    expect(loaded.bars).toBe(100);
    expect(add().disabled).toBe(true);
    expect(remove().disabled).toBe(true);
    fireEvent.click(add());
    fireEvent.click(remove());
    expect(studio().song).toBe(loaded);
    expect(studio().canUndo).toBe(false);
  });

  it("재생 대기·재생 중에는 두 버튼 모두 disabled다", async () => {
    const { studio, fake } = renderWithStudio(<BarsControl />, {
      playMode: "manual",
    });
    await act(async () => {
      void studio().play();
    });
    expect(add().disabled).toBe(true);
    expect(remove().disabled).toBe(true);
    await act(async () => fake.resolvePlay({ status: "playing" }));
    expect(add().disabled).toBe(true);
    expect(remove().disabled).toBe(true);
    act(() => studio().stop());
    expect(add().disabled).toBe(false);
    expect(remove().disabled).toBe(false);
  });

  it("클립이 잘리게 줄이면 안내가 뜨고 빈 마디를 줄이면 뜨지 않는다", () => {
    const { studio } = renderWithStudio(<BarsControl />);
    fireEvent.click(add());
    fireEvent.click(remove());
    expect(studio().message).toBeNull();
    fireEvent.click(remove());
    expect(studio().message).toBe(
      "마디를 줄였습니다 — 되돌리기로 복구할 수 있습니다",
    );
  });
});
