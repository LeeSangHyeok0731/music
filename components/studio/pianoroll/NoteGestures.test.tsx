import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { useRef, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOSAVE_KEY, serializeSong } from "@/lib/score/autosave";
import type { Note, Song } from "@/lib/score/model";
import { songWithNotes } from "@/lib/score/testing/builders";

import { hasActiveGesture } from "../gestures";
import { hasOpenModal } from "../modal";
import { hasOpenPopover, usePopoverDismiss } from "../popover";
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

/**
 * 피아노롤 음 제스처(Task 4). 실제 `StudioProvider`의 곡 상태와 모달의 선택(`aria-pressed`)을
 * 단언한다. 격자 요소가 포인터를 캡처하고, 테스트 도우미는 캡처된 포인터의 이벤트를 캡처 요소로
 * 다시 보낸다(실제 브라우저처럼) — 그래서 격자 **밖**(건반 열)에 쏜 move·up도 캡처가 pointerdown에서
 * 잡혔다면 격자에 닿는다.
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
  // 제스처·모달 카운터가 새면 다음 테스트와 전역 단축키(실행취소 차단)로 번진다.
  expect(hasActiveGesture()).toBe(false);
  expect(hasOpenModal()).toBe(false);
  expect(hasOpenPopover()).toBe(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  restorePointer();
  restoreAudio();
});

const PIANO = "track-piano";
const CLIP = "clip-1";
/** 격자의 화면 위치(stub). 1px = 5틱, 한 행 = 20px, 표시 범위 hi = 96(피아노 36~96). */
const GL = 200;
const GT = 100;
const HI = 96;
const x = (tick: number) => GL + tick / 5;
const y = (pitch: number) => GT + (HI - pitch) * 20 + 10;

/**
 * 2마디, 음 클립 하나 [0, 3840).
 * C4 [0,240), E4 [0,240)(화음), C4 [960,1200), A4 [1920,2400).
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

function renderRoll(song: Song = rollSong(), extra?: ReactNode) {
  const onClose = vi.fn();
  const noteRenders: string[] = [];
  const onNoteRender = (key: string) => noteRenders.push(key);
  const h = renderWithStudio(
    <>
      <PianoRoll
        trackId={PIANO}
        clipId={CLIP}
        onClose={onClose}
        onNoteRender={onNoteRender}
      />
      {extra}
    </>,
    { stored: { [AUTOSAVE_KEY]: serializeSong(song) } },
  );
  const grid = screen.getByTestId("roll-grid");
  stubLaneRect(grid, { left: GL, top: GT, width: 3840 / 5, height: 61 * 20 });
  return { ...h, onClose, noteRenders, grid };
}

type Roll = ReturnType<typeof renderRoll>;

function wrap(key: string): HTMLElement {
  const el = screen
    .getByTestId("roll-grid")
    .querySelector<HTMLElement>(`[data-note-key="${key}"]`);
  if (!el) throw new Error(`음 ${key}이 없다`);
  return el;
}
function bodyOf(key: string): HTMLElement {
  return wrap(key).querySelector("button")!;
}
function handleOf(key: string): HTMLElement {
  return within(wrap(key)).getByRole("separator", { name: "음 길이 조절" });
}
function keys(): string[] {
  return [
    ...screen.getByTestId("roll-grid").querySelectorAll("[data-note-key]"),
  ].map((el) => el.getAttribute("data-note-key")!);
}
function selected(): string[] {
  return [
    ...screen
      .getByTestId("roll-grid")
      .querySelectorAll('button[aria-pressed="true"]'),
  ].map((b) => b.closest("[data-note-key]")!.getAttribute("data-note-key")!);
}
function clipNotes(h: Roll): Note[] {
  const body = h.studio().song.tracks[0].clips[0].body;
  return body.type === "notes" ? body.notes : [];
}
function keyColumn(): HTMLElement {
  return screen.getByTestId("roll-keys");
}

const down = (el: Element, cx: number, cy: number, o: Partial<PointerInit> = {}) =>
  firePointer(el, "pointerdown", { clientX: cx, clientY: cy, ...o });
const move = (el: Element, cx: number, cy: number, o: Partial<PointerInit> = {}) =>
  firePointer(el, "pointermove", { clientX: cx, clientY: cy, ...o });
const up = (el: Element, cx: number, cy: number, o: Partial<PointerInit> = {}) =>
  firePointer(el, "pointerup", { clientX: cx, clientY: cy, ...o });
function click(el: Element, cx: number, cy: number, o: Partial<PointerInit> = {}) {
  down(el, cx, cy, o);
  up(el, cx, cy, o);
}
const esc = () => fireEvent.keyDown(document.body, { key: "Escape" });

describe("빈 곳 클릭 = 음 추가", () => {
  it("눌린 칸의 시작(내림)·그 행에 기본 길이·세기 0.8 음을 추가하고 선택한다", () => {
    const h = renderRoll();
    expect(h.studio().canUndo).toBe(false);
    // 500틱 = 1/8 칸 [480, 720), D4(62)
    click(h.grid, x(500), y(62));
    expect(clipNotes(h)).toContainEqual({
      start: 480,
      length: 240,
      pitch: 62,
      velocity: 0.8,
    });
    expect(clipNotes(h)).toHaveLength(5);
    expect(selected()).toEqual(["480:62"]);
    expect(h.studio().canUndo).toBe(true);
  });

  it("격자 단위를 따른다(1/16 → 120틱 칸, 길이 120)", () => {
    const h = renderRoll();
    fireEvent.click(screen.getByRole("radio", { name: "1/16" }));
    click(h.grid, x(500), y(62));
    expect(clipNotes(h)).toContainEqual({
      start: 480,
      length: 120,
      pitch: 62,
      velocity: 0.8,
    });
  });

  it("이미 같은 음높이 음이 품은 칸이면 추가하지 않는다(1/4 칸 시작 0이 C4 [0,240) 안)", () => {
    const h = renderRoll();
    fireEvent.click(screen.getByRole("radio", { name: "1/4" }));
    const before = h.studio().song;
    click(h.grid, x(250), y(60)); // 음 밖(250틱)이지만 칸 시작 0은 C4 안
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
  });

  it("5px 이상 움직였다 놓으면 추가하지 않는다(박스 선택이 된다)", () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(h.grid, x(500), y(62));
    move(h.grid, x(500) + 6, y(62));
    up(h.grid, x(500) + 6, y(62));
    expect(h.studio().song).toBe(before);
  });

  it("주 버튼이 아니거나(우클릭) 좌표가 NaN이면 무시한다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    click(h.grid, x(500), y(62), { button: 2 });
    fireBadPointer(h.grid, "pointerdown", Number.NaN);
    fireBadPointer(h.grid, "pointerup", Number.NaN);
    expect(h.studio().song).toBe(before);
    expect(hasActiveGesture()).toBe(false);
  });

  it("편집 불가(재생 중)면 무시한다", async () => {
    const h = renderRoll();
    await startPlaying(h);
    const before = h.studio().song;
    click(h.grid, x(500), y(62));
    expect(h.studio().song).toBe(before);
    expect(hasActiveGesture()).toBe(false);
  });

  it("열린 팝오버를 닫는 누름은 음을 추가하지 않는다(다음 클릭은 추가한다)", () => {
    function PopoverProbe() {
      const [open, setOpen] = useState(true);
      return open ? <ProbeBody onClose={() => setOpen(false)} /> : null;
    }
    function ProbeBody({ onClose }: { onClose(): void }) {
      const rootRef = useRef<HTMLDivElement>(null);
      const [anchor] = useState(() => document.createElement("button"));
      usePopoverDismiss({ anchor, rootRef, onClose });
      return <div ref={rootRef} role="dialog" aria-label="probe" />;
    }
    const h = renderRoll(rollSong(), <PopoverProbe />);
    expect(hasOpenPopover()).toBe(true);
    const before = h.studio().song;
    click(h.grid, x(500), y(62));
    expect(hasOpenPopover()).toBe(false);
    expect(h.studio().song).toBe(before);
    click(h.grid, x(500), y(62));
    expect(h.studio().song).not.toBe(before);
  });
});

describe("음 클릭 = 선택", () => {
  it("클릭은 그 음만, Shift+클릭은 토글", () => {
    const h = renderRoll();
    click(bodyOf("0:60"), x(100), y(60));
    expect(selected()).toEqual(["0:60"]);
    click(bodyOf("0:64"), x(100), y(64));
    expect(selected()).toEqual(["0:64"]);
    click(bodyOf("960:60"), x(1000), y(60), { shiftKey: true });
    expect(selected().sort()).toEqual(["0:64", "960:60"]);
    click(bodyOf("0:64"), x(100), y(64), { shiftKey: true });
    expect(selected()).toEqual(["960:60"]);
    // 선택은 곡을 바꾸지 않는다.
    expect(h.studio().canUndo).toBe(false);
  });

  it("선택에 없는 음을 끌기 시작하면 그 음만 단독 선택하고 그 음만 옮긴다", () => {
    const h = renderRoll();
    click(bodyOf("0:64"), x(100), y(64));
    click(bodyOf("1920:69"), x(2000), y(69), { shiftKey: true });
    down(bodyOf("960:60"), x(1000), y(60), { shiftKey: true });
    move(h.grid, x(1000 + 240), y(60), { shiftKey: true });
    expect(selected()).toEqual(["960:60"]);
    up(h.grid, x(1000 + 240), y(60), { shiftKey: true });
    expect(clipNotes(h).map((n) => `${n.start}:${n.pitch}`)).toEqual([
      "0:60",
      "0:64",
      "1200:60",
      "1920:69",
    ]);
    expect(selected()).toEqual(["1200:60"]);
  });

  it("마우스 클릭 뒤 브라우저가 보내는 click(detail 1)은 삼키고, 키보드 클릭(detail 0)은 선택한다", () => {
    renderRoll();
    click(bodyOf("0:60"), x(100), y(60));
    fireEvent.click(bodyOf("0:60"), { detail: 1, shiftKey: true });
    expect(selected()).toEqual(["0:60"]);
    fireEvent.click(bodyOf("0:64"), { detail: 0 });
    expect(selected()).toEqual(["0:64"]);
  });
});

describe("음 본문 드래그 = 이동", () => {
  it("5px 미만이면 클릭(선택만, 커밋 없음)", () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100) + 4, y(60));
    up(h.grid, x(100) + 4, y(60));
    expect(h.studio().song).toBe(before);
    expect(selected()).toEqual(["0:60"]);
  });

  it("캡처는 pointerdown에서 이미 격자에 잡혀 있다", () => {
    const h = renderRoll();
    down(bodyOf("0:60"), x(100), y(60));
    expect(h.grid.hasPointerCapture(1)).toBe(true);
    expect(hasActiveGesture()).toBe(true);
    up(h.grid, x(100), y(60));
    expect(h.grid.hasPointerCapture(1)).toBe(false);
  });

  it("미리보기 중에는 곡·canUndo가 그대로이고 음이 미리보기 위치에 그려진다(data-dragging)", () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100 + 480), y(62));
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
    const el = wrap("0:60"); // 원래 키로 그대로 그린다(다시 마운트하지 않는다)
    expect(el.getAttribute("data-dragging")).toBe("true");
    expect([el.style.left, el.style.top]).toEqual([
      `${480 / 5}px`,
      `${(HI - 62) * 20}px`,
    ]);
    expect(wrap("0:64").hasAttribute("data-dragging")).toBe(false);
    up(h.grid, x(100 + 480), y(62));
  });

  it("놓을 때 정확히 한 번 커밋한다(키·위치), 선택은 결과 키", () => {
    const h = renderRoll();
    const before = h.studio().song;
    const spy = vi.spyOn(h.studio().edit.notes, "moveNotes");
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100 + 240), y(60));
    move(h.grid, x(100 + 480), y(61));
    move(h.grid, x(100 + 480), y(62));
    up(h.grid, x(100 + 480), y(62));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(clipNotes(h)).toContainEqual({
      start: 480,
      length: 240,
      pitch: 62,
      velocity: 0.8,
    });
    expect(keys()).not.toContain("0:60");
    expect(selected()).toEqual(["480:62"]);
    // 기록도 한 칸이다.
    act(() => h.studio().undo());
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
  });

  it("화음(두 음)을 한 덩어리로 옮긴다", () => {
    const h = renderRoll();
    click(bodyOf("0:60"), x(100), y(60));
    click(bodyOf("0:64"), x(100), y(64), { shiftKey: true });
    down(bodyOf("0:64"), x(100), y(64));
    move(h.grid, x(100 + 240), y(65));
    expect(wrap("0:60").getAttribute("data-dragging")).toBe("true");
    expect(wrap("0:64").getAttribute("data-dragging")).toBe("true");
    up(h.grid, x(100 + 240), y(65));
    expect(clipNotes(h).map((n) => `${n.start}:${n.pitch}`)).toEqual([
      "240:61",
      "240:65",
      "960:60",
      "1920:69",
    ]);
    expect(selected().sort()).toEqual(["240:61", "240:65"]);
  });

  it("거부 구간(같은 음높이 겹침)에서는 마지막 유효 위치를 유지하고 그 위치로 커밋한다", () => {
    const h = renderRoll();
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100 + 240), y(60)); // 240: 유효
    move(h.grid, x(100 + 960), y(60)); // 960: C4 [960,1200)와 겹침 → 거부
    expect(wrap("0:60").style.left).toBe(`${240 / 5}px`);
    up(h.grid, x(100 + 960), y(60));
    expect(clipNotes(h).map((n) => `${n.start}:${n.pitch}`)).toContain("240:60");
  });

  it("거부 구간(클립 왼쪽 경계)에서도 마지막 유효 위치를 유지한다", () => {
    const h = renderRoll();
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100), y(61)); // 한 행 위: 유효
    move(h.grid, x(100 - 240), y(61)); // 왼쪽 경계 밖 → 거부
    expect([wrap("0:60").style.left, wrap("0:60").style.top]).toEqual([
      "0px",
      `${(HI - 61) * 20}px`,
    ]);
    up(h.grid, x(100 - 240), y(61));
    expect(clipNotes(h).map((n) => `${n.start}:${n.pitch}`)).toContain("0:61");
  });

  it("거부 구간(음높이 한계 hi 96)에서도 마지막 유효 위치를 유지한다", () => {
    const h = renderRoll();
    down(bodyOf("1920:69"), x(2000), y(69));
    move(h.grid, x(2000), y(96)); // 27행 위 = 96: 유효
    move(h.grid, x(2000), y(96) - 20); // 97: 범위 밖 → 거부
    expect(wrap("1920:69").style.top).toBe("0px");
    up(h.grid, x(2000), y(96) - 20);
    expect(clipNotes(h).map((n) => `${n.start}:${n.pitch}`)).toContain("1920:96");
  });

  it("제자리로 돌아와 놓으면 커밋하지 않는다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100 + 480), y(60));
    move(h.grid, x(100 + 20), y(60)); // 100틱 → 0칸
    expect(wrap("0:60").style.left).toBe("0px");
    up(h.grid, x(100 + 20), y(60));
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
  });

  it("격자 밖(건반 열)에 쏜 move·up도 캡처 덕에 격자에 닿아 완료된다", () => {
    const h = renderRoll();
    down(bodyOf("0:60"), x(100), y(60));
    move(keyColumn(), x(100 + 240), y(60));
    up(keyColumn(), x(100 + 240), y(60));
    expect(clipNotes(h).map((n) => `${n.start}:${n.pitch}`)).toContain("240:60");
  });

  it("재라우팅 없이 다른 요소(다른 음) 위에서 놓아도 완료된다", () => {
    const h = renderRoll();
    down(bodyOf("0:60"), x(100), y(60));
    move(bodyOf("0:64"), x(100 + 240), y(60), { retarget: false });
    up(bodyOf("1920:69"), x(100 + 240), y(60), { retarget: false });
    expect(clipNotes(h).map((n) => `${n.start}:${n.pitch}`)).toContain("240:60");
    expect(hasActiveGesture()).toBe(false);
  });

  it("캡처가 던지면 제스처를 만들지 않는다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(
      () => {
        throw new Error("InvalidPointerId");
      },
    );
    down(bodyOf("0:60"), x(100), y(60));
    expect(hasActiveGesture()).toBe(false);
    move(h.grid, x(100 + 240), y(60));
    up(h.grid, x(100 + 240), y(60));
    expect(h.studio().song).toBe(before);
  });

  it("마우스 버튼이 이미 떼어진 move(놓기를 놓침)는 드래그를 취소한다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100 + 240), y(60));
    move(h.grid, x(100 + 480), y(60), { buttons: 0 });
    expect(hasActiveGesture()).toBe(false);
    expect(wrap("0:60").hasAttribute("data-dragging")).toBe(false);
    move(h.grid, x(100 + 720), y(60));
    up(h.grid, x(100 + 720), y(60));
    expect(h.studio().song).toBe(before);
  });

  it("드래그 뒤 브라우저 click(detail 1)은 삼킨다", () => {
    const h = renderRoll();
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100 + 240), y(60));
    up(h.grid, x(100 + 240), y(60));
    // 실제 브라우저는 놓은 뒤 click을 한 번 보낸다. Shift가 눌려 있어도 토글하지 않는다.
    fireEvent.click(bodyOf("240:60"), { detail: 1, shiftKey: true });
    expect(selected()).toEqual(["240:60"]);
  });
});

describe("이동 취소 경로(커밋 없음)", () => {
  function startDrag(h: Roll) {
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100 + 480), y(60));
    expect(wrap("0:60").getAttribute("data-dragging")).toBe("true");
  }
  function expectCancelled(h: Roll, before: Song) {
    expect(hasActiveGesture()).toBe(false);
    expect(h.grid.hasPointerCapture(1)).toBe(false);
    up(h.grid, x(100 + 480), y(60));
    expect(h.studio().song).toBe(before);
    expect(wrap("0:60").hasAttribute("data-dragging")).toBe(false);
    expect(wrap("0:60").style.left).toBe("0px");
  }

  it("Esc", () => {
    const h = renderRoll();
    const before = h.studio().song;
    startDrag(h);
    esc();
    expectCancelled(h, before);
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it("pointercancel", () => {
    const h = renderRoll();
    const before = h.studio().song;
    startDrag(h);
    firePointer(h.grid, "pointercancel", { clientX: 0 });
    expectCancelled(h, before);
  });

  it("lostpointercapture(놓기 없이)", () => {
    const h = renderRoll();
    const before = h.studio().song;
    startDrag(h);
    fireEvent(
      h.grid,
      new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 1 }),
    );
    expectCancelled(h, before);
  });

  it("다른 포인터의 cancel·lostpointercapture는 무시한다", () => {
    const h = renderRoll();
    startDrag(h);
    firePointer(h.grid, "pointercancel", { clientX: 0, pointerId: 2 });
    fireEvent(
      h.grid,
      new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 2 }),
    );
    expect(hasActiveGesture()).toBe(true);
    up(h.grid, x(100 + 480), y(60));
    expect(clipNotes(h).map((n) => `${n.start}:${n.pitch}`)).toContain("480:60");
  });

  it("편집 불가(재생 시작)", async () => {
    const h = renderRoll();
    const before = h.studio().song;
    startDrag(h);
    await startPlaying(h);
    expect(hasActiveGesture()).toBe(false);
    act(() => h.studio().stop());
    expectCancelled(h, before);
  });

  it("대상 소멸(드래그 중 그 클립이 바뀜)", () => {
    const h = renderRoll();
    startDrag(h);
    act(() => h.studio().edit.notes.removeNotes(PIANO, CLIP, ["1920:69"]));
    const after = h.studio().song;
    expect(hasActiveGesture()).toBe(false);
    up(h.grid, x(100 + 480), y(60));
    expect(h.studio().song).toBe(after);
  });

  it("클립이 사라지면(격자가 문서에서 떨어짐) 제스처를 거둔다", () => {
    const h = renderRoll();
    startDrag(h);
    const grid = h.grid;
    act(() => h.studio().edit.removeClip(PIANO, CLIP));
    expect(grid.isConnected).toBe(false);
    expect(hasActiveGesture()).toBe(false);
  });

  it("언마운트", () => {
    const h = renderRoll();
    startDrag(h);
    h.unmount();
    expect(hasActiveGesture()).toBe(false);
  });
});

describe("오른쪽 가장자리 8px 핸들 = 길이", () => {
  it("핸들은 separator '음 길이 조절'이고 클릭(움직임 없음)은 아무 일도 없다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    const handle = handleOf("0:60");
    expect(handle.style.width).toBe("8px");
    click(handle, x(238), y(60));
    expect(h.studio().song).toBe(before);
    expect(selected()).toEqual([]);
  });

  it("8px 핸들에서 첫 move가 핸들 밖(건반 열)이어도 드래그가 시작된다(캡처를 pointerdown에서)", () => {
    const h = renderRoll();
    down(handleOf("0:60"), x(238), y(60));
    move(keyColumn(), x(238) + 6, y(60));
    expect(hasActiveGesture()).toBe(true);
    move(keyColumn(), x(238 + 240), y(60));
    expect(wrap("0:60").getAttribute("data-dragging")).toBe("true");
    expect(wrap("0:60").style.width).toBe(`${480 / 5}px`);
    up(keyColumn(), x(238 + 240), y(60));
    expect(clipNotes(h)).toContainEqual({
      start: 0,
      length: 480,
      pitch: 60,
      velocity: 0.8,
    });
    expect(selected()).toEqual(["0:60"]);
  });

  it("선택 전체에 같은 변화량을 주고 덩어리째 클램프한다(C4는 다음 C4 직전 960까지)", () => {
    const h = renderRoll();
    const spy = vi.spyOn(h.studio().edit.notes, "resizeNotes");
    click(bodyOf("0:60"), x(100), y(60));
    click(bodyOf("1920:69"), x(2000), y(69), { shiftKey: true });
    down(handleOf("1920:69"), x(2398), y(69));
    move(h.grid, x(2398 + 1500), y(69));
    move(h.grid, x(2398 + 1800), y(69));
    up(h.grid, x(2398 + 1800), y(69));
    expect(spy).toHaveBeenCalledTimes(1);
    const byKey = new Map(clipNotes(h).map((n) => [`${n.start}:${n.pitch}`, n]));
    expect(byKey.get("0:60")?.length).toBe(960); // 240 + 720
    expect(byKey.get("1920:69")?.length).toBe(1200); // 480 + 720
    expect(selected().sort()).toEqual(["0:60", "1920:69"]);
  });

  it("늘였다가 원래 길이 아래로 되돌아와 놓으면 커밋하지 않는다(최소 길이 음)", () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(handleOf("0:60"), x(238), y(60));
    move(h.grid, x(238 + 240), y(60));
    move(h.grid, x(238 - 200), y(60));
    expect(wrap("0:60").style.width).toBe(`${240 / 5}px`);
    up(h.grid, x(238 - 200), y(60));
    expect(h.studio().song).toBe(before);
  });

  it("Esc로 취소하면 길이가 그대로다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    down(handleOf("0:60"), x(238), y(60));
    move(h.grid, x(238 + 480), y(60));
    esc();
    up(h.grid, x(238 + 480), y(60));
    expect(h.studio().song).toBe(before);
  });
});

describe("빈 곳 드래그 = 박스 선택", () => {
  it("교차하는 음을 놓을 때 선택하고, 박스는 미리보기다", () => {
    const h = renderRoll();
    down(h.grid, x(100), y(66));
    move(h.grid, x(600), y(62));
    expect(screen.getByTestId("roll-selection-box")).toBeTruthy();
    expect(selected()).toEqual([]);
    move(h.grid, x(1000), y(59));
    up(h.grid, x(1000), y(59));
    expect(screen.queryByTestId("roll-selection-box")).toBeNull();
    // 틱 [100,1000), 음높이 59..66: C4 [0,240), E4 [0,240), C4 [960,1200). A4(69)는 밖.
    expect(selected().sort()).toEqual(["0:60", "0:64", "960:60"]);
    expect(h.studio().canUndo).toBe(false);
  });

  it("Shift면 기존 선택에 합친다", () => {
    const h = renderRoll();
    click(bodyOf("1920:69"), x(2000), y(69));
    down(h.grid, x(100), y(66), { shiftKey: true });
    move(h.grid, x(200), y(63), { shiftKey: true });
    up(h.grid, x(200), y(63), { shiftKey: true });
    expect(selected().sort()).toEqual(["0:64", "1920:69"]);
  });

  it("빈 박스는 Shift 없으면 선택을 비우고, Shift면 그대로 둔다", () => {
    const h = renderRoll();
    click(bodyOf("1920:69"), x(2000), y(69));
    down(h.grid, x(3000), y(80), { shiftKey: true });
    move(h.grid, x(3500), y(85), { shiftKey: true });
    up(h.grid, x(3500), y(85), { shiftKey: true });
    expect(selected()).toEqual(["1920:69"]);
    down(h.grid, x(3000), y(80));
    move(h.grid, x(3500), y(85));
    up(h.grid, x(3500), y(85));
    expect(selected()).toEqual([]);
  });

  it("Esc·pointercancel이면 박스만 버리고 선택은 그대로다", () => {
    const h = renderRoll();
    click(bodyOf("1920:69"), x(2000), y(69));
    down(h.grid, x(100), y(66));
    move(h.grid, x(1000), y(59));
    esc();
    expect(screen.queryByTestId("roll-selection-box")).toBeNull();
    up(h.grid, x(1000), y(59));
    expect(selected()).toEqual(["1920:69"]);
    down(h.grid, x(100), y(66));
    move(h.grid, x(1000), y(59));
    firePointer(h.grid, "pointercancel", { clientX: 0 });
    expect(screen.queryByTestId("roll-selection-box")).toBeNull();
    expect(selected()).toEqual(["1920:69"]);
    expect(h.onClose).not.toHaveBeenCalled();
  });
});

describe("편집 불가", () => {
  it("음 본문·핸들이 aria-disabled이고 음 클릭·드래그를 무시한다", async () => {
    const h = renderRoll();
    await startPlaying(h);
    expect(bodyOf("0:60").getAttribute("aria-disabled")).toBe("true");
    expect(handleOf("0:60").getAttribute("aria-disabled")).toBe("true");
    const before = h.studio().song;
    click(bodyOf("0:60"), x(100), y(60));
    fireEvent.click(bodyOf("0:60"), { detail: 0 });
    expect(selected()).toEqual([]);
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100 + 480), y(60));
    up(h.grid, x(100 + 480), y(60));
    expect(hasActiveGesture()).toBe(false);
    expect(h.studio().song).toBe(before);
  });

  it("정지 중에는 aria-disabled가 없다", () => {
    renderRoll();
    expect(bodyOf("0:60").hasAttribute("aria-disabled")).toBe(false);
    expect(handleOf("0:60").hasAttribute("aria-disabled")).toBe(false);
  });
});

describe("Esc 단계(한 번에 한 겹)", () => {
  it("드래그 취소 → 선택 해제 → 모달 닫기", () => {
    const h = renderRoll();
    click(bodyOf("0:60"), x(100), y(60));
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100 + 480), y(60));
    esc();
    expect(hasActiveGesture()).toBe(false);
    expect(selected()).toEqual(["0:60"]);
    expect(h.onClose).not.toHaveBeenCalled();
    esc();
    expect(selected()).toEqual([]);
    expect(h.onClose).not.toHaveBeenCalled();
    esc();
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("임계값 전(누르고만 있음)의 Esc도 누름을 취소하고 선택은 그대로다", () => {
    const h = renderRoll();
    click(bodyOf("0:60"), x(100), y(60));
    down(h.grid, x(500), y(62));
    expect(hasActiveGesture()).toBe(true);
    esc();
    expect(hasActiveGesture()).toBe(false);
    expect(selected()).toEqual(["0:60"]);
    // 취소된 누름의 놓기는 음을 추가하지 않는다.
    const before = h.studio().song;
    up(h.grid, x(500), y(62));
    expect(h.studio().song).toBe(before);
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it("되돌리기로 선택한 키가 사라지면 걸러진다(다음 Esc는 모달을 닫는다)", () => {
    const h = renderRoll();
    down(bodyOf("0:60"), x(100), y(60));
    move(h.grid, x(100 + 240), y(60));
    up(h.grid, x(100 + 240), y(60));
    expect(selected()).toEqual(["240:60"]);
    act(() => h.studio().undo());
    expect(keys()).toContain("0:60");
    expect(selected()).toEqual([]);
    esc();
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("렌더 비용", () => {
  it("재생 위치가 10Hz로 바뀌어도 음은 다시 그려지지 않는다", async () => {
    const h = renderRoll();
    await startPlaying(h);
    const count = h.noteRenders.length;
    expect(count).toBeGreaterThanOrEqual(4);
    h.fake.engine.currentTick.mockReturnValue(1920);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(within(screen.getByRole("dialog")).getByText(/2마디 · 1박/)).toBeTruthy();
    expect(h.noteRenders.length).toBe(count);
  });

  it("선택·미리보기가 바뀌면 바뀐 음만 다시 그린다", () => {
    const h = renderRoll();
    h.noteRenders.length = 0;
    click(bodyOf("0:60"), x(100), y(60));
    expect(h.noteRenders).toEqual(["0:60"]);
    h.noteRenders.length = 0;
    click(bodyOf("0:64"), x(100), y(64), { shiftKey: true });
    expect(h.noteRenders).toEqual(["0:64"]);
    h.noteRenders.length = 0;
    down(bodyOf("0:64"), x(100), y(64));
    move(h.grid, x(100 + 240), y(64));
    expect(h.noteRenders.sort()).toEqual(["0:60", "0:64"]);
    h.noteRenders.length = 0;
    // 같은 칸 안의 움직임은 미리보기가 같아 아무것도 다시 그리지 않는다.
    move(h.grid, x(100 + 250), y(64));
    expect(h.noteRenders).toEqual([]);
    esc();
  });
});
