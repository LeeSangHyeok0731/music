import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOSAVE_KEY, serializeSong } from "@/lib/score/autosave";
import { buildDemoSong } from "@/lib/score/demo-song";
import type { Song } from "@/lib/score/model";
import { patternLabel } from "@/lib/score/pattern-labels";
import { patternsFor } from "@/lib/score/patterns";
import { songWithPatterns } from "@/lib/score/testing/builders";

import { Studio } from "./Studio";
import { TrackLane } from "./TrackLane";
import {
  installAudioContextStub,
  renderWithStudio,
  startPlaying,
} from "./testing/harness";
import {
  LANE_LEFT,
  fireBadPointer,
  firePointer,
  installPointerCaptureStubs,
  stubLaneRect,
  xAt,
} from "./testing/pointer";

let restoreAudio: () => void;
let restorePointer: () => void;

beforeEach(() => {
  restoreAudio = installAudioContextStub();
  restorePointer = installPointerCaptureStubs();
  // 재생 중에는 10Hz 위치 표본 타이머가 돈다. 가짜로 막아 act 밖 갱신을 없앤다.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  restorePointer();
  restoreAudio();
});

const PIANO = "track-piano";
const DRUMS = "track-drums";

/** 4마디. 피아노 [0,1920) 블록 / [5760,7680) 아르페지오, 드럼 [0,1920). 가운데가 비어 있다. */
function gapSong(): Song {
  return songWithPatterns({
    bars: 4,
    tracks: [
      {
        id: PIANO,
        instrument: "piano",
        clips: [
          { id: "clip-1", start: 0, length: 1920, pattern: "piano-block" },
          {
            id: "clip-2",
            start: 5760,
            length: 1920,
            pattern: "piano-arpeggio-8th",
          },
        ],
      },
      {
        id: DRUMS,
        instrument: "drums",
        clips: [
          { id: "drum-1", start: 0, length: 1920, pattern: "drum-basic-rock" },
        ],
      },
    ],
  });
}

/** 두 클립 사이 틈이 반마디(960)보다 좁다(480): 그 틈을 눌러도 추가할 수 없다. */
function tightSong(): Song {
  return songWithPatterns({
    bars: 4,
    tracks: [
      {
        id: PIANO,
        instrument: "piano",
        clips: [
          { id: "clip-1", start: 0, length: 1920, pattern: "piano-block" },
          {
            id: "clip-2",
            start: 2400,
            length: 1920,
            pattern: "piano-arpeggio-8th",
          },
        ],
      },
    ],
  });
}

/** 피아노: 패턴 / 음 / 패턴 클립이 이어진다. 드럼 클립 하나. */
function mixedSong(): Song {
  const song = songWithPatterns({
    bars: 4,
    tracks: [
      {
        id: PIANO,
        instrument: "piano",
        clips: [
          { id: "clip-1", start: 0, length: 1920, pattern: "piano-block" },
          { id: "clip-2", start: 1920, length: 1920, pattern: "piano-block" },
          {
            id: "clip-3",
            start: 3840,
            length: 1920,
            pattern: "piano-block",
          },
        ],
      },
      {
        id: DRUMS,
        instrument: "drums",
        clips: [
          { id: "drum-1", start: 0, length: 1920, pattern: "drum-basic-rock" },
        ],
      },
    ],
  });
  song.tracks[0].clips[1].body = {
    type: "notes",
    notes: [{ start: 0, length: 480, pitch: 60, velocity: 0.8 }],
  };
  return song;
}

/** 곡의 모든 트랙 레인을 렌더하고 각 레인의 화면 사각형을 고정한다. 곡이 없으면 데모. */
function renderTracks(
  song?: Song,
  options: Parameters<typeof renderWithStudio>[1] = {},
) {
  const loaded = song ?? buildDemoSong();
  const h = renderWithStudio(
    <>
      {loaded.tracks.map((t) => (
        <TrackLane key={t.id} trackId={t.id} />
      ))}
    </>,
    song
      ? { ...options, stored: { [AUTOSAVE_KEY]: serializeSong(song) } }
      : options,
  );
  for (const t of loaded.tracks) {
    stubLaneRect(lane(t.id), { left: LANE_LEFT, width: 1280, height: 56 });
  }
  return h;
}

function lane(trackId = PIANO) {
  return screen.getByTestId(`track-lane-${trackId}`);
}
function tile(clipId: string) {
  return screen.getByTestId(`clip-${clipId}`);
}
function body(clipId: string): HTMLElement {
  return tile(clipId).querySelector("button[aria-pressed]") as HTMLElement;
}
function handle(clipId: string) {
  return within(tile(clipId)).getByRole("separator", {
    name: "클립 길이 조절",
  });
}
function clipIds(trackId = PIANO) {
  return within(lane(trackId))
    .queryAllByTestId(/^clip-/)
    .map((el) => el.getAttribute("data-testid")!.slice("clip-".length));
}
function lefts(trackId = PIANO) {
  return clipIds(trackId).map((id) => tile(id).style.left);
}
function dialog() {
  return screen.getByRole("dialog", { name: "패턴 선택" });
}
function inDialog(name: string) {
  return within(dialog()).getByRole("button", { name });
}
function clipOf(h: { studio(): { song: Song } }, clipId: string, t = PIANO) {
  return h
    .studio()
    .song.tracks.find((x) => x.id === t)!
    .clips.find((c) => c.id === clipId)!;
}

/** 누르고 놓는다(움직임 없음) — 클립 본문 클릭. */
function pointerClick(el: Element, x = 0) {
  firePointer(el, "pointerdown", { clientX: x });
  firePointer(el, "pointerup", { clientX: x });
}

describe("TrackLane 렌더", () => {
  it("데모 피아노 4클립을 clipRect 위치·폭과 패턴 이름으로 그린다", () => {
    renderTracks();
    expect(clipIds()).toEqual(["piano-0", "piano-1", "piano-2", "piano-3"]);
    expect(lefts()).toEqual(["0px", "320px", "640px", "960px"]);
    for (const id of clipIds()) {
      expect(tile(id).style.width).toBe("320px");
      expect(body(id).textContent).toBe("8분 아르페지오");
    }
  });

  it("드럼 클립 하나는 곡 전체 폭이고 드럼 이름이다", () => {
    renderTracks();
    expect(tile("drums-0").style.width).toBe("1280px");
    expect(body("drums-0").textContent).toBe("기본 락");
  });

  it("레인은 높이·구분선을 유지하고 배경이 투명하며 testid를 갖는다", () => {
    renderTracks();
    expect(lane().style.height).toBe("56px");
    expect(lane().style.boxShadow).not.toBe("");
    expect(lane().style.background).toBe("");
    expect(lane().className).toContain("relative");
  });

  it("악기별 타일 색과 클립마다 8px 길이 핸들이 있다", () => {
    renderTracks();
    expect(tile("piano-0").className).toContain("bg-indigo-500/25");
    expect(tile("piano-0").className).toContain("border-indigo-400/60");
    expect(tile("drums-0").className).toContain("bg-rose-500/25");
    expect(tile("drums-0").className).toContain("border-rose-400/60");
    expect(tile("bass-0").className).toContain("bg-amber-500/25");
    expect(tile("guitar-0").className).toContain("bg-emerald-500/25");
    const h = handle("piano-0");
    expect(h.style.width).toBe("8px");
    expect(h.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("음 클립은 '음'이라고만 쓰고 팝오버 속성이 없다", () => {
    renderTracks(mixedSong());
    expect(body("clip-2").textContent).toBe("음");
    expect(body("clip-2").getAttribute("aria-haspopup")).toBeNull();
    expect(body("clip-1").getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("처음엔 선택된 클립도 삭제 버튼도 없고 aria-disabled도 없다", () => {
    renderTracks();
    for (const id of clipIds()) {
      expect(body(id).getAttribute("aria-pressed")).toBe("false");
      expect(body(id).getAttribute("aria-disabled")).toBeNull();
      expect(handle(id).getAttribute("aria-disabled")).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "클립 삭제" })).toBeNull();
  });

  it("Studio 안에서 트랙마다 레인이 헤더와 같은 순서로 그려진다", () => {
    renderWithStudio(<Studio />);
    expect(screen.getByTestId("track-lane-track-piano")).toBeTruthy();
    expect(
      within(screen.getByTestId("track-lane-track-drums")).getAllByRole(
        "button",
      ),
    ).toHaveLength(1);
    expect(screen.getByTestId("track-header-track-piano").textContent).toBe(
      "피아노",
    );
  });
});

describe("TrackLane 빈 곳 클릭으로 클립 추가", () => {
  it("빈 격자를 누르고 놓으면 그 칸(반마디 내림)에 클립이 생기고 선택된다", () => {
    const h = renderTracks(gapSong());
    pointerClick(lane(), xAt(2500)); // 2500 -> 1920
    expect(clipIds()).toEqual(["clip-1", "clip-3", "clip-2"]);
    expect(clipOf(h, "clip-3")).toMatchObject({ start: 1920, length: 1920 });
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-3" });
    expect(body("clip-3").getAttribute("aria-pressed")).toBe("true");
    expect(h.studio().canUndo).toBe(true);
    // 새 클립을 추가했을 뿐 패턴 팝오버는 열지 않는다
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("한 번 되돌리면 클립과 선택이 사라진다", () => {
    const h = renderTracks(gapSong());
    pointerClick(lane(), xAt(2500));
    act(() => h.studio().undo());
    expect(clipIds()).toEqual(["clip-1", "clip-2"]);
    expect(h.studio().selection).toBeNull();
  });

  it("다음 클립까지 자리가 모자라면 남은 만큼만 만든다", () => {
    const h = renderTracks(gapSong());
    pointerClick(lane(), xAt(4800)); // 4800 -> 4800, 다음 클립은 5760
    expect(clipOf(h, "clip-3")).toMatchObject({ start: 4800, length: 960 });
  });

  it("다른 트랙 레인에 누르면 그 트랙에 추가된다", () => {
    const h = renderTracks(gapSong());
    pointerClick(lane(DRUMS), xAt(3000));
    expect(clipOf(h, "clip-1", DRUMS)).toMatchObject({ start: 2880 });
    expect(
      h.studio().song.tracks.find((t) => t.id === DRUMS)!.clips,
    ).toHaveLength(2);
    expect(h.studio().selection?.trackId).toBe(DRUMS);
  });

  it("클립 위를 누르면 추가하지 않는다(선택과 팝오버만)", () => {
    const h = renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    expect(clipIds()).toEqual(["clip-1", "clip-2"]);
    expect(h.studio().canUndo).toBe(false);
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-1" });
  });

  it("길이 핸들 위를 눌러도 추가하지 않는다", () => {
    const h = renderTracks(gapSong());
    pointerClick(handle("clip-1"), xAt(1920));
    expect(clipIds()).toEqual(["clip-1", "clip-2"]);
    expect(h.studio().canUndo).toBe(false);
  });

  it("5px 이상 움직이고 놓으면 추가하지 않는다(4px 안이면 추가)", () => {
    const h = renderTracks(gapSong());
    firePointer(lane(), "pointerdown", { clientX: xAt(2500) });
    firePointer(lane(), "pointerup", { clientX: xAt(2500) + 6 });
    expect(h.studio().canUndo).toBe(false);
    firePointer(lane(), "pointerdown", { clientX: xAt(2500) });
    firePointer(lane(), "pointerup", { clientX: xAt(2500) + 4 });
    expect(h.studio().canUndo).toBe(true);
  });

  it("세로로 5px 이상 움직여도 추가하지 않는다", () => {
    const h = renderTracks(gapSong());
    firePointer(lane(), "pointerdown", { clientX: xAt(2500), clientY: 10 });
    firePointer(lane(), "pointerup", { clientX: xAt(2500), clientY: 30 });
    expect(h.studio().canUndo).toBe(false);
  });

  it("addClip이 no-op이면 곡·기록·선택이 그대로다", () => {
    const h = renderTracks(tightSong());
    act(() => h.studio().select({ trackId: PIANO, clipId: "clip-1" }));
    const before = h.studio().song;
    pointerClick(lane(), xAt(2000)); // 1920에 놓을 자리가 480뿐
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-1" });
  });

  it("주 버튼이 아니면 무시한다", () => {
    const h = renderTracks(gapSong());
    firePointer(lane(), "pointerdown", { clientX: xAt(2500), button: 2 });
    firePointer(lane(), "pointerup", { clientX: xAt(2500), button: 2 });
    expect(h.studio().canUndo).toBe(false);
  });

  it("NaN 좌표는 무시한다(누를 때도 놓을 때도)", () => {
    const h = renderTracks(gapSong());
    fireBadPointer(lane(), "pointerdown", Number.NaN);
    firePointer(lane(), "pointerup", { clientX: xAt(2500) });
    expect(h.studio().canUndo).toBe(false);
    firePointer(lane(), "pointerdown", { clientX: xAt(2500) });
    fireBadPointer(lane(), "pointerup", Number.NaN);
    expect(h.studio().canUndo).toBe(false);
  });

  it("pointercancel은 누름을 버린다", () => {
    const h = renderTracks(gapSong());
    firePointer(lane(), "pointerdown", { clientX: xAt(2500) });
    firePointer(lane(), "pointercancel", { clientX: xAt(2500) });
    firePointer(lane(), "pointerup", { clientX: xAt(2500) });
    expect(h.studio().canUndo).toBe(false);
  });

  it("클립에서 눌러 레인 빈 곳에서 놓아도 추가하지 않는다", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-1"), "pointerdown", { clientX: xAt(100) });
    firePointer(lane(), "pointerup", { clientX: xAt(2500) });
    expect(h.studio().canUndo).toBe(false);
  });

  it("레인의 화면 left가 이미 스크롤을 반영하므로 scrollLeft를 또 더하지 않는다", () => {
    const h = renderWithStudio(<Studio />);
    // 이 테스트는 데모 곡의 피아노 클립 사이를 비워 둘 수 없어 클립을 하나 지운다.
    act(() => h.studio().edit.removeClip(PIANO, "piano-1"));
    const timeline = screen.getByTestId("timeline");
    Object.defineProperty(timeline, "scrollLeft", {
      value: 320,
      configurable: true,
    });
    // 320px 스크롤됨: 레인 요소의 화면 left가 이미 96 - 320이다. 곡 틱 3840 = 320px.
    stubLaneRect(lane(), { left: LANE_LEFT - 320, width: 1280, height: 56 });
    pointerClick(lane(), LANE_LEFT - 320 + 320);
    const added = h
      .studio()
      .song.tracks.find((t) => t.id === PIANO)!
      .clips.find((c) => c.start === 3840);
    expect(added).toBeTruthy();
  });

  it("재생 중에는 추가하지 않는다(선택도 건드리지 않는다)", async () => {
    const h = renderTracks(gapSong());
    // 편집 함수가 알아서 무시하더라도 UI가 select를 불러 선택을 지우면 안 된다.
    act(() => h.studio().select({ trackId: PIANO, clipId: "clip-1" }));
    await startPlaying(h);
    pointerClick(lane(), xAt(2500));
    expect(clipIds()).toEqual(["clip-1", "clip-2"]);
    expect(h.studio().canUndo).toBe(false);
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-1" });
  });

  it("재생 대기 중(pending)에도 추가하지 않는다", async () => {
    const h = renderTracks(gapSong(), { playMode: "manual" });
    act(() => h.studio().select({ trackId: PIANO, clipId: "clip-1" }));
    await startPlaying(h);
    expect(h.studio().pending).toBe(true);
    pointerClick(lane(), xAt(2500));
    expect(h.studio().canUndo).toBe(false);
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-1" });
  });
});

describe("TrackLane 클립 클릭", () => {
  it("5px 안에서 놓으면 클릭이다: 선택하고 패턴 팝오버를 연다", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-1"), "pointerdown", { clientX: xAt(100) });
    firePointer(body("clip-1"), "pointermove", { clientX: xAt(100) + 3 });
    firePointer(body("clip-1"), "pointerup", { clientX: xAt(100) + 3 });
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-1" });
    expect(body("clip-1").getAttribute("aria-pressed")).toBe("true");
    expect(tile("clip-1").getAttribute("data-selected")).toBe("true");
    expect(tile("clip-1").className).toContain("ring-1");
    expect(dialog()).toBeTruthy();
    expect(h.studio().canUndo).toBe(false);
    expect(lefts()).toEqual(["0px", "480px"]);
    // 클릭은 포인터를 캡처하지 않는다
    expect(body("clip-1").hasPointerCapture(1)).toBe(false);
  });

  it("같은 클립을 다시 클릭하면 팝오버가 닫히고 선택은 유지된다(토글)", () => {
    const h = renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    pointerClick(body("clip-1"), xAt(100));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-1" });
  });

  it("마우스 클릭 뒤 브라우저가 보내는 click은 토글을 되돌리지 않는다", () => {
    renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    fireEvent.click(body("clip-1"), { detail: 1 });
    expect(dialog()).toBeTruthy();
  });

  it("키보드(Enter) 클릭도 선택하고 팝오버를 연다", () => {
    const h = renderTracks(gapSong());
    fireEvent.click(body("clip-2")); // detail 0 = 키보드
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-2" });
    expect(dialog()).toBeTruthy();
    expect(body("clip-2").getAttribute("aria-expanded")).toBe("true");
  });

  it("음 클립은 선택만 되고 팝오버가 없다(열려 있던 것도 닫는다)", () => {
    const h = renderTracks(mixedSong());
    pointerClick(body("clip-1"), xAt(100));
    expect(dialog()).toBeTruthy();
    pointerClick(body("clip-2"), xAt(2000));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-2" });
  });

  it("다른 클립을 클릭하면 선택이 옮겨지고 그 클립의 값으로 팝오버가 열린다", () => {
    const h = renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    pointerClick(body("clip-2"), xAt(5800));
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-2" });
    expect(inDialog("8분 아르페지오").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(inDialog("블록 코드").getAttribute("aria-pressed")).toBe("false");
  });

  it("주 버튼이 아니면 선택하지 않는다", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-1"), "pointerdown", { clientX: 5, button: 2 });
    firePointer(body("clip-1"), "pointerup", { clientX: 5, button: 2 });
    expect(h.studio().selection).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("TrackLane 이동 드래그", () => {
  const X0 = xAt(5760) + 20; // clip-2 안쪽

  it("5px 넘게 움직이면 이동이다: 미리보기만 바뀌고 곡·기록은 그대로, 선택된다", () => {
    const h = renderTracks(gapSong());
    const original = h.studio().song;
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 }); // -960틱
    expect(tile("clip-2").style.left).toBe("400px");
    expect(tile("clip-2").getAttribute("data-dragging")).toBe("true");
    expect(h.studio().song).toBe(original);
    expect(h.studio().canUndo).toBe(false);
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-2" });

    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 160 });
    expect(tile("clip-2").style.left).toBe("320px");
    expect(h.studio().song).toBe(original);
    expect(h.studio().canUndo).toBe(false);
  });

  it("놓을 때 한 번만 커밋하고 한 번 되돌리면 원래대로다", () => {
    const h = renderTracks(gapSong());
    const original = h.studio().song;
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 160 });
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 160 });
    expect(clipOf(h, "clip-2").start).toBe(3840);
    expect(tile("clip-2").style.left).toBe("320px");
    expect(tile("clip-2").getAttribute("data-dragging")).toBeNull();
    expect(h.studio().canUndo).toBe(true);
    act(() => h.studio().undo());
    expect(h.studio().song).toEqual(original);
    expect(h.studio().canUndo).toBe(false);
  });

  it("놓는 좌표가 아니라 마지막 미리보기 위치를 커밋한다", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 160 });
    expect(clipOf(h, "clip-2").start).toBe(4800);
  });

  it("드래그가 시작되면 포인터를 캡처하고 놓으면 해제한다", () => {
    renderTracks(gapSong());
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    expect(body("clip-2").hasPointerCapture(1)).toBe(false);
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 3 });
    expect(body("clip-2").hasPointerCapture(1)).toBe(false);
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 6 });
    expect(body("clip-2").hasPointerCapture(1)).toBe(true);
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 6 });
    expect(body("clip-2").hasPointerCapture(1)).toBe(false);
  });

  it("왼쪽 이웃 끝에서 멈춘다(미리보기도 커밋도 클램프)", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 1000 });
    expect(tile("clip-2").style.left).toBe("160px"); // 1920틱
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 1000 });
    expect(clipOf(h, "clip-2").start).toBe(1920);
  });

  it("오른쪽 이웃·곡 끝에서도 멈춘다", () => {
    const h = renderTracks(gapSong());
    const x = xAt(100);
    firePointer(body("clip-1"), "pointerdown", { clientX: x });
    firePointer(body("clip-1"), "pointermove", { clientX: x + 2000 });
    expect(tile("clip-1").style.left).toBe("320px"); // 5760 - 1920
    firePointer(body("clip-1"), "pointerup", { clientX: x + 2000 });
    expect(clipOf(h, "clip-1").start).toBe(3840);
    // 곡 끝: clip-2는 이미 맨 오른쪽이라 더 갈 수 없다
    const before = h.studio().song;
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 + 500 });
    firePointer(body("clip-2"), "pointerup", { clientX: X0 + 500 });
    expect(h.studio().song).toBe(before);
  });

  it("스냅: 반마디로 반올림해 커밋한다", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 30 }); // -360 -> 5400 -> 5760(5.625->6)
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 50 }); // -600 -> 5160 -> 5.375 -> 5 -> 4800
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 50 });
    expect(clipOf(h, "clip-2").start).toBe(4800);
  });

  it("제자리로 돌아와 놓으면 기록이 없다", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 });
    firePointer(body("clip-2"), "pointerup", { clientX: X0 });
    expect(h.studio().canUndo).toBe(false);
    expect(tile("clip-2").style.left).toBe("480px");
  });

  it("스냅 격자보다 작게 끌고 놓으면 기록이 없다", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 + 20 }); // +240 -> 같은 칸
    firePointer(body("clip-2"), "pointerup", { clientX: X0 + 20 });
    expect(h.studio().canUndo).toBe(false);
  });

  it("드래그가 시작되면 열려 있던 팝오버는 닫힌다", () => {
    renderTracks(gapSong());
    pointerClick(body("clip-2"), X0);
    expect(dialog()).toBeTruthy();
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("드래그가 끝난 뒤 따라오는 click은 팝오버를 열지 않는다", () => {
    renderTracks(gapSong());
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 80 });
    fireEvent.click(body("clip-2"), { detail: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc는 취소한다: 곡 그대로, 위치 복귀, 이후 놓아도 커밋 없음", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    expect(tile("clip-2").style.left).toBe("400px");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tile("clip-2").style.left).toBe("480px");
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 160 });
    expect(tile("clip-2").style.left).toBe("480px");
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 160 });
    expect(h.studio().canUndo).toBe(false);
  });

  it("pointercancel은 취소한다", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    firePointer(body("clip-2"), "pointercancel", { clientX: X0 - 80 });
    expect(tile("clip-2").style.left).toBe("480px");
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 80 });
    expect(h.studio().canUndo).toBe(false);
  });

  it("pointerup 없이 캡처를 잃으면(lostpointercapture) 취소한다", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    fireEvent(
      body("clip-2"),
      new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 1 }),
    );
    expect(tile("clip-2").style.left).toBe("480px");
    expect(h.studio().canUndo).toBe(false);
  });

  it("pointerup 뒤의 lostpointercapture는 두 번째 커밋을 만들지 않는다", () => {
    const h = renderTracks(gapSong());
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 80 });
    fireEvent(
      body("clip-2"),
      new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 1 }),
    );
    act(() => h.studio().undo());
    expect(h.studio().canUndo).toBe(false);
  });

  it("setPointerCapture가 던지면 드래그를 시작하지 않고 다음 시도는 동작한다", () => {
    const h = renderTracks(gapSong());
    const spy = vi
      .spyOn(HTMLElement.prototype, "setPointerCapture")
      .mockImplementationOnce(() => {
        throw new DOMException("no such pointer", "NotFoundError");
      });
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    expect(tile("clip-2").style.left).toBe("480px");
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 160 });
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 160 });
    expect(h.studio().canUndo).toBe(false);
    spy.mockRestore();
    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 80 });
    expect(clipOf(h, "clip-2").start).toBe(4800);
  });

  it("주 버튼이 아니면 시작하지 않고, 다른 포인터 id는 무시한다", () => {
    const h = renderTracks(gapSong());
    const spy = vi.spyOn(HTMLElement.prototype, "setPointerCapture");
    firePointer(body("clip-2"), "pointerdown", { clientX: X0, button: 2 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    expect(spy).not.toHaveBeenCalled();
    firePointer(body("clip-2"), "pointerdown", { clientX: X0, pointerId: 1 });
    firePointer(body("clip-2"), "pointermove", {
      clientX: X0 - 80,
      pointerId: 2,
    });
    expect(tile("clip-2").style.left).toBe("480px");
    firePointer(body("clip-2"), "pointerup", { clientX: X0, pointerId: 1 });
    expect(h.studio().canUndo).toBe(false);
  });

  it("NaN 좌표는 무시한다", () => {
    const h = renderTracks(gapSong());
    const spy = vi.spyOn(HTMLElement.prototype, "setPointerCapture");
    fireBadPointer(body("clip-2"), "pointerdown", Number.NaN);
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    expect(spy).not.toHaveBeenCalled();

    firePointer(body("clip-2"), "pointerdown", { clientX: X0 });
    firePointer(body("clip-2"), "pointermove", { clientX: X0 - 80 });
    fireBadPointer(body("clip-2"), "pointermove", Number.NaN);
    expect(tile("clip-2").style.left).toBe("400px");
    firePointer(body("clip-2"), "pointerup", { clientX: X0 - 80 });
    expect(clipOf(h, "clip-2").start).toBe(4800);
  });

  it("레인 화면 위치가 스크롤로 밀려 있어도 이동량은 포인터 차이만 쓴다", () => {
    const h = renderTracks(gapSong());
    stubLaneRect(lane(), { left: LANE_LEFT - 320, width: 1280, height: 56 });
    firePointer(body("clip-2"), "pointerdown", { clientX: 700 });
    firePointer(body("clip-2"), "pointermove", { clientX: 620 });
    firePointer(body("clip-2"), "pointerup", { clientX: 620 });
    expect(clipOf(h, "clip-2").start).toBe(4800);
  });
});

describe("TrackLane 길이 드래그", () => {
  const edge = xAt(1920) - 4; // clip-1의 오른쪽 가장자리

  it("미리보기는 폭만 바꾸고 놓을 때 한 번 커밋한다", () => {
    const h = renderTracks(gapSong());
    const original = h.studio().song;
    firePointer(handle("clip-1"), "pointerdown", { clientX: edge });
    firePointer(handle("clip-1"), "pointermove", { clientX: edge + 80 }); // +960
    expect(tile("clip-1").style.width).toBe("240px");
    expect(tile("clip-1").style.left).toBe("0px");
    expect(h.studio().song).toBe(original);
    expect(h.studio().canUndo).toBe(false);
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-1" });
    firePointer(handle("clip-1"), "pointerup", { clientX: edge + 80 });
    expect(clipOf(h, "clip-1").length).toBe(2880);
    act(() => h.studio().undo());
    expect(h.studio().song).toEqual(original);
  });

  it("최소 길이(반마디=960틱=80px) 아래로는 줄지 않는다", () => {
    const h = renderTracks(gapSong());
    firePointer(handle("clip-1"), "pointerdown", { clientX: edge });
    firePointer(handle("clip-1"), "pointermove", { clientX: edge - 1000 });
    expect(tile("clip-1").style.width).toBe("80px");
    firePointer(handle("clip-1"), "pointerup", { clientX: edge - 1000 });
    expect(clipOf(h, "clip-1").length).toBe(960);
  });

  it("다음 클립 앞에서 멈춘다", () => {
    const h = renderTracks(gapSong());
    firePointer(handle("clip-1"), "pointerdown", { clientX: edge });
    firePointer(handle("clip-1"), "pointermove", { clientX: edge + 2000 });
    expect(tile("clip-1").style.width).toBe("480px"); // 5760틱
    firePointer(handle("clip-1"), "pointerup", { clientX: edge + 2000 });
    expect(clipOf(h, "clip-1").length).toBe(5760);
  });

  it("마지막 클립은 곡 끝에서 멈추고, 이미 끝이면 기록이 없다", () => {
    const h = renderTracks(gapSong());
    const x = xAt(7680) - 4;
    firePointer(handle("clip-2"), "pointerdown", { clientX: x });
    firePointer(handle("clip-2"), "pointermove", { clientX: x + 500 });
    expect(tile("clip-2").style.width).toBe("160px");
    firePointer(handle("clip-2"), "pointerup", { clientX: x + 500 });
    expect(h.studio().canUndo).toBe(false);
  });

  it("마지막 미리보기 길이를 커밋한다(up 좌표가 달라도)", () => {
    const h = renderTracks(gapSong());
    firePointer(handle("clip-1"), "pointerdown", { clientX: edge });
    firePointer(handle("clip-1"), "pointermove", { clientX: edge + 80 });
    firePointer(handle("clip-1"), "pointerup", { clientX: edge - 80 });
    expect(clipOf(h, "clip-1").length).toBe(2880);
  });

  it("Esc·pointercancel·lostpointercapture는 취소한다", () => {
    const h = renderTracks(gapSong());
    for (const cancel of [
      () => fireEvent.keyDown(document, { key: "Escape" }),
      () =>
        firePointer(handle("clip-1"), "pointercancel", { clientX: edge + 80 }),
      () =>
        fireEvent(
          handle("clip-1"),
          new PointerEvent("lostpointercapture", {
            bubbles: true,
            pointerId: 1,
          }),
        ),
    ]) {
      firePointer(handle("clip-1"), "pointerdown", { clientX: edge });
      firePointer(handle("clip-1"), "pointermove", { clientX: edge + 80 });
      expect(tile("clip-1").style.width).toBe("240px");
      cancel();
      expect(tile("clip-1").style.width).toBe("160px");
      firePointer(handle("clip-1"), "pointerup", { clientX: edge + 80 });
    }
    expect(h.studio().canUndo).toBe(false);
  });

  it("움직이지 않고 놓으면 아무 일도 없다(선택·팝오버·기록 없음)", () => {
    const h = renderTracks(gapSong());
    pointerClick(handle("clip-1"), edge);
    expect(h.studio().selection).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.studio().canUndo).toBe(false);
  });

  it("길이 드래그가 시작되면 열려 있던 팝오버가 닫힌다", () => {
    renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    expect(dialog()).toBeTruthy();
    firePointer(handle("clip-1"), "pointerdown", { clientX: edge });
    firePointer(handle("clip-1"), "pointermove", { clientX: edge + 80 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("TrackLane 패턴 팝오버", () => {
  it("피아노는 화음 패턴 전부(5개)를 이름으로 보여 주고 현재 것이 눌림 상태다", () => {
    renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    const d = dialog();
    const names = within(d)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(patternsFor("piano").map((p) => patternLabel(p.id)));
    expect(names).toHaveLength(5);
    const pressed = within(d)
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);
    expect(pressed).toEqual(["블록 코드"]);
  });

  it("드럼은 드럼 패턴 둘만 보인다", () => {
    renderTracks(gapSong());
    pointerClick(body("drum-1"), xAt(100));
    expect(
      within(dialog())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["기본 락", "포 온 더 플로어"]);
    expect(inDialog("기본 락").getAttribute("aria-pressed")).toBe("true");
  });

  it("body 직속 fixed 포털이고 첫 항목에 포커스가 가며 '이 트랙 전체에 적용'이 꺼져 있다", () => {
    renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    expect(dialog().parentElement).toBe(document.body);
    expect(lane().contains(dialog())).toBe(false);
    expect(dialog().style.position).toBe("fixed");
    expect(document.activeElement).toBe(inDialog("블록 코드"));
    const check = within(dialog()).getByRole("checkbox", {
      name: "이 트랙 전체에 적용",
    }) as HTMLInputElement;
    expect(check.checked).toBe(false);
  });

  it("클립 아래에 놓이고 뷰포트 안으로 클램프된다", () => {
    renderTracks(gapSong());
    const rect = (left: number) =>
      ({ left, right: left + 100, top: 60, bottom: 100 }) as DOMRect;
    body("clip-1").getBoundingClientRect = () => rect(200);
    pointerClick(body("clip-1"), xAt(100));
    expect(dialog().style.left).toBe("200px");
    expect(dialog().style.top).toBe("104px");
  });

  it("단일 적용: 그 클립만 바뀌고 음 클립·다른 클립·다른 트랙은 그대로다", () => {
    const h = renderTracks(mixedSong());
    const before = h.studio().song;
    pointerClick(body("clip-1"), xAt(100));
    fireEvent.click(inDialog("8분 아르페지오"));
    const song = h.studio().song;
    expect(clipOf(h, "clip-1").body).toEqual({
      type: "pattern",
      pattern: "piano-arpeggio-8th",
    });
    expect(clipOf(h, "clip-3").body).toEqual(before.tracks[0].clips[2].body);
    expect(clipOf(h, "clip-2").body).toEqual(before.tracks[0].clips[1].body);
    expect(song.tracks[1]).toBe(before.tracks[1]);
    expect(h.studio().canUndo).toBe(true);
    // 팝오버는 열린 채 새 값이 눌림 상태
    expect(inDialog("8분 아르페지오").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(inDialog("블록 코드").getAttribute("aria-pressed")).toBe("false");
  });

  it("트랙 전체 적용: 패턴 클립은 모두 바뀌고 음 클립과 다른 트랙은 그대로다", () => {
    const h = renderTracks(mixedSong());
    const before = h.studio().song;
    pointerClick(body("clip-1"), xAt(100));
    fireEvent.click(
      within(dialog()).getByRole("checkbox", { name: "이 트랙 전체에 적용" }),
    );
    fireEvent.click(inDialog("4분 스트럼"));
    const patternOf = (id: string) => {
      const b = clipOf(h, id).body;
      return b.type === "pattern" ? b.pattern : "notes";
    };
    expect(patternOf("clip-1")).toBe("guitar-strum-quarter");
    expect(patternOf("clip-3")).toBe("guitar-strum-quarter");
    expect(patternOf("clip-2")).toBe("notes");
    expect(clipOf(h, "clip-2").body).toEqual(before.tracks[0].clips[1].body);
    expect(h.studio().song.tracks[1]).toBe(before.tracks[1]);
    // 한 번에 되돌아간다
    act(() => h.studio().undo());
    expect(h.studio().song).toEqual(before);
  });

  it("체크는 팝오버를 열 때마다 꺼진 채로 시작한다", () => {
    renderTracks(mixedSong());
    pointerClick(body("clip-1"), xAt(100));
    const check = () =>
      within(dialog()).getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(check());
    expect(check().checked).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    pointerClick(body("clip-1"), xAt(100));
    expect(check().checked).toBe(false);
    // 다른 클립으로 옮겨 열어도 마찬가지(포인터 없이 키보드로 옮기면 팝오버가 그대로 이어진다)
    fireEvent.click(check());
    pointerClick(body("clip-3"), xAt(3900));
    expect(check().checked).toBe(false);
    fireEvent.click(check());
    fireEvent.click(body("clip-1"));
    expect(check().checked).toBe(false);
  });

  it("Esc로 닫히고 포커스가 클립 버튼으로 돌아온다", () => {
    renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(body("clip-1"));
  });

  it("바깥을 누르면 닫히고 안쪽·같은 클립 버튼을 누르는 것은 닫지 않는다", () => {
    renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    firePointer(dialog(), "pointerdown", { clientX: 5 });
    expect(dialog()).toBeTruthy();
    firePointer(body("clip-1"), "pointerdown", { clientX: 5 });
    expect(dialog()).toBeTruthy();
    firePointer(document.body, "pointerdown", { clientX: 5 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("바깥을 눌러 닫을 때 포커스를 클립으로 가져오지 않는다", () => {
    renderTracks(gapSong());
    const other = document.createElement("button");
    document.body.append(other);
    pointerClick(body("clip-1"), xAt(100));
    other.focus();
    firePointer(other, "pointerdown", { clientX: 5 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it("창 크기가 바뀌면 닫히고 포커스는 클립 버튼으로 간다", () => {
    renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(body("clip-1"));
  });

  it("스크롤하면 닫힌다", () => {
    renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    fireEvent.scroll(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("열려 있던 클립이 사라지면(삭제·실행취소) 닫힌다", () => {
    const h = renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    act(() => h.studio().edit.removeClip(PIANO, "clip-1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("재생이 시작되면 닫히고 멈춘 뒤에도 다시 나타나지 않는다", async () => {
    const h = renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    await startPlaying(h);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => h.studio().stop());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("TrackLane 삭제 버튼", () => {
  it("선택된 클립에만 보이고 누르면 지우며 선택이 풀린다", () => {
    const h = renderTracks(gapSong());
    expect(screen.queryByRole("button", { name: "클립 삭제" })).toBeNull();
    pointerClick(body("clip-1"), xAt(100));
    expect(screen.getAllByRole("button", { name: "클립 삭제" })).toHaveLength(
      1,
    );
    expect(
      within(tile("clip-1")).getByRole("button", { name: "클립 삭제" })
        .textContent,
    ).toBe("×");
    fireEvent.click(screen.getByRole("button", { name: "클립 삭제" }));
    expect(clipIds()).toEqual(["clip-2"]);
    expect(h.studio().selection).toBeNull();
    expect(screen.queryByRole("button", { name: "클립 삭제" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    // 되돌리면 클립은 돌아오지만 선택은 돌아오지 않는다
    act(() => h.studio().undo());
    expect(clipIds()).toEqual(["clip-1", "clip-2"]);
    expect(h.studio().selection).toBeNull();
  });

  it("삭제 버튼을 눌러도 레인에 클립이 추가되지 않는다", () => {
    const h = renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100));
    const del = screen.getByRole("button", { name: "클립 삭제" });
    firePointer(del, "pointerdown", { clientX: xAt(1800) });
    firePointer(del, "pointerup", { clientX: xAt(1800) });
    fireEvent.click(del);
    expect(clipIds()).toEqual(["clip-2"]);
    expect(h.studio().song.tracks[0].clips).toHaveLength(1);
  });
});

describe("TrackLane 편집 불가(재생 중·대기 중)", () => {
  it("재생 중이면 모든 상호작용이 막히고 aria-disabled가 켜진다", async () => {
    const h = renderTracks(gapSong());
    pointerClick(body("clip-1"), xAt(100)); // 선택해 두면 삭제 버튼도 확인할 수 있다
    await startPlaying(h);
    expect(h.studio().editable).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    const before = h.studio().song;
    for (const id of clipIds()) {
      expect(body(id).getAttribute("aria-disabled")).toBe("true");
      expect(handle(id).getAttribute("aria-disabled")).toBe("true");
    }
    expect(
      screen
        .getByRole("button", { name: "클립 삭제" })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    const spy = vi.spyOn(HTMLElement.prototype, "setPointerCapture");
    pointerClick(body("clip-2"), xAt(5800));
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "clip-1" });
    fireEvent.click(body("clip-2"));
    expect(screen.queryByRole("dialog")).toBeNull();
    firePointer(body("clip-2"), "pointerdown", { clientX: xAt(5800) });
    firePointer(body("clip-2"), "pointermove", { clientX: xAt(5800) - 80 });
    expect(tile("clip-2").style.left).toBe("480px");
    firePointer(body("clip-2"), "pointerup", { clientX: xAt(5800) - 80 });
    firePointer(handle("clip-1"), "pointerdown", { clientX: xAt(1900) });
    firePointer(handle("clip-1"), "pointermove", { clientX: xAt(1900) + 80 });
    firePointer(handle("clip-1"), "pointerup", { clientX: xAt(1900) + 80 });
    fireEvent.click(screen.getByRole("button", { name: "클립 삭제" }));
    expect(spy).not.toHaveBeenCalled();
    expect(h.studio().song).toBe(before);
  });

  it("재생 대기 중(pending)에도 막힌다", async () => {
    const h = renderTracks(gapSong(), { playMode: "manual" });
    await startPlaying(h);
    expect(h.studio().pending).toBe(true);
    expect(body("clip-1").getAttribute("aria-disabled")).toBe("true");
    pointerClick(body("clip-1"), xAt(100));
    expect(h.studio().selection).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("이동 드래그 중 재생이 시작되면 미리보기를 되돌리고 커밋하지 않는다", async () => {
    const h = renderTracks(gapSong());
    const x = xAt(5800);
    firePointer(body("clip-2"), "pointerdown", { clientX: x });
    firePointer(body("clip-2"), "pointermove", { clientX: x - 80 });
    expect(tile("clip-2").style.left).toBe("400px");
    await startPlaying(h);
    expect(tile("clip-2").style.left).toBe("480px");
    act(() => h.studio().stop());
    firePointer(body("clip-2"), "pointerup", { clientX: x - 80 });
    expect(h.studio().canUndo).toBe(false);
    expect(tile("clip-2").style.left).toBe("480px");
  });

  it("길이 드래그 중 재생이 시작돼도 마찬가지다", async () => {
    const h = renderTracks(gapSong());
    const x = xAt(1900);
    firePointer(handle("clip-1"), "pointerdown", { clientX: x });
    firePointer(handle("clip-1"), "pointermove", { clientX: x + 80 });
    expect(tile("clip-1").style.width).toBe("240px");
    await startPlaying(h);
    expect(tile("clip-1").style.width).toBe("160px");
    act(() => h.studio().stop());
    firePointer(handle("clip-1"), "pointerup", { clientX: x + 80 });
    expect(h.studio().canUndo).toBe(false);
  });
});

describe("TrackLane 렌더 비용", () => {
  it("재생 위치(10Hz)가 바뀌어도 레인은 다시 렌더되지 않는다", async () => {
    const onViewRender = vi.fn();
    const h = renderWithStudio(
      <TrackLane trackId={PIANO} onViewRender={onViewRender} />,
    );
    h.fake.engine.currentTick.mockReturnValue(1920 * 2);
    await startPlaying(h);
    const before = onViewRender.mock.calls.length;
    const pos = h.studio().position;
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(h.studio().position).not.toEqual(pos);
    expect(onViewRender.mock.calls.length).toBe(before);
  });

  it("다른 트랙의 클립을 선택해도 이 레인은 다시 렌더되지 않는다", () => {
    const onViewRender = vi.fn();
    const h = renderWithStudio(
      <>
        <TrackLane trackId={PIANO} onViewRender={onViewRender} />
        <TrackLane trackId={DRUMS} />
      </>,
    );
    const before = onViewRender.mock.calls.length;
    act(() => h.studio().select({ trackId: DRUMS, clipId: "drums-0" }));
    expect(onViewRender.mock.calls.length).toBe(before);
  });
});
