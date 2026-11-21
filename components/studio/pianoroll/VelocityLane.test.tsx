import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOSAVE_KEY, serializeSong } from "@/lib/score/autosave";
import type { Note, Song } from "@/lib/score/model";
import { songWithNotes } from "@/lib/score/testing/builders";

import { hasActiveGesture } from "../gestures";
import { hasOpenModal } from "../modal";
import {
  installAudioContextStub,
  renderWithStudio,
  startPlaying,
} from "../testing/harness";
import {
  fireBadPointer,
  firePointer,
  installPointerCaptureStubs,
  stubLaneRect,
  type PointerInit,
} from "../testing/pointer";
import { PianoRoll } from "./PianoRoll";
import { VELOCITY_LANE_HEIGHT } from "./geometry";
import { steppedVelocity } from "./VelocityLane";

/**
 * 세기 레인(Task 5). 실제 `StudioProvider`의 곡 상태(음의 `velocity`)를 단언한다. 막대 영역이 포인터를
 * 캡처하고, 테스트 도우미는 캡처된 포인터의 이벤트를 캡처 요소로 다시 보낸다.
 */

let restoreAudio: () => void;
let restorePointer: () => void;

beforeEach(() => {
  restoreAudio = installAudioContextStub();
  restorePointer = installPointerCaptureStubs();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanup();
  expect(hasActiveGesture()).toBe(false);
  expect(hasOpenModal()).toBe(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  restorePointer();
  restoreAudio();
});

const PIANO = "track-piano";
const CLIP = "clip-1";
/** 막대 영역의 화면 위치(stub). 높이는 레인 높이 80px. */
const LT = 500;
const H = VELOCITY_LANE_HEIGHT;
/** 레인 안 y(px) → 화면 y. */
const yy = (laneY: number) => LT + laneY;

/**
 * 2마디, 음 클립 하나.
 * C4 [0,240) 0.8, E4 [0,240) 0.8(화음), C4 [960,1200) 0.8, A4 [1920,2400) 0.6.
 */
function rollSong(): Song {
  return songWithNotes({
    trackId: PIANO,
    bars: 2,
    notes: [
      { start: 0, length: 240, pitch: 60, velocity: 0.8 },
      { start: 0, length: 240, pitch: 64, velocity: 0.8 },
      { start: 960, length: 240, pitch: 60, velocity: 0.8 },
      { start: 1920, length: 480, pitch: 69, velocity: 0.6 },
    ],
  });
}

function renderRoll(song: Song = rollSong()) {
  const h = renderWithStudio(
    <PianoRoll trackId={PIANO} clipId={CLIP} onClose={() => {}} />,
    { stored: { [AUTOSAVE_KEY]: serializeSong(song) } },
  );
  const area = screen.getByTestId("roll-velocity-bars");
  stubLaneRect(area, { left: 0, top: LT, width: 3840 / 5, height: H });
  return { ...h, area };
}

type Roll = ReturnType<typeof renderRoll>;

function slider(key: string): HTMLElement {
  const el = screen
    .getByTestId("roll-velocity-bars")
    .querySelector<HTMLElement>(`[data-velocity-key="${key}"]`);
  if (!el) throw new Error(`막대 ${key}가 없다`);
  return el;
}
/** 눈에 보이는 막대(포인터를 받는 안쪽 요소). */
function fill(key: string): HTMLElement {
  return slider(key).firstElementChild as HTMLElement;
}
function fillHeight(key: string): number {
  return Number.parseFloat(fill(key).style.height);
}
function velocities(h: Roll): Record<string, number> {
  const body = h.studio().song.tracks[0].clips[0].body;
  const notes: Note[] = body.type === "notes" ? body.notes : [];
  return Object.fromEntries(notes.map((n) => [`${n.start}:${n.pitch}`, n.velocity]));
}
function noteButton(key: string): HTMLElement {
  return screen
    .getByTestId("roll-grid")
    .querySelector<HTMLElement>(`[data-note-key="${key}"] button`)!;
}
/** 격자의 음을 키보드 클릭(`detail 0`)으로 선택한다. */
function selectNotes(...keys: string[]) {
  keys.forEach((k, i) => fireEvent.click(noteButton(k), { shiftKey: i > 0 }));
}

const down = (el: Element, cy: number, o: Partial<PointerInit> = {}) =>
  firePointer(el, "pointerdown", { clientX: 10, clientY: cy, ...o });
const move = (el: Element, cy: number, o: Partial<PointerInit> = {}) =>
  firePointer(el, "pointermove", { clientX: 10, clientY: cy, ...o });
const up = (el: Element, cy: number, o: Partial<PointerInit> = {}) =>
  firePointer(el, "pointerup", { clientX: 10, clientY: cy, ...o });
const esc = () => fireEvent.keyDown(document.body, { key: "Escape" });

describe("steppedVelocity", () => {
  it("±5%를 소수 둘째 자리로 정리하고 [0.05, 1]로 자른다", () => {
    expect(steppedVelocity(0.8, 1)).toBe(0.85);
    expect(steppedVelocity(0.8, -1)).toBe(0.75);
    expect(steppedVelocity(0.97, 1)).toBe(1);
    expect(steppedVelocity(1, 1)).toBe(1);
    expect(steppedVelocity(0.07, -1)).toBe(0.05);
    expect(steppedVelocity(0.05, -1)).toBe(0.05);
    // 소수점 찌꺼기 없음
    expect(steppedVelocity(0.6, 1)).toBe(0.65);
  });
});

describe("막대", () => {
  it("음마다 role=slider 막대가 있고 이름·범위·값(퍼센트)을 갖는다", () => {
    renderRoll();
    const sliders = within(screen.getByTestId("roll-velocity")).getAllByRole(
      "slider",
    );
    expect(sliders).toHaveLength(4);
    expect(
      within(screen.getByTestId("roll-velocity")).getAllByRole("slider", {
        name: "C4 세기",
      }),
    ).toHaveLength(2);
    const a4 = slider("1920:69");
    expect(a4.getAttribute("aria-label")).toBe("A4 세기");
    expect(a4.getAttribute("aria-valuemin")).toBe("5");
    expect(a4.getAttribute("aria-valuemax")).toBe("100");
    expect(a4.getAttribute("aria-valuenow")).toBe("60");
    expect(slider("0:60").getAttribute("aria-valuenow")).toBe("80");
    expect(a4.tabIndex).toBe(0);
  });

  it("높이 = 세기 × 레인 높이(0.8 → 64px, 0.6 → 48px), 레인은 80px", () => {
    renderRoll();
    expect(H).toBe(80);
    expect(fillHeight("0:60")).toBe(64);
    expect(fillHeight("1920:69")).toBe(48);
    expect(screen.getByTestId("roll-velocity").style.height).toBe("80px");
  });

  it("격자와 같은 스크롤 영역 안에 있다(가로 스크롤을 따로 만들지 않는다)", () => {
    renderRoll();
    expect(
      screen
        .getByTestId("roll-scroll")
        .contains(screen.getByTestId("roll-velocity")),
    ).toBe(true);
  });

  it("막대는 음의 시작 x에 놓인다(1틱 = 0.2px)", () => {
    renderRoll();
    expect(slider("0:60").style.left).toBe("0px");
    expect(slider("960:60").style.left).toBe("192px");
    expect(slider("1920:69").style.left).toBe("384px");
  });
});

describe("세로 드래그", () => {
  it("선택에 없는 음이면 그 음만 바꾼다(선택은 그대로 비어 있다). 미리보기 중에는 곡이 그대로다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(fill("960:60"), yy(16));
    expect(hasActiveGesture()).toBe(true);
    move(h.area, yy(40));
    // 미리보기: 막대 높이만 0.5 × 80 = 40px
    expect(fillHeight("960:60")).toBe(40);
    expect(slider("960:60").getAttribute("aria-valuenow")).toBe("50");
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
    up(h.area, yy(40));
    expect(hasActiveGesture()).toBe(false);
    expect(velocities(h)).toEqual({
      "0:60": 0.8,
      "0:64": 0.8,
      "960:60": 0.5,
      "1920:69": 0.6,
    });
    expect(
      document.querySelectorAll('[data-note-key] button[aria-pressed="true"]'),
    ).toHaveLength(0);
  });

  it("놓을 때 한 번 커밋한다 — 되돌리기 한 번이 원래대로 복구한다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(fill("960:60"), yy(16));
    move(h.area, yy(30));
    move(h.area, yy(50));
    move(h.area, yy(60));
    up(h.area, yy(60));
    expect(velocities(h)["960:60"]).toBe(0.25);
    act(() => h.studio().undo());
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
  });

  it("값은 반올림하지 않는다(레인 y 7 → 1 − 7/80)", () => {
    const h = renderRoll();
    down(fill("960:60"), yy(40));
    move(h.area, yy(7));
    up(h.area, yy(7));
    expect(velocities(h)["960:60"]).toBe(1 - 7 / 80);
  });

  it("누른 음이 선택에 있으면 선택 전체에 같은 값을 준다(선택 밖 음은 그대로)", () => {
    const h = renderRoll();
    selectNotes("0:60", "0:64");
    down(fill("0:64"), yy(16));
    move(h.area, yy(60));
    // 선택 전체가 미리보기
    expect(fillHeight("0:60")).toBe(20);
    expect(fillHeight("0:64")).toBe(20);
    expect(fillHeight("960:60")).toBe(64);
    up(h.area, yy(60));
    expect(velocities(h)).toEqual({
      "0:60": 0.25,
      "0:64": 0.25,
      "960:60": 0.8,
      "1920:69": 0.6,
    });
    // 선택은 그대로
    expect(noteButton("0:60").getAttribute("aria-pressed")).toBe("true");
    expect(noteButton("0:64").getAttribute("aria-pressed")).toBe("true");
  });

  it("선택 밖의 음을 끌면 그 음만 바꾸고 선택은 그대로다", () => {
    const h = renderRoll();
    selectNotes("0:60", "0:64");
    down(fill("1920:69"), yy(30));
    move(h.area, yy(10));
    up(h.area, yy(10));
    expect(velocities(h)).toEqual({
      "0:60": 0.8,
      "0:64": 0.8,
      "960:60": 0.8,
      "1920:69": 0.875,
    });
    expect(noteButton("0:60").getAttribute("aria-pressed")).toBe("true");
    expect(noteButton("1920:69").getAttribute("aria-pressed")).toBe("false");
  });

  it("클램프: 레인 위로 벗어나면 1, 아래로 벗어나면 0.05", () => {
    const h = renderRoll();
    down(fill("960:60"), yy(40));
    move(h.area, yy(-50));
    expect(fillHeight("960:60")).toBe(80);
    up(h.area, yy(-50));
    expect(velocities(h)["960:60"]).toBe(1);

    down(fill("0:60"), yy(40));
    move(h.area, yy(400));
    expect(fillHeight("0:60")).toBe(4);
    up(h.area, yy(400));
    expect(velocities(h)["0:60"]).toBe(0.05);
  });

  it("같은 값으로 놓으면 히스토리 칸을 만들지 않는다", () => {
    const h = renderRoll();
    // A4는 0.6 → y 32 = 1 − 32/80 = 0.6
    const before = h.studio().song;
    down(fill("1920:69"), yy(10));
    move(h.area, yy(32));
    up(h.area, yy(32));
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
  });

  it("5px 안쪽 이동과 제자리 클릭은 아무것도 바꾸지 않는다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(fill("960:60"), yy(20));
    move(h.area, yy(23));
    expect(fillHeight("960:60")).toBe(64);
    up(h.area, yy(23));
    down(fill("960:60"), yy(20));
    up(h.area, yy(20));
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
  });

  it("막대가 아닌 빈 곳을 누르면 제스처를 만들지 않는다", () => {
    const h = renderRoll();
    down(h.area, yy(20));
    expect(hasActiveGesture()).toBe(false);
  });

  it("주 버튼이 아니거나(우클릭) 좌표가 NaN이면 무시한다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(fill("960:60"), yy(20), { button: 2 });
    expect(hasActiveGesture()).toBe(false);
    fireBadPointer(fill("960:60"), "pointerdown", Number.NaN);
    expect(hasActiveGesture()).toBe(false);
    expect(h.studio().song).toBe(before);
  });

  it("포인터 캡처가 던지면 제스처를 만들지 않는다", () => {
    const h = renderRoll();
    vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(
      () => {
        throw new Error("capture failed");
      },
    );
    down(fill("960:60"), yy(20));
    expect(hasActiveGesture()).toBe(false);
    move(h.area, yy(60));
    up(h.area, yy(60));
    expect(h.studio().canUndo).toBe(false);
  });

  it("마우스 버튼이 이미 떼어진 move는 제스처를 취소한다", () => {
    const h = renderRoll();
    down(fill("960:60"), yy(20));
    move(h.area, yy(60), { buttons: 0 });
    expect(hasActiveGesture()).toBe(false);
    up(h.area, yy(60));
    expect(h.studio().canUndo).toBe(false);
  });
});

describe("취소 경로", () => {
  it("Esc: 미리보기를 되돌리고 커밋하지 않는다(모달은 닫히지 않는다)", () => {
    const onClose = vi.fn();
    const h = renderWithStudio(
      <PianoRoll trackId={PIANO} clipId={CLIP} onClose={onClose} />,
      { stored: { [AUTOSAVE_KEY]: serializeSong(rollSong()) } },
    );
    const area = screen.getByTestId("roll-velocity-bars");
    stubLaneRect(area, { left: 0, top: LT, width: 768, height: H });
    down(fill("960:60"), yy(20));
    move(area, yy(60));
    expect(fillHeight("960:60")).toBe(20);
    esc();
    expect(hasActiveGesture()).toBe(false);
    expect(fillHeight("960:60")).toBe(64);
    up(area, yy(60));
    expect(h.studio().canUndo).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("pointercancel", () => {
    const h = renderRoll();
    down(fill("960:60"), yy(20));
    move(h.area, yy(60));
    firePointer(h.area, "pointercancel", { clientX: 0 });
    expect(hasActiveGesture()).toBe(false);
    expect(fillHeight("960:60")).toBe(64);
    expect(h.studio().canUndo).toBe(false);
  });

  it("lostpointercapture(놓기 없이)", () => {
    const h = renderRoll();
    down(fill("960:60"), yy(20));
    move(h.area, yy(60));
    fireEvent(
      h.area,
      new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 1 }),
    );
    expect(hasActiveGesture()).toBe(false);
    expect(fillHeight("960:60")).toBe(64);
    expect(h.studio().canUndo).toBe(false);
  });

  it("다른 포인터의 cancel·lostpointercapture는 무시한다", () => {
    const h = renderRoll();
    down(fill("960:60"), yy(20));
    firePointer(h.area, "pointercancel", { clientX: 0, pointerId: 2 });
    fireEvent(
      h.area,
      new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 2 }),
    );
    expect(hasActiveGesture()).toBe(true);
    up(h.area, yy(20));
  });

  it("재생이 시작되면(편집 불가) 미리보기를 지우고 커밋하지 않는다", async () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(fill("960:60"), yy(20));
    move(h.area, yy(60));
    expect(fillHeight("960:60")).toBe(20);
    await startPlaying(h);
    expect(hasActiveGesture()).toBe(false);
    expect(fillHeight("960:60")).toBe(64);
    up(h.area, yy(60));
    expect(h.studio().song).toBe(before);
  });

  it("언마운트하면 제스처 수를 거둔다", () => {
    const h = renderRoll();
    down(fill("960:60"), yy(20));
    move(h.area, yy(60));
    expect(hasActiveGesture()).toBe(true);
    h.unmount();
    expect(hasActiveGesture()).toBe(false);
  });

  it("제스처 중 그 클립이 바뀌면(되돌리기 등) 버린다", () => {
    const h = renderRoll();
    down(fill("960:60"), yy(20));
    move(h.area, yy(60));
    // 곡을 바꾸는 외부 편집(드래그 중 정상 경로는 막혀 있지만, 방어한다)
    act(() =>
      h.studio().edit.notes.removeNotes(PIANO, CLIP, ["1920:69"]),
    );
    expect(hasActiveGesture()).toBe(false);
    up(h.area, yy(60));
    expect(velocities(h)).toEqual({
      "0:60": 0.8,
      "0:64": 0.8,
      "960:60": 0.8,
    });
  });
});

describe("편집 불가", () => {
  it("재생 중이면 드래그가 아무것도 바꾸지 않는다", async () => {
    const h = renderRoll();
    await startPlaying(h);
    const before = h.studio().song;
    down(fill("960:60"), yy(20));
    expect(hasActiveGesture()).toBe(false);
    move(h.area, yy(60));
    up(h.area, yy(60));
    expect(h.studio().song).toBe(before);
    expect(slider("960:60").getAttribute("aria-disabled")).toBe("true");
  });
});

describe("막대 키보드", () => {
  it("↑/↓로 ±5%씩 바꾼다. 한 번의 키는 히스토리 한 칸이다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    const bar = slider("960:60");
    bar.focus();
    fireEvent.keyDown(bar, { key: "ArrowUp" });
    expect(velocities(h)["960:60"]).toBe(0.85);
    expect(slider("960:60").getAttribute("aria-valuenow")).toBe("85");
    fireEvent.keyDown(slider("960:60"), { key: "ArrowDown" });
    fireEvent.keyDown(slider("960:60"), { key: "ArrowDown" });
    expect(velocities(h)["960:60"]).toBe(0.75);
    act(() => h.studio().undo());
    act(() => h.studio().undo());
    act(() => h.studio().undo());
    expect(h.studio().song).toBe(before);
  });

  it("한계에서는 아무 일도 없다(1 위로, 0.05 아래로)", () => {
    const h = renderRoll(
      songWithNotes({
        trackId: PIANO,
        bars: 1,
        notes: [
          { start: 0, length: 240, pitch: 60, velocity: 1 },
          { start: 960, length: 240, pitch: 62, velocity: 0.05 },
        ],
      }),
    );
    const before = h.studio().song;
    const e = fireEvent.keyDown(slider("0:60"), { key: "ArrowUp" });
    // 처리한 키는 기본 동작(스크롤)을 막는다
    expect(e).toBe(false);
    fireEvent.keyDown(slider("960:62"), { key: "ArrowDown" });
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
  });

  it("선택에 있는 막대면 선택 전체를 같은 값으로 바꾼다", () => {
    const h = renderRoll();
    selectNotes("0:60", "1920:69");
    fireEvent.keyDown(slider("1920:69"), { key: "ArrowUp" });
    expect(velocities(h)).toEqual({
      "0:60": 0.65,
      "0:64": 0.8,
      "960:60": 0.8,
      "1920:69": 0.65,
    });
  });

  it("Ctrl·Alt·Shift·Meta 조합과 다른 키는 무시한다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    const bar = slider("960:60");
    fireEvent.keyDown(bar, { key: "ArrowUp", ctrlKey: true });
    fireEvent.keyDown(bar, { key: "ArrowUp", metaKey: true });
    fireEvent.keyDown(bar, { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(bar, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(h.studio().song).toBe(before);
  });

  it("재생 중에는 무시한다", async () => {
    const h = renderRoll();
    await startPlaying(h);
    const before = h.studio().song;
    fireEvent.keyDown(slider("960:60"), { key: "ArrowUp" });
    expect(h.studio().song).toBe(before);
  });

  it("진행 중인 제스처가 있으면 무시한다", () => {
    const h = renderRoll();
    down(fill("0:60"), yy(20));
    const before = h.studio().song;
    fireEvent.keyDown(slider("960:60"), { key: "ArrowUp" });
    expect(h.studio().song).toBe(before);
    up(h.area, yy(20));
  });
});
