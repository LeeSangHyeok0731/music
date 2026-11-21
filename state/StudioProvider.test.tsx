import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTOSAVE_KEY, loadSong, serializeSong } from "@/lib/score/autosave";
import { buildDemoSong, DEMO_BARS } from "@/lib/score/demo-song";
import type { Song } from "@/lib/score/model";
import { songLengthTicks } from "@/lib/score/time";
import { StudioProvider } from "@/state/StudioProvider";
import {
  acceptedSongs,
  createFakeDeps,
  type FakeDeps,
  type FakeDepsOptions,
} from "@/state/testing/fake-deps";
import { useStudio } from "@/state/useStudio";

const UNREADABLE = "저장된 곡을 읽지 못해 데모 곡으로 시작합니다";
const PLAY_FAILED = "소리를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.";
const SAVE_FAILED = "브라우저에 저장하지 못했습니다";
const EDIT_FAILED = "편집을 적용하지 못했습니다";

/** 데모와 템포·첫 코드가 다른, 올바른 v3 곡. */
function storedSong(): Song {
  const song = buildDemoSong();
  return {
    ...song,
    tempo: 97,
    progression: song.progression.map((seg, i) =>
      i === 0 ? { ...seg, chord: { root: 2, quality: "min7" as const } } : seg,
    ),
  };
}

function setup(options: FakeDepsOptions | FakeDeps = {}) {
  const fake = "createDeps" in options ? options : createFakeDeps(options);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider createDeps={fake.createDeps}>{children}</StudioProvider>
  );
  const hook = renderHook(() => useStudio(), { wrapper });
  return { fake, ...hook, api: () => hook.result.current };
}

function installFakeTimers() {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
}

/** 데모 곡의 첫 구간(C maj)을 D min으로 바꾸는, 실제로 곡을 바꾸는 편집. */
const changeFirstChord = { root: 2, quality: "min" as const };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("1. 초기 곡", () => {
  it("저장된 것이 없으면 데모 곡으로 시작하고 안내가 없다", () => {
    const { api } = setup();
    expect(api().song).toEqual(buildDemoSong());
    expect(api().message).toBeNull();
    expect(api().canUndo).toBe(false);
  });

  it("올바른 저장값이 있으면 그 곡으로 시작하고, 복원은 실행취소에 쌓이지 않는다", () => {
    const { api } = setup({
      stored: { [AUTOSAVE_KEY]: serializeSong(storedSong()) },
    });
    expect(api().song).toEqual(storedSong());
    expect(api().message).toBeNull();
    expect(api().canUndo).toBe(false);
  });

  it("깨진 저장값이면 데모 곡과 안내", () => {
    const { api } = setup({ stored: { [AUTOSAVE_KEY]: "{not json" } });
    expect(api().song).toEqual(buildDemoSong());
    expect(api().message).toBe(UNREADABLE);
  });

  it("옛 v2 곡이면 데모 곡과 안내", () => {
    const v2 = { ...buildDemoSong(), v: 2 };
    const { api } = setup({ stored: { [AUTOSAVE_KEY]: JSON.stringify(v2) } });
    expect(api().song).toEqual(buildDemoSong());
    expect(api().message).toBe(UNREADABLE);
  });

  it("저장소가 없으면(null) 데모 곡", () => {
    const { api } = setup({ storage: false });
    expect(api().song).toEqual(buildDemoSong());
    expect(api().message).toBeNull();
  });

  it("저장소 읽기가 던져도 데모 곡으로 시작한다", () => {
    const fake = createFakeDeps();
    fake.storage!.failGetItem = true;
    const { api } = setup(fake);
    expect(api().song).toEqual(buildDemoSong());
  });
});

describe("2. 편집과 실행취소", () => {
  it("편집 액션은 lib/score/edit.ts의 편집 집합과 정확히 같다", () => {
    const { api } = setup();
    expect(Object.keys(api().edit).sort()).toEqual(
      [
        "addClip",
        "mergeSegments",
        "moveBoundary",
        "moveClip",
        "removeClip",
        "resizeClip",
        "setBars",
        "setChord",
        "setClipPattern",
        "setTrackPattern",
        "splitSegment",
      ],
    );
  });

  it("편집이 곡을 바꾸고 canUndo가 참이 되며 undo가 되돌린다", () => {
    const { api } = setup();
    const before = api().song;

    act(() => api().edit.setChord(0, changeFirstChord));
    expect(api().song.progression[0].chord).toEqual(changeFirstChord);
    expect(api().canUndo).toBe(true);

    act(() => api().undo());
    expect(api().song).toBe(before);
    expect(api().canUndo).toBe(false);
  });

  it("제자리 편집(no-op)은 기록되지 않는다", () => {
    const { api } = setup();
    const before = api().song;
    act(() => api().edit.setChord(0, { root: 0, quality: "maj" }));
    expect(api().song).toBe(before);
    expect(api().canUndo).toBe(false);
  });

  it("한 이벤트 안의 연속 편집은 모두 적용되고 각각 한 칸이다", () => {
    const { api } = setup();
    act(() => {
      api().edit.setBars(9);
      api().edit.setChord(0, changeFirstChord);
    });
    expect(api().song.bars).toBe(9);
    expect(api().song.progression[0].chord).toEqual(changeFirstChord);

    act(() => api().undo());
    expect(api().song.bars).toBe(9);
    expect(api().song.progression[0].chord).toEqual({ root: 0, quality: "maj" });
    act(() => api().undo());
    expect(api().song.bars).toBe(DEMO_BARS);
    expect(api().canUndo).toBe(false);
  });

  it("실행취소는 최근 50칸까지만 남는다", () => {
    const { api } = setup();
    // 8 -> 9, 10, ..., 59 (51번)
    for (let bars = 9; bars <= 59; bars++) {
      act(() => api().edit.setBars(bars));
    }
    for (let i = 0; i < 50; i++) act(() => api().undo());
    expect(api().song.bars).toBe(9);
    expect(api().canUndo).toBe(false);
  });

  it("던지는 편집(없는 id)은 앱을 죽이지 않고 곡을 그대로 두며 안내한다", () => {
    const { api } = setup();
    const before = api().song;
    act(() => api().edit.removeClip("track-piano", "no-such-clip"));
    expect(api().song).toBe(before);
    expect(api().canUndo).toBe(false);
    expect(api().message).toBe(EDIT_FAILED);

    act(() => api().dismissMessage());
    expect(api().message).toBeNull();

    act(() => api().edit.setClipPattern("track-piano", "piano-0", "drum-basic-rock"));
    expect(api().song).toBe(before);
    expect(api().message).toBe(EDIT_FAILED);
  });

  it("선택은 지금 곡에 있는 클립만 가리킨다", () => {
    const { api } = setup();
    const sel = { trackId: "track-piano", clipId: "piano-1" };
    act(() => api().select(sel));
    expect(api().selection).toEqual(sel);

    act(() => api().edit.removeClip("track-piano", "piano-1"));
    expect(api().selection).toBeNull();

    act(() => api().select({ trackId: "track-piano", clipId: "nope" }));
    expect(api().selection).toBeNull();

    act(() => api().select(null));
    expect(api().selection).toBeNull();
  });

  it("지운 클립의 선택은 지워져서, 같은 id로 다시 생긴 클립이 선택되지 않는다", () => {
    const { api } = setup();
    act(() => api().edit.removeClip("track-piano", "piano-0"));
    act(() => api().edit.addClip("track-piano", 0));
    // 클립 id는 재사용된다 — 이 전제가 바뀌면 테스트가 무엇을 지키는지도 바뀐다.
    expect(api().song.tracks[0].clips[0].id).toBe("clip-1");
    act(() => api().select({ trackId: "track-piano", clipId: "clip-1" }));
    expect(api().selection).toEqual({ trackId: "track-piano", clipId: "clip-1" });

    act(() => api().edit.removeClip("track-piano", "clip-1"));
    act(() => api().edit.addClip("track-piano", 0));
    expect(api().song.tracks[0].clips[0].id).toBe("clip-1");
    expect(api().selection).toBeNull();
  });

  it("없는 클립을 고르면 선택하지 않아서, 나중에 그 id가 생겨도 선택되지 않는다", () => {
    const { api } = setup();
    act(() => api().edit.removeClip("track-piano", "piano-0"));
    act(() => api().select({ trackId: "track-piano", clipId: "clip-1" }));
    act(() => api().edit.addClip("track-piano", 0));
    expect(api().song.tracks[0].clips[0].id).toBe("clip-1");
    expect(api().selection).toBeNull();
  });

  it("선택한 클립을 지운 뒤 실행취소로 되살려도 선택은 지워진 채다", () => {
    const { api } = setup();
    act(() => api().select({ trackId: "track-piano", clipId: "piano-1" }));
    act(() => api().edit.removeClip("track-piano", "piano-1"));
    act(() => api().undo());
    expect(api().song.tracks[0].clips.some((c) => c.id === "piano-1")).toBe(true);
    expect(api().selection).toBeNull();
  });

  it("다른 클립을 편집해도 선택은 유지된다", () => {
    const { api } = setup();
    const sel = { trackId: "track-piano", clipId: "piano-1" };
    act(() => api().select(sel));
    act(() => api().edit.removeClip("track-bass", "bass-0"));
    expect(api().selection).toEqual(sel);
  });
});

describe("3. 엔진 동기화", () => {
  it("정지 중 편집 뒤 engine.setSong이 최신 곡으로 불리고 받아들여진다", () => {
    const { api, fake } = setup();
    act(() => api().edit.setChord(0, changeFirstChord));
    expect(fake.engine.setSong).toHaveBeenLastCalledWith(api().song);
    expect(acceptedSongs(fake.engine).at(-1)).toBe(api().song);
  });

  it("복원된 곡도 엔진에 맞춘다", () => {
    const { api, fake } = setup({
      stored: { [AUTOSAVE_KEY]: serializeSong(storedSong()) },
    });
    expect(acceptedSongs(fake.engine).at(-1)).toBe(api().song);
    expect(api().song.tempo).toBe(97);
  });
});

describe("4. 재생 상태는 play()가 playing으로 끝났을 때만 켜진다", () => {
  it("기다리는 동안 playing 거짓·pending 참·editable 거짓이고 편집·실행취소가 무시된다", async () => {
    const { api, fake } = setup({ playMode: "manual" });
    act(() => api().edit.setBars(9));
    const afterEdit = api().song;

    act(() => {
      void api().play();
    });
    expect(fake.engine.play).toHaveBeenCalledTimes(1);
    expect(api().playing).toBe(false);
    expect(api().pending).toBe(true);
    expect(api().editable).toBe(false);

    act(() => api().edit.setChord(0, changeFirstChord));
    act(() => api().undo());
    expect(api().song).toBe(afterEdit);
    expect(api().canUndo).toBe(true);

    await act(async () => fake.resolvePlay({ status: "playing" }));
    expect(api().playing).toBe(true);
    expect(api().pending).toBe(false);
    expect(api().editable).toBe(false);
  });

  it("기다리는 중에 play()를 다시 불러도 엔진은 한 번만 불린다", async () => {
    const { api, fake } = setup({ playMode: "manual" });
    act(() => {
      void api().play();
      void api().play();
    });
    expect(fake.engine.play).toHaveBeenCalledTimes(1);
    await act(async () => fake.resolvePlay({ status: "playing" }));
    await act(async () => api().play());
    expect(fake.engine.play).toHaveBeenCalledTimes(1);
    expect(api().playing).toBe(true);
  });

  it("not-ready면 실패 악기 이름을 알리고 편집 가능으로 돌아가며 대기 중 바뀐 곡으로 엔진을 다시 맞춘다", async () => {
    const { api, fake } = setup({ playMode: "manual" });
    act(() => {
      void api().play();
    });
    // 대기 중에 허용되는 유일한 곡 변경은 템포다. 엔진은 지금 setSong을 거절한다.
    act(() => api().setTempo(90));
    expect(fake.engine.setTempo).toHaveBeenLastCalledWith(90);
    expect(acceptedSongs(fake.engine).at(-1)?.tempo).toBe(120);

    await act(async () =>
      fake.resolvePlay({ status: "not-ready", failed: ["piano", "drums"] }),
    );

    expect(api().message).toBe(
      "샘플을 불러오지 못한 악기가 있어 재생하지 않았습니다: 피아노, 드럼",
    );
    expect(api().playing).toBe(false);
    expect(api().pending).toBe(false);
    expect(api().editable).toBe(true);
    const synced = acceptedSongs(fake.engine).at(-1);
    expect(synced).toBe(api().song);
    expect(synced?.tempo).toBe(90);

    act(() => api().edit.setChord(0, changeFirstChord));
    expect(api().song.progression[0].chord).toEqual(changeFirstChord);
  });

  it.each(["superseded", "already-playing"] as const)(
    "%s이면 재생도 안내도 없이 편집 가능으로 돌아간다",
    async (status) => {
      const { api, fake } = setup({ playMode: "manual" });
      act(() => {
        void api().play();
      });
      await act(async () => fake.resolvePlay({ status }));
      expect(api().playing).toBe(false);
      expect(api().pending).toBe(false);
      expect(api().editable).toBe(true);
      expect(api().message).toBeNull();
    },
  );

  it("play()가 거부되면 다시 누르라는 안내를 하고 편집 가능으로 돌아간다", async () => {
    const { api } = setup({ playMode: { reject: new Error("resume failed") } });
    let returned: Promise<void> | undefined;
    await act(async () => {
      returned = api().play();
      await returned;
    });
    await expect(returned).resolves.toBeUndefined();
    expect(api().message).toBe(PLAY_FAILED);
    expect(api().playing).toBe(false);
    expect(api().editable).toBe(true);
  });

  it("기다리는 중 stop() 뒤에 늦게 온 playing 결과는 상태를 바꾸지 못한다", async () => {
    const { api, fake } = setup({ playMode: "manual" });
    act(() => {
      void api().play();
    });
    act(() => api().stop());
    expect(fake.engine.stop).toHaveBeenCalledTimes(1);
    expect(api().pending).toBe(false);
    expect(api().editable).toBe(true);

    await act(async () => fake.resolvePlay({ status: "playing" }));
    expect(api().playing).toBe(false);
    expect(api().pending).toBe(false);
    expect(api().editable).toBe(true);
  });

  it("기다리는 중 stop() 뒤에 늦게 온 거부는 안내를 띄우지 않는다", async () => {
    const { api, fake } = setup({ playMode: "manual" });
    act(() => {
      void api().play();
    });
    act(() => api().stop());
    await act(async () => fake.rejectPlay(new Error("late")));
    expect(api().message).toBeNull();
    expect(api().editable).toBe(true);
  });

  it("언마운트 뒤에 끝난 play()는 아무것도 하지 않는다", async () => {
    const { api, fake, unmount } = setup({ playMode: "manual" });
    act(() => {
      void api().play();
    });
    unmount();
    await act(async () => fake.resolvePlay({ status: "playing" }));
    expect(fake.engine.dispose).toHaveBeenCalled();
  });
});

describe("5. 정지와 자동 정지", () => {
  /** 재생 → 3마디로 샘플링 → 재생 중 템포 90. */
  async function playThenChangeTempo() {
    installFakeTimers();
    const ctx = setup();
    const perBar = songLengthTicks(buildDemoSong()) / DEMO_BARS;
    ctx.fake.engine.currentTick.mockReturnValue(perBar * 2);
    await act(async () => ctx.api().play());
    expect(ctx.api().playing).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    expect(ctx.api().position).toEqual({ bar: 3, beat: 1 });

    act(() => ctx.api().setTempo(90));
    expect(ctx.fake.engine.setTempo).toHaveBeenLastCalledWith(90);
    // 재생 중에는 엔진이 곡을 받지 않는다.
    expect(acceptedSongs(ctx.fake.engine).at(-1)?.tempo).toBe(120);
    return ctx;
  }

  it("곡 끝 자동 정지: playing 거짓, 위치 1마디 1박, 바뀐 템포의 최신 곡으로 엔진을 맞춘다", async () => {
    const { api, fake } = await playThenChangeTempo();
    act(() => fake.autoStop());
    expect(api().playing).toBe(false);
    expect(api().editable).toBe(true);
    expect(api().position).toEqual({ bar: 1, beat: 1 });
    const synced = acceptedSongs(fake.engine).at(-1);
    expect(synced).toBe(api().song);
    expect(synced?.tempo).toBe(90);
  });

  it("stop(): 엔진을 멈추고 같은 결과", async () => {
    const { api, fake } = await playThenChangeTempo();
    act(() => api().stop());
    expect(fake.engine.stop).toHaveBeenCalledTimes(1);
    expect(api().playing).toBe(false);
    expect(api().position).toEqual({ bar: 1, beat: 1 });
    const synced = acceptedSongs(fake.engine).at(-1);
    expect(synced).toBe(api().song);
    expect(synced?.tempo).toBe(90);
  });
});

describe("6. 재생 중 편집과 템포", () => {
  it("재생 중 편집 액션과 실행취소는 곡을 바꾸지 않는다", async () => {
    const { api } = setup();
    act(() => api().edit.setBars(9));
    const before = api().song;
    await act(async () => api().play());
    expect(api().playing).toBe(true);

    act(() => {
      api().edit.setChord(0, changeFirstChord);
      api().edit.addClip("track-piano", 0);
      api().edit.removeClip("track-piano", "piano-0");
      api().edit.setBars(12);
      api().undo();
    });
    expect(api().song).toBe(before);
    expect(api().canUndo).toBe(true);
  });

  it("setTempo는 재생 중에도 엔진 템포와 곡 템포를 바꾸고 실행취소에 쌓이지 않는다", async () => {
    const { api, fake } = setup();
    await act(async () => api().play());
    act(() => api().setTempo(90));
    expect(fake.engine.setTempo).toHaveBeenLastCalledWith(90);
    expect(api().song.tempo).toBe(90);
    expect(api().canUndo).toBe(false);
  });

  it("템포는 실행취소로 되돌아가지 않는다(과거 스냅샷도 지금 템포)", () => {
    const { api } = setup();
    act(() => api().edit.setBars(9));
    act(() => api().setTempo(90));
    act(() => api().undo());
    expect(api().song.bars).toBe(DEMO_BARS);
    expect(api().song.tempo).toBe(90);
  });

  it("setTempo는 범위로 클램프한 값을 엔진에 준다", () => {
    const { api, fake } = setup();
    act(() => api().setTempo(1000));
    expect(api().song.tempo).toBe(240);
    expect(fake.engine.setTempo).toHaveBeenLastCalledWith(240);
  });

  it("메트로놈을 엔진에 전달한다", () => {
    const { api, fake } = setup();
    act(() => api().setMetronome(true));
    expect(api().metronome).toBe(true);
    expect(fake.engine.setMetronome).toHaveBeenLastCalledWith(true);
  });
});

describe("7. 자동 저장", () => {
  it("편집 뒤 299ms에는 저장하지 않고 300ms에 저장하며 저장값은 loadSong으로 왕복된다", () => {
    installFakeTimers();
    const { api, fake } = setup();
    act(() => api().edit.setChord(0, changeFirstChord));

    act(() => vi.advanceTimersByTime(299));
    expect(fake.storage!.setItem).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(fake.storage!.setItem).toHaveBeenCalledTimes(1);
    const [key, value] = fake.storage!.setItem.mock.calls[0];
    expect(key).toBe(AUTOSAVE_KEY);
    expect(loadSong(value)).toEqual({ song: api().song, notice: null });
  });

  it("연속 편집은 마지막 편집 뒤 한 번만 저장한다", () => {
    installFakeTimers();
    const { api, fake } = setup();
    act(() => api().edit.setChord(0, changeFirstChord));
    act(() => vi.advanceTimersByTime(200));
    act(() => api().edit.setBars(9));
    act(() => vi.advanceTimersByTime(299));
    expect(fake.storage!.setItem).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(fake.storage!.setItem).toHaveBeenCalledTimes(1);
    expect(loadSong(fake.storage!.setItem.mock.calls[0][1]).song).toEqual(api().song);
  });

  it("저장된 곡이 읽히지 않아도(v2) 첫 편집 전에는 절대 저장하지 않는다", () => {
    installFakeTimers();
    const v2 = JSON.stringify({ ...buildDemoSong(), v: 2 });
    const { api, fake } = setup({ stored: { [AUTOSAVE_KEY]: v2 } });
    expect(api().message).toBe(UNREADABLE);

    act(() => vi.advanceTimersByTime(10_000));
    window.dispatchEvent(new Event("pagehide"));
    expect(fake.storage!.setItem).not.toHaveBeenCalled();
    expect(fake.storage!.data.get(AUTOSAVE_KEY)).toBe(v2);

    act(() => api().edit.setChord(0, changeFirstChord));
    act(() => vi.advanceTimersByTime(300));
    expect(fake.storage!.setItem).toHaveBeenCalledTimes(1);
  });

  it("복원한 곡이나 데모 곡도 편집 전에는 저장하지 않는다", () => {
    installFakeTimers();
    const restored = setup({
      stored: { [AUTOSAVE_KEY]: serializeSong(storedSong()) },
    });
    const empty = setup();
    act(() => vi.advanceTimersByTime(10_000));
    expect(restored.fake.storage!.setItem).not.toHaveBeenCalled();
    expect(empty.fake.storage!.setItem).not.toHaveBeenCalled();
  });

  it("제자리 편집과 던지는 편집은 저장을 걸지 않는다", () => {
    installFakeTimers();
    const { api, fake } = setup();
    act(() => api().edit.setChord(0, { root: 0, quality: "maj" }));
    act(() => api().edit.removeClip("track-piano", "nope"));
    act(() => api().setTempo(120));
    act(() => vi.advanceTimersByTime(1000));
    expect(fake.storage!.setItem).not.toHaveBeenCalled();
  });

  it("템포 변경(실행취소 밖)과 실행취소도 저장한다", () => {
    installFakeTimers();
    const { api, fake } = setup();
    act(() => api().setTempo(90));
    act(() => vi.advanceTimersByTime(300));
    expect(fake.storage!.setItem).toHaveBeenCalledTimes(1);
    expect(loadSong(fake.storage!.setItem.mock.calls[0][1]).song.tempo).toBe(90);

    act(() => api().edit.setBars(9));
    act(() => vi.advanceTimersByTime(300));
    act(() => api().undo());
    act(() => vi.advanceTimersByTime(300));
    expect(fake.storage!.setItem).toHaveBeenCalledTimes(3);
    expect(loadSong(fake.storage!.setItem.mock.calls[2][1]).song.bars).toBe(DEMO_BARS);
  });

  it("setItem이 던져도 앱이 죽지 않고 안내는 한 번만 나온다", () => {
    installFakeTimers();
    const { api, fake } = setup();
    fake.storage!.failSetItem = true;

    act(() => api().edit.setChord(0, changeFirstChord));
    act(() => vi.advanceTimersByTime(300));
    expect(api().message).toBe(SAVE_FAILED);

    act(() => api().dismissMessage());
    act(() => api().edit.setBars(9));
    act(() => vi.advanceTimersByTime(300));
    expect(fake.storage!.setItem).toHaveBeenCalledTimes(2);
    expect(api().message).toBeNull();
    expect(api().song.bars).toBe(9);
  });

  it("pagehide 때 대기 중 저장을 즉시 하고 같은 곡을 다시 저장하지 않는다", () => {
    installFakeTimers();
    const { api, fake } = setup();
    act(() => api().edit.setChord(0, changeFirstChord));
    act(() => vi.advanceTimersByTime(100));

    window.dispatchEvent(new Event("pagehide"));
    expect(fake.storage!.setItem).toHaveBeenCalledTimes(1);
    expect(loadSong(fake.storage!.setItem.mock.calls[0][1]).song).toEqual(api().song);

    act(() => vi.advanceTimersByTime(1000));
    window.dispatchEvent(new Event("pagehide"));
    expect(fake.storage!.setItem).toHaveBeenCalledTimes(1);
  });

  it("저장소가 없으면 편집해도 조용히 건너뛴다", () => {
    installFakeTimers();
    const { api } = setup({ storage: false });
    act(() => api().edit.setChord(0, changeFirstChord));
    act(() => vi.advanceTimersByTime(300));
    expect(api().message).toBeNull();
    expect(api().song.progression[0].chord).toEqual(changeFirstChord);
  });
});

describe("8. 서버 렌더와 하이드레이션", () => {
  function Probe() {
    const s = useStudio();
    return (
      <p>
        <span data-testid="tempo">{s.song.tempo}</span>
        <span data-testid="chord">{s.song.progression[0].chord.root}</span>
        <span data-testid="piano">{s.sampleStatuses.piano}</span>
        <span data-testid="message">{s.message ?? ""}</span>
      </p>
    );
  }

  it("저장된 곡이 있어도 첫 렌더는 데모 곡이라 경고가 없고, 마운트 뒤 저장된 곡으로 바뀐다", async () => {
    // 서버의 실제 deps는 저장소가 없고(window 없음) 뱅크는 받지 않는다(전부 idle).
    const server = createFakeDeps({
      storage: false,
      statuses: { piano: "idle", guitar: "idle", bass: "idle", drums: "idle" },
    });
    const client = createFakeDeps({
      stored: { [AUTOSAVE_KEY]: serializeSong(storedSong()) },
      statuses: { piano: "loading" },
    });
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <StudioProvider createDeps={server.createDeps}>
        <Probe />
      </StudioProvider>,
    );
    document.body.appendChild(container);
    expect(container.querySelector("[data-testid=tempo]")?.textContent).toBe("120");

    const consoleError = vi.spyOn(console, "error");
    const onRecoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(
          container,
          <StudioProvider createDeps={client.createDeps}>
            <Probe />
          </StudioProvider>,
          { onRecoverableError },
        );
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(screen.getByTestId("tempo").textContent).toBe("97");
      expect(screen.getByTestId("chord").textContent).toBe("2");
      expect(screen.getByTestId("piano").textContent).toBe("loading");
      expect(client.storage!.setItem).not.toHaveBeenCalled();
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  });

  it("뱅크 상태가 바뀌면 sampleStatuses가 따라가고 retrySamples는 그 악기만 다시 받는다", () => {
    const { api, fake } = setup({ statuses: { guitar: "error" } });
    expect(api().sampleStatuses.guitar).toBe("error");
    act(() => api().retrySamples("guitar"));
    expect(fake.bank.prefetch).toHaveBeenLastCalledWith(["guitar"]);
    act(() => fake.bank.setStatuses({ guitar: "loading" }));
    expect(api().sampleStatuses.guitar).toBe("loading");
  });
});

describe("위치 표시", () => {
  it("재생 중에만 100ms마다 샘플링하고, 곡 끝을 넘은 틱은 마지막 마디·박으로 클램프한다", async () => {
    installFakeTimers();
    const { api, fake } = setup();
    const length = songLengthTicks(buildDemoSong());
    fake.engine.currentTick.mockReturnValue(length + length / DEMO_BARS);

    act(() => vi.advanceTimersByTime(1000));
    expect(fake.engine.currentTick).not.toHaveBeenCalled();

    await act(async () => api().play());
    act(() => vi.advanceTimersByTime(99));
    expect(api().position).toEqual({ bar: 1, beat: 1 });
    act(() => vi.advanceTimersByTime(1));
    // 데모는 8마디 4/4 — 마지막 틱은 8마디 4박이다.
    expect(DEMO_BARS).toBe(8);
    expect(api().position).toEqual({ bar: 8, beat: 4 });
  });

  it("같은 마디·박이면 이전 객체를 유지한다", async () => {
    installFakeTimers();
    const { api, fake } = setup();
    fake.engine.currentTick.mockReturnValue(1920 + 480);
    await act(async () => api().play());
    act(() => vi.advanceTimersByTime(100));
    const first = api().position;
    expect(first).toEqual({ bar: 2, beat: 2 });
    act(() => vi.advanceTimersByTime(300));
    expect(api().position).toBe(first);
  });
});

describe("9. 언마운트", () => {
  it("onStop을 떼고 dispose하며 남은 타이머가 없다(대기 중 저장은 버린다)", async () => {
    installFakeTimers();
    const { api, fake, unmount } = setup();
    expect(typeof fake.engine.onStop).toBe("function");

    act(() => api().edit.setChord(0, changeFirstChord)); // 저장 타이머
    await act(async () => api().play()); // 위치 인터벌
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(fake.engine.onStop).toBeNull();
    expect(fake.engine.dispose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    window.dispatchEvent(new Event("pagehide"));
    act(() => vi.advanceTimersByTime(1000));
    expect(fake.storage!.setItem).not.toHaveBeenCalled();
  });
});

describe("10. useStudio", () => {
  it("Provider 밖에서 쓰면 Error", () => {
    // React가 잡히지 않은 렌더 오류를 콘솔로 알리는 것은 이 테스트의 기대 동작이다.
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Outside() {
      useStudio();
      return null;
    }
    expect(() => render(<Outside />)).toThrow(/StudioProvider/);
  });
});
