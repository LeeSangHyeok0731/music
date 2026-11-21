import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOSAVE_KEY, loadSong, serializeSong } from "@/lib/score/autosave";
import { chordLabel, chordPitch } from "@/lib/score/chords";
import { buildDemoSong } from "@/lib/score/demo-song";
import { expandSong } from "@/lib/score/expand";
import type { Chord, Song } from "@/lib/score/model";
import { patternLabel } from "@/lib/score/pattern-labels";
import { getPattern, patternsFor } from "@/lib/score/patterns";
import { songLengthTicks, ticksPerBar } from "@/lib/score/time";
import { StudioProvider } from "@/state/StudioProvider";
import {
  acceptedSongs,
  createFakeDeps,
  type FakeDeps,
  type FakeDepsOptions,
} from "@/state/testing/fake-deps";
import type { StudioApi } from "@/state/types";
import { useStudio } from "@/state/useStudio";

import { Studio } from "./Studio";
import { installAudioContextStub } from "./testing/harness";
import {
  LANE_LEFT,
  firePointer,
  installPointerCaptureStubs,
  stubLaneRect,
  xAt,
} from "./testing/pointer";

/**
 * 편집 화면 전체 흐름(`<StudioProvider><Studio/></StudioProvider>`). 가짜 엔진·뱅크·저장소만
 * 끼우고 사용자가 하는 입력(클릭·포인터·키보드)으로 편집한다. 상태 API를 직접 부르지 않는다.
 * 서버 렌더는 node 환경이 필요해 `Studio.server.test.tsx`가 맡는다.
 */

const UNREADABLE = "저장된 곡을 읽지 못해 데모 곡으로 시작합니다";
const SHRUNK = "마디를 줄였습니다 — 되돌리기로 복구할 수 있습니다";
const BAR = ticksPerBar([4, 4]);
const FM: Chord = { root: 5, quality: "min" };

let restoreAudio: () => void;
let restorePointer: () => void;
let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  restoreAudio = installAudioContextStub();
  restorePointer = installPointerCaptureStubs();
  // Playhead는 rAF를 쓴다. 프레임은 돌리지 않는다(이 테스트의 관심사가 아니다).
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  errors = vi.spyOn(console, "error");
  warnings = vi.spyOn(console, "warn");
});

afterEach(() => {
  // 소음 검사는 복원이 끝난 뒤에 한다. 먼저 단언하면 한 테스트의 실패가 복원을 건너뛰어
  // fake timers·전역 스텁이 다음 테스트로 새어 나간다.
  let errorCalls: unknown[][] = [];
  let warnCalls: unknown[][] = [];
  try {
    cleanup();
  } finally {
    // 언마운트가 내는 소음도 센다.
    errorCalls = [...errors.mock.calls];
    warnCalls = [...warnings.mock.calls];
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restorePointer();
    restoreAudio();
  }
  // 경고·act 소음이 하나라도 있으면 실패한다.
  expect(errorCalls).toEqual([]);
  expect(warnCalls).toEqual([]);
});

/** 전체 트리를 마운트하고 가장 최근 `StudioApi`를 읽는 창을 돌려준다(읽기 전용으로만 쓴다). */
function mount(fake: FakeDeps, { strict = false } = {}) {
  const latest: { api: StudioApi | null } = { api: null };
  function Capture() {
    const api = useStudio();
    useEffect(() => {
      latest.api = api;
    });
    return null;
  }
  const tree = (
    <StudioProvider createDeps={fake.createDeps}>
      <Capture />
      <Studio />
    </StudioProvider>
  );
  const result = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { ...result, fake, studio: () => latest.api! };
}

function start(options: FakeDepsOptions = {}) {
  return mount(createFakeDeps(options));
}

/** 클립 없이 `bars`마디(65 이상도 된다)인 곡을 저장소에 넣는다. */
function storedWithBars(bars: number): Record<string, string> {
  const demo = buildDemoSong();
  const song: Song = {
    ...demo,
    bars,
    progression: [{ ...demo.progression[0], start: 0, length: bars * BAR }],
    tracks: demo.tracks.map((t) => ({ ...t, clips: [] })),
  };
  return { [AUTOSAVE_KEY]: serializeSong(song) };
}

const chordLane = () => screen.getByTestId("chord-lane");
const segment = (label: string) =>
  within(chordLane()).getByRole("button", { name: label });
const lane = (trackId: string) => screen.getByTestId(`track-lane-${trackId}`);
const addBar = () => screen.getByRole("button", { name: "마디 추가" });
const removeBar = () => screen.getByRole("button", { name: "마디 삭제" });
const rulerLabels = () =>
  within(screen.getByTestId("ruler")).getAllByText(/^\d+$/);

function pickRootF() {
  const dialog = screen.getByRole("dialog", { name: "코드 선택" });
  fireEvent.click(within(dialog).getByRole("button", { name: "F" }));
}

function ctrlZ() {
  fireEvent.keyDown(document.body, { key: "z", code: "KeyZ", ctrlKey: true });
}

/** Space는 `play()`/`stop()`을 부른다. 약속이 끝나며 일어나는 갱신까지 act 안에서 기다린다. */
async function pressSpace() {
  await act(async () => {
    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
  });
}

function pointerClick(el: Element, x = 0) {
  firePointer(el, "pointerdown", { clientX: x });
  firePointer(el, "pointerup", { clientX: x });
}

function lastAccepted(fake: FakeDeps): Song {
  const songs = acceptedSongs(fake.engine);
  return songs[songs.length - 1];
}

function pianoEventsIn(song: Song, from: number, to: number) {
  const piano = expandSong(song).find((t) => t.instrument === "piano")!;
  return piano.events
    .filter((e) => e.tick >= from && e.tick < to)
    .map((e) => [e.tick, e.pitch]);
}

describe("1~2. 코드를 바꾸면 악기가 따라오고 되돌리기로 복귀한다", () => {
  it("데모를 그린다: 코드 구간 C Am F G7과 트랙 4개", () => {
    const { studio } = start();
    const labels = within(chordLane())
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(labels).toEqual(["C", "Am", "F", "G7"]);
    expect(studio().song.tracks).toHaveLength(4);
    expect(screen.getAllByTestId(/^track-lane-/)).toHaveLength(4);
  });

  it("둘째 구간의 근음을 F로 고르면 엔진이 받은 곡의 피아노·기타·베이스가 F 계열이 된다", () => {
    const { fake, studio } = start();
    const original = buildDemoSong();

    fireEvent.click(segment("Am"));
    pickRootF();

    const accepted = lastAccepted(fake);
    expect(accepted).toBe(studio().song);
    expect(accepted.progression.map((s) => s.chord)).toEqual([
      original.progression[0].chord,
      FM, // 근음만 바뀌고 종류(m)는 그대로
      original.progression[2].chord,
      original.progression[3].chord,
    ]);
    expect(chordLabel(accepted.progression[1].chord)).toBe("Fm");

    // 피아노: 둘째 구간(3840~7680)의 음은 패턴의 각 스텝을 F m의 구성음으로 센 것과 같다.
    const arpeggio = getPattern("piano-arpeggio-8th")!;
    if (arpeggio.kind !== "harmonic") throw new Error("화음 패턴이어야 한다");
    const segStart = original.progression[1].start;
    const end = segStart + original.progression[1].length;
    const expected: number[][] = [];
    for (let bar = segStart; bar < end; bar += BAR) {
      for (const step of arpeggio.steps) {
        expected.push([
          bar + step.at,
          chordPitch(FM, step.degree, step.octave),
        ]);
      }
    }
    expect(pianoEventsIn(accepted, segStart, end)).toEqual(expected);
    // 바뀌기 전(Am)과는 달라야 의미가 있다.
    expect(pianoEventsIn(original, segStart, end)).not.toEqual(expected);

    // 기타·베이스·드럼: 화음 악기는 이 구간 음이 모두 F m의 음이름(F, G#, C)이고, 드럼은 그대로다.
    const fmPitchClasses = new Set([5, 8, 0]);
    const before = expandSong(original);
    const after = expandSong(accepted);
    for (const instrument of ["guitar", "bass"] as const) {
      const events = after
        .find((t) => t.instrument === instrument)!
        .events.filter((e) => e.tick >= segStart && e.tick < end);
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => fmPitchClasses.has(e.pitch % 12))).toBe(true);
    }
    expect(after.find((t) => t.instrument === "drums")).toEqual(
      before.find((t) => t.instrument === "drums"),
    );
    // 첫 구간(C)은 그대로다.
    expect(pianoEventsIn(accepted, 0, segStart)).toEqual(
      pianoEventsIn(original, 0, segStart),
    );
  });

  it("Ctrl+Z(키보드)로 되돌리면 엔진이 받는 곡이 원래 진행으로 돌아온다", () => {
    const { fake, studio } = start();
    fireEvent.click(segment("Am"));
    pickRootF();
    expect(screen.getByRole("button", { name: "되돌리기" })).toHaveProperty(
      "disabled",
      false,
    );

    ctrlZ();

    expect(studio().song).toEqual(buildDemoSong());
    expect(lastAccepted(fake).progression).toEqual(buildDemoSong().progression);
    expect(screen.getByRole("button", { name: "되돌리기" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("3. 클립 추가·패턴 변경·삭제", () => {
  it("빈 칸을 눌러 클립을 만들고, 팝오버에서 패턴을 바꾸고, ×로 지운다", () => {
    const { studio } = start();
    // 데모의 피아노 클립은 곡 전체를 덮는다. ＋로 만든 9마디가 빈 칸이다.
    fireEvent.click(addBar());
    const piano = lane("track-piano");
    stubLaneRect(piano, { left: LANE_LEFT, width: 9 * 160, height: 56 });
    const pianoClipIds = () =>
      within(piano)
        .queryAllByTestId(/^clip-/)
        .map((el) => el.getAttribute("data-testid")!.slice("clip-".length));
    expect(pianoClipIds()).toHaveLength(4);

    const x = xAt(8 * BAR + 240);
    firePointer(piano, "pointerdown", { clientX: x });
    firePointer(piano, "pointerup", { clientX: x });

    const ids = pianoClipIds();
    expect(ids).toHaveLength(5);
    const newId = ids.find((id) => !id.startsWith("piano-"))!;
    const clipNow = () =>
      studio()
        .song.tracks.find((t) => t.id === "track-piano")!
        .clips.find((c) => c.id === newId)!;
    expect(clipNow().start).toBe(8 * BAR);
    expect(clipNow().length).toBe(BAR);
    const tile = screen.getByTestId(`clip-${newId}`);
    expect(tile.getAttribute("data-selected")).toBe("true");

    // 패턴 바꾸기: 클립을 눌러 팝오버를 열고 다른 패턴을 고른다.
    const before = clipNow().body;
    const other = patternsFor("piano").find(
      (p) => before.type === "pattern" && p.id !== before.pattern,
    )!;
    pointerClick(within(tile).getByRole("button", { pressed: true }));
    const dialog = screen.getByRole("dialog", { name: "패턴 선택" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: patternLabel(other.id) }),
    );
    expect(clipNow().body).toEqual({ type: "pattern", pattern: other.id });

    // 삭제.
    fireEvent.click(within(tile).getByRole("button", { name: "클립 삭제" }));
    expect(pianoClipIds()).toHaveLength(4);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId(`clip-${newId}`)).toBeNull();
  });
});

describe("4. 마디 추가·삭제", () => {
  it("＋는 곡을 한 마디 늘리고 눈금이 9개가 된다; 빈 마디를 줄일 때는 안내가 없다", () => {
    const { fake, studio } = start();
    expect(rulerLabels()).toHaveLength(8);

    fireEvent.click(addBar());
    expect(studio().song.bars).toBe(9);
    expect(songLengthTicks(lastAccepted(fake))).toBe(9 * BAR);
    expect(rulerLabels().map((e) => e.textContent)).toEqual(
      Array.from({ length: 9 }, (_, i) => String(i + 1)),
    );

    fireEvent.click(removeBar());
    expect(studio().song.bars).toBe(8);
    expect(screen.queryByText(SHRUNK)).toBeNull();
    expect(studio().message).toBeNull();
  });

  it("－로 클립이 잘리게 줄이면 안내가 뜨고, 되돌리면 곡이 그대로 돌아온다", () => {
    const { fake, studio } = start();

    fireEvent.click(removeBar());
    expect(studio().song.bars).toBe(7);
    expect(screen.getByText(SHRUNK)).toBeTruthy();
    expect(songLengthTicks(lastAccepted(fake))).toBe(7 * BAR);

    ctrlZ();
    expect(studio().song).toEqual(buildDemoSong());
    expect(lastAccepted(fake)).toEqual(buildDemoSong());
  });
});

describe("5. 재생 중에는 편집할 수 없다", () => {
  it("Space로 시작(대기, aria-busy) -> 재생 중 -> 편집 불가 -> Space로 정지 -> 최신 곡이 엔진에 간다", async () => {
    const { fake, studio } = start({ playMode: "manual" });
    fireEvent.click(segment("Am"));
    pickRootF();
    const edited = studio().song;
    // 팝오버를 닫는다(재생 시작이 닫지만 흐름을 분명히 한다).
    fireEvent.keyDown(document.body, { key: "Escape" });

    // 시작: 엔진의 play()가 끝나기를 기다리는 동안.
    await pressSpace();
    expect(fake.engine.play).toHaveBeenCalledTimes(1);
    const playButton = screen.getByRole("button", { name: "재생" });
    expect(playButton.getAttribute("aria-busy")).toBe("true");
    expect(studio().editable).toBe(false);
    expect(addBar()).toHaveProperty("disabled", true);
    fireEvent.click(segment("F"));
    expect(screen.queryByRole("dialog")).toBeNull();
    ctrlZ();
    expect(studio().song).toBe(edited);
    await pressSpace(); // 대기 중 Space는 삼킨다
    expect(fake.engine.play).toHaveBeenCalledTimes(1);

    // 재생 중.
    await act(async () => fake.resolvePlay({ status: "playing" }));
    expect(studio().playing).toBe(true);
    expect(screen.getByText("재생 중에는 편집할 수 없습니다")).toBeTruthy();
    fireEvent.click(segment("F"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(addBar());
    ctrlZ();
    expect(studio().song).toBe(edited);

    // 템포는 재생 중에도 바뀐다. 정지 뒤 엔진은 그 최신 곡을 받아야 한다.
    fireEvent.change(screen.getByLabelText("템포"), { target: { value: "140" } });
    expect(fake.engine.setTempo).toHaveBeenLastCalledWith(140);

    await pressSpace();
    expect(fake.engine.stop).toHaveBeenCalledTimes(1);
    expect(studio().playing).toBe(false);
    expect(studio().editable).toBe(true);
    expect(studio().song.tempo).toBe(140);
    expect(lastAccepted(fake)).toBe(studio().song);

    // 다시 편집된다.
    fireEvent.click(segment("F"));
    expect(screen.getByRole("dialog", { name: "코드 선택" })).toBeTruthy();
  });
});

describe("6. 자동 저장과 복원", () => {
  it("편집 300ms 뒤 저장소에 곡이 들어가고 loadSong으로 왕복된다", () => {
    const { fake, studio } = start();
    fireEvent.click(segment("Am"));
    pickRootF();

    act(() => vi.advanceTimersByTime(299));
    expect(fake.storage!.setItem).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(fake.storage!.setItem).toHaveBeenCalledTimes(1);

    const loaded = loadSong(fake.storage!.data.get(AUTOSAVE_KEY) ?? null);
    expect(loaded.notice).toBeNull();
    expect(loaded.song).toEqual(studio().song);
  });

  it("전체 트리를 다시 마운트하면(같은 저장소) 편집한 곡이 복원되고 저장은 다시 쓰이지 않는다", () => {
    const first = start();
    fireEvent.click(segment("Am"));
    pickRootF();
    const edited = first.studio().song;
    act(() => vi.advanceTimersByTime(300));
    const storage = first.fake.storage!;
    expect(storage.data.get(AUTOSAVE_KEY)).toBeDefined();
    first.unmount();
    const writes = storage.setItem.mock.calls.length;

    // 새로고침: 엔진·뱅크는 새것이고 저장소는 같은 객체다.
    const fresh = createFakeDeps();
    const second = mount({
      ...fresh,
      createDeps: () => ({ engine: fresh.engine, bank: fresh.bank, storage }),
    });
    expect(second.studio().song).toEqual(edited);
    expect(
      within(chordLane())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["C", "Fm", "F", "G7"]);
    expect(second.studio().canUndo).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(storage.setItem.mock.calls.length).toBe(writes);
    expect(lastAccepted(second.fake)).toEqual(edited);
  });

  it.each([
    ["깨진 문자열", "{not json"],
    ["옛 v2 곡", JSON.stringify({ ...buildDemoSong(), v: 2 })],
  ])("%s이면 데모 곡과 안내를 보이고 다음 편집 전까지 저장하지 않는다", (_, raw) => {
    const { fake, studio } = start({ stored: { [AUTOSAVE_KEY]: raw } });
    expect(studio().song).toEqual(buildDemoSong());
    expect(screen.getByText(UNREADABLE)).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(fake.storage!.setItem).not.toHaveBeenCalled();
    expect(fake.storage!.data.get(AUTOSAVE_KEY)).toBe(raw);

    fireEvent.click(segment("Am"));
    pickRootF();
    act(() => vi.advanceTimersByTime(300));
    expect(fake.storage!.setItem).toHaveBeenCalledTimes(1);
    expect(loadSong(fake.storage!.data.get(AUTOSAVE_KEY)!).song).toEqual(
      studio().song,
    );
  });
});

describe("7. StrictMode", () => {
  it("모의 언마운트·재마운트 뒤에도 저장하지 않고, 엔진이 살아 있어 편집·재생·자동 정지가 된다", async () => {
    const { fake, studio } = mount(createFakeDeps(), { strict: true });
    expect(fake.storage!.setItem).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(fake.storage!.setItem).not.toHaveBeenCalled();

    // StrictMode는 마운트 직후 효과를 정리했다가 다시 돌린다: 엔진이 dispose됐지만(실제 엔진은
    // 이 뒤에도 쓸 수 있다) Provider가 곡을 다시 맞춰 엔진이 되살아나 있어야 하고,
    // 자동 정지 콜백을 떼어 놓은 채가 아니어야 한다.
    expect(fake.engine.dispose).toHaveBeenCalled();
    expect(fake.engine.disposed).toBe(false);
    expect(fake.engine.onStop).not.toBeNull();

    // 편집이 엔진에 닿는다.
    fireEvent.click(segment("Am"));
    pickRootF();
    expect(lastAccepted(fake)).toBe(studio().song);
    expect(lastAccepted(fake).progression[1].chord).toEqual(FM);
    act(() => vi.advanceTimersByTime(300));
    expect(fake.storage!.setItem).toHaveBeenCalledTimes(1);

    // 재생이 된다.
    fireEvent.keyDown(document.body, { key: "Escape" });
    await pressSpace();
    expect(fake.engine.play).toHaveBeenCalledTimes(1);
    expect(studio().playing).toBe(true);
    expect(fake.engine.disposed).toBe(false);

    // 곡 끝 자동 정지가 UI에 닿는다.
    act(() => fake.autoStop());
    expect(studio().playing).toBe(false);
    expect(studio().editable).toBe(true);
  });
});

describe("8. 하이드레이션", () => {
  it("서버 HTML(데모)에 하이드레이트해도 경고가 없고, 마운트 뒤 저장된 곡으로 바뀐다", async () => {
    const stored = storedWithBars(3);
    const fake = createFakeDeps({ stored });
    // 서버 렌더는 effect를 돌리지 않으므로 저장소는 읽히지 않는다 -> 데모 곡.
    const html = renderToString(
      <StudioProvider createDeps={fake.createDeps}>
        <Studio />
      </StudioProvider>,
    );
    for (const label of ["C", "Am", "F", "G7"]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(fake.storage!.getItem).not.toHaveBeenCalled();

    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = html;
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(
        container,
        <StudioProvider createDeps={createFakeDeps({ stored }).createDeps}>
          <Studio />
        </StudioProvider>,
      );
    });
    // 복원된 곡은 3마디다.
    expect(
      within(container.querySelector<HTMLElement>('[data-testid="ruler"]')!)
        .getAllByText(/^\d+$/)
        .map((e) => e.textContent),
    ).toEqual(["1", "2", "3"]);
    act(() => root.unmount());
    container.remove();
  });
});

describe("9. 65마디 이상으로 불러온 곡", () => {
  it("두 마디 버튼이 모두 막혀 있고 눌러도 곡이 그대로다", () => {
    const { studio } = start({ stored: storedWithBars(100) });
    const loaded = studio().song;
    expect(loaded.bars).toBe(100);
    expect(addBar()).toHaveProperty("disabled", true);
    expect(removeBar()).toHaveProperty("disabled", true);

    fireEvent.click(addBar());
    fireEvent.click(removeBar());
    expect(studio().song).toBe(loaded);
    expect(studio().canUndo).toBe(false);
    expect(rulerLabels()).toHaveLength(100);
  });
});
