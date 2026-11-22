import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOSAVE_KEY, serializeSong } from "@/lib/score/autosave";
import { GRID_UNITS } from "@/lib/score/notes";
import type { Note, Song } from "@/lib/score/model";
import { songWithNotes } from "@/lib/score/testing/builders";

import { hasActiveGesture } from "../gestures";
import { hasOpenModal } from "../modal";
import {
  installAudioContextStub,
  renderWithStudio,
  startPlaying,
} from "../testing/harness";
import { firePointer, installPointerCaptureStubs } from "../testing/pointer";
import { PianoRoll } from "./PianoRoll";
import { noteKeyCommand } from "./useNoteKeys";

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
/** 기본 격자 단위는 1/8 = 240틱. */
const UNIT = GRID_UNITS["1/8"];

/**
 * 2마디, 음 클립 하나 [0, 3840).
 * C4 [0,240), E4 [0,240)(화음), C4 [960,1200), A4 [1920,2400) — 세기는 모두 0.8.
 */
function rollSong(): Song {
  return songWithNotes({
    trackId: PIANO,
    bars: 2,
    notes: [
      { start: 0, length: 240, pitch: 60, velocity: 0.8 },
      { start: 0, length: 240, pitch: 64, velocity: 0.8 },
      { start: 960, length: 240, pitch: 60, velocity: 0.8 },
      { start: 1920, length: 480, pitch: 69, velocity: 0.8 },
    ],
  });
}

function renderRoll(song: Song = rollSong()) {
  return renderWithStudio(
    <PianoRoll trackId={PIANO} clipId={CLIP} onClose={() => {}} />,
    { stored: { [AUTOSAVE_KEY]: serializeSong(song) } },
  );
}
type Roll = ReturnType<typeof renderRoll>;

function notes(h: Roll): string[] {
  const body = h.studio().song.tracks[0].clips[0].body;
  const list: Note[] = body.type === "notes" ? body.notes : [];
  return list.map((n) => `${n.start}:${n.pitch}:${n.length}`);
}
function scroll(): HTMLElement {
  return screen.getByTestId("roll-scroll");
}
function noteButton(key: string): HTMLElement {
  return screen
    .getByTestId("roll-grid")
    .querySelector<HTMLElement>(`[data-note-key="${key}"] button`)!;
}
function selectNotes(...keys: string[]) {
  keys.forEach((k, i) => fireEvent.click(noteButton(k), { shiftKey: i > 0 }));
}
function pressedKeys(): string[] {
  return [
    ...screen
      .getByTestId("roll-grid")
      .querySelectorAll('button[aria-pressed="true"]'),
  ].map((b) => b.closest("[data-note-key]")!.getAttribute("data-note-key")!);
}
/** 키를 보낸다. 돌려주는 값이 false면 `preventDefault`된 것이다. */
function press(
  key: string,
  init: KeyboardEventInit = {},
  target: Element = scroll(),
): boolean {
  return fireEvent.keyDown(target, { key, ...init });
}

describe("noteKeyCommand (순수 표)", () => {
  const k = (key: string, o: Partial<KeyboardEvent> = {}) =>
    noteKeyCommand(
      {
        key,
        code: "",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        ...o,
      },
      UNIT,
    );

  it("방향키·수식키 조합", () => {
    expect(k("ArrowRight")).toEqual({ type: "move", dTicks: UNIT, dPitch: 0 });
    expect(k("ArrowLeft")).toEqual({ type: "move", dTicks: -UNIT, dPitch: 0 });
    expect(k("ArrowUp")).toEqual({ type: "move", dTicks: 0, dPitch: 1 });
    expect(k("ArrowDown")).toEqual({ type: "move", dTicks: 0, dPitch: -1 });
    expect(k("ArrowUp", { shiftKey: true })).toEqual({
      type: "move",
      dTicks: 0,
      dPitch: 12,
    });
    expect(k("ArrowDown", { shiftKey: true })).toEqual({
      type: "move",
      dTicks: 0,
      dPitch: -12,
    });
    expect(k("ArrowRight", { altKey: true })).toEqual({
      type: "resize",
      dTicks: UNIT,
    });
    expect(k("ArrowLeft", { altKey: true })).toEqual({
      type: "resize",
      dTicks: -UNIT,
    });
  });

  it("삭제·전체 선택", () => {
    expect(k("Delete")).toEqual({ type: "remove" });
    expect(k("Backspace")).toEqual({ type: "remove" });
    expect(k("a", { ctrlKey: true })).toEqual({ type: "selectAll" });
    expect(k("A", { metaKey: true })).toEqual({ type: "selectAll" });
    // 한글 배열: key가 ASCII가 아니어도 물리 키 KeyA로 본다
    expect(k("ㅁ", { ctrlKey: true, code: "KeyA" })).toEqual({
      type: "selectAll",
    });
  });

  it("처리하지 않는 조합은 null", () => {
    expect(k("a")).toBeNull();
    expect(k("a", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(k("ArrowRight", { ctrlKey: true })).toBeNull();
    expect(k("ArrowLeft", { metaKey: true })).toBeNull();
    expect(k("ArrowUp", { altKey: true })).toBeNull();
    expect(k("ArrowRight", { shiftKey: true })).toBeNull();
    expect(k("Delete", { shiftKey: true })).toBeNull();
    expect(k("Delete", { ctrlKey: true })).toBeNull();
    expect(k("Enter")).toBeNull();
    expect(k("z", { ctrlKey: true })).toBeNull();
  });

  it("단위를 따른다(1/16 = 120틱)", () => {
    expect(
      noteKeyCommand(
        {
          key: "ArrowRight",
          code: "",
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
        },
        GRID_UNITS["1/16"],
      ),
    ).toEqual({ type: "move", dTicks: 120, dPitch: 0 });
  });
});

describe("이동", () => {
  it("→/←는 선택을 격자 단위만큼 시간 이동하고 선택은 새 키로 따라간다", () => {
    const h = renderRoll();
    selectNotes("960:60");
    expect(press("ArrowRight")).toBe(false);
    expect(notes(h)).toContain("1200:60:240");
    expect(pressedKeys()).toEqual(["1200:60"]);
    press("ArrowLeft");
    press("ArrowLeft");
    expect(notes(h)).toContain("720:60:240");
    expect(pressedKeys()).toEqual(["720:60"]);
  });

  it("↑/↓는 반음, Shift+↑/↓는 옥타브", () => {
    const h = renderRoll();
    selectNotes("1920:69");
    press("ArrowUp");
    expect(notes(h)).toContain("1920:70:480");
    press("ArrowDown", { shiftKey: true });
    expect(notes(h)).toContain("1920:58:480");
    press("ArrowUp", { shiftKey: true });
    press("ArrowUp", { shiftKey: true });
    expect(notes(h)).toContain("1920:82:480");
    expect(pressedKeys()).toEqual(["1920:82"]);
  });

  it("여러 음은 한 덩어리로 옮긴다", () => {
    const h = renderRoll();
    selectNotes("0:60", "0:64");
    press("ArrowUp");
    expect(notes(h).slice(0, 2).sort()).toEqual(["0:61:240", "0:65:240"]);
    expect(pressedKeys().sort()).toEqual(["0:61", "0:65"]);
  });

  it("한 번의 키 = 히스토리 한 칸: 되돌리기 한 번이 복구한다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    selectNotes("960:60");
    press("ArrowRight");
    act(() => h.studio().undo());
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
  });

  it("거부(클립 왼쪽 경계)면 곡이 그대로이고 히스토리 칸이 없다 — 그래도 방향키 스크롤은 막는다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    selectNotes("0:60");
    expect(press("ArrowLeft")).toBe(false);
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
    expect(pressedKeys()).toEqual(["0:60"]);
  });

  it("거부(겹침): 같은 음높이의 다른 음과 겹치게 옮기지 않는다", () => {
    const h = renderRoll(
      songWithNotes({
        trackId: PIANO,
        bars: 1,
        notes: [
          { start: 0, length: 240, pitch: 60, velocity: 0.8 },
          { start: 240, length: 240, pitch: 60, velocity: 0.8 },
        ],
      }),
    );
    const before = h.studio().song;
    selectNotes("0:60");
    press("ArrowRight");
    expect(h.studio().song).toBe(before);
  });
});

describe("길이", () => {
  it("Alt+→/←는 선택 음의 길이를 격자 단위만큼 늘이고 줄인다(시작은 그대로)", () => {
    const h = renderRoll();
    selectNotes("960:60");
    expect(press("ArrowRight", { altKey: true })).toBe(false);
    expect(notes(h)).toContain("960:60:480");
    press("ArrowLeft", { altKey: true });
    expect(notes(h)).toContain("960:60:240");
    expect(pressedKeys()).toEqual(["960:60"]);
  });

  it("최소 길이(격자 단위) 아래로는 줄지 않는다(거부)", () => {
    const h = renderRoll();
    const before = h.studio().song;
    selectNotes("960:60");
    press("ArrowLeft", { altKey: true });
    expect(h.studio().song).toBe(before);
  });
});

describe("삭제", () => {
  it("Delete는 선택한 음만 지우고 선택을 비우고 포커스를 격자로 돌린다", () => {
    const h = renderRoll();
    selectNotes("0:60", "960:60");
    noteButton("960:60").focus();
    expect(press("Delete", {}, noteButton("960:60"))).toBe(false);
    expect(notes(h)).toEqual(["0:64:240", "1920:69:480"]);
    expect(pressedKeys()).toEqual([]);
    expect(document.activeElement).toBe(scroll());
  });

  it("Backspace도 같다", () => {
    const h = renderRoll();
    selectNotes("1920:69");
    press("Backspace");
    expect(notes(h)).not.toContain("1920:69:480");
    expect(pressedKeys()).toEqual([]);
  });

  it("삭제를 되돌리면 음은 돌아오고 선택은 비어 있다(되돌리기 한 번)", () => {
    const h = renderRoll();
    const before = h.studio().song;
    selectNotes("0:60");
    press("Delete");
    act(() => h.studio().undo());
    expect(h.studio().song).toBe(before);
    expect(pressedKeys()).toEqual([]);
  });

  it("모달이 열린 동안 전역 Delete가 클립을 지우지 않는다", () => {
    const h = renderRoll();
    selectNotes("0:60");
    press("Delete");
    expect(h.studio().song.tracks[0].clips).toHaveLength(1);
  });
});

describe("Ctrl/Cmd+A", () => {
  it("선택이 없어도 클립의 모든 음을 선택한다", () => {
    renderRoll();
    expect(press("a", { ctrlKey: true })).toBe(false);
    expect(pressedKeys().sort()).toEqual(["0:60", "0:64", "1920:69", "960:60"]);
  });

  it("세기 막대에 포커스가 남아 있어도 Ctrl+A는 음 전체를 선택한다(브라우저 전체 선택으로 새지 않는다). Delete는 여전히 무시한다", () => {
    const h = renderRoll();
    const bar = screen
      .getByTestId("roll-velocity-bars")
      .querySelector<HTMLElement>('[role="slider"]')!;
    bar.focus();
    expect(press("a", { ctrlKey: true }, bar)).toBe(false);
    expect(pressedKeys()).toHaveLength(4);
    const before = h.studio().song;
    press("Delete", {}, bar);
    expect(h.studio().song).toBe(before);
  });

  it("입력 요소(격자 단위 라디오) 위의 Ctrl+A는 브라우저에 맡긴다", () => {
    renderRoll();
    const radio = screen.getByRole("radio", { name: "1/8" });
    expect(press("a", { ctrlKey: true }, radio)).toBe(true);
    expect(pressedKeys()).toHaveLength(0);
  });

  it("Cmd+A도 같다. 음이 없으면 처리하지 않는다", () => {
    renderRoll(songWithNotes({ trackId: PIANO, bars: 1, notes: [] }));
    expect(press("a", { metaKey: true })).toBe(true);
  });

  it("재생 중에도 선택은 된다(곡은 바꾸지 않는다)", async () => {
    const h = renderRoll();
    await startPlaying(h);
    const before = h.studio().song;
    press("a", { ctrlKey: true });
    expect(pressedKeys()).toHaveLength(4);
    expect(h.studio().song).toBe(before);
  });
});

describe("처리하지 않는 경우", () => {
  it("선택이 없으면 이동·길이·삭제를 처리하지 않는다(preventDefault 없음)", () => {
    const h = renderRoll();
    const before = h.studio().song;
    expect(press("ArrowRight")).toBe(true);
    expect(press("ArrowUp", { shiftKey: true })).toBe(true);
    expect(press("ArrowRight", { altKey: true })).toBe(true);
    expect(press("Delete")).toBe(true);
    expect(h.studio().song).toBe(before);
  });

  it("Ctrl/Cmd+방향키(브라우저 단축키)는 무시한다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    selectNotes("960:60");
    expect(press("ArrowRight", { ctrlKey: true })).toBe(true);
    expect(press("ArrowLeft", { metaKey: true })).toBe(true);
    expect(h.studio().song).toBe(before);
  });

  it("IME 조합 중이거나 이미 처리된 키는 무시한다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    selectNotes("960:60");
    press("ArrowRight", { isComposing: true });
    expect(h.studio().song).toBe(before);
    const handledEarlier = (e: KeyboardEvent) => e.preventDefault();
    scroll().addEventListener("keydown", handledEarlier);
    press("ArrowRight");
    scroll().removeEventListener("keydown", handledEarlier);
    expect(h.studio().song).toBe(before);
  });

  it("재생 중(편집 불가)에는 키로 곡을 바꾸지 않고 기본 동작(스크롤)도 막지 않는다", async () => {
    const h = renderRoll();
    selectNotes("960:60");
    await startPlaying(h);
    const before = h.studio().song;
    expect(press("ArrowRight")).toBe(true);
    expect(press("Delete")).toBe(true);
    expect(h.studio().song).toBe(before);
  });

  it("입력 요소(격자 단위 라디오)와 role=slider(세기 막대) 위에서는 무시한다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    selectNotes("960:60");
    // 라디오 위의 ←/→는 브라우저가 라디오 선택을 옮기는 키다.
    const radio = screen.getByRole("radio", { name: "1/8" });
    expect(press("ArrowRight", {}, radio)).toBe(true);
    expect(press("Delete", {}, radio)).toBe(true);
    const bar = screen
      .getByTestId("roll-velocity-bars")
      .querySelector<HTMLElement>('[role="slider"]')!;
    // 슬라이더의 ↑/↓는 세기 키 처리가 맡는다 — 음 이동이 아니다.
    press("ArrowRight", {}, bar);
    press("Delete", {}, bar);
    expect(notes(h)).toEqual([
      "0:60:240",
      "0:64:240",
      "960:60:240",
      "1920:69:480",
    ]);
    expect(h.studio().song).toBe(before);
  });

  it("헤더 버튼(돌아가기 등)에 포커스가 있을 때는 무시한다", () => {
    const h = renderRoll();
    const before = h.studio().song;
    selectNotes("960:60");
    const back = screen.getByRole("button", { name: /돌아가기/ });
    press("Delete", {}, back);
    press("ArrowRight", {}, back);
    expect(h.studio().song).toBe(before);
  });

  it("진행 중인 음 제스처(드래그) 동안에는 키 편집을 막는다", () => {
    const h = renderRoll();
    selectNotes("960:60");
    const grid = screen.getByTestId("roll-grid");
    firePointer(noteButton("960:60"), "pointerdown", { clientX: 5, clientY: 5 });
    expect(hasActiveGesture()).toBe(true);
    const before = h.studio().song;
    press("ArrowRight");
    press("Delete");
    expect(h.studio().song).toBe(before);
    firePointer(grid, "pointerup", { clientX: 5, clientY: 5 });
  });
});

describe("포커스가 사라진 뒤", () => {
  it("포커스가 body에 있어도(음을 끌어 옮긴 뒤) 키 편집이 동작한다", () => {
    const h = renderRoll();
    selectNotes("960:60");
    (document.activeElement as HTMLElement | null)?.blur();
    expect(press("ArrowRight", {}, document.body)).toBe(false);
    expect(notes(h)).toContain("1200:60:240");
  });

  it("키 편집 뒤 포커스는 격자 영역에 있다 — 연속 입력이 이어진다", () => {
    const h = renderRoll();
    selectNotes("960:60");
    noteButton("960:60").focus();
    press("ArrowRight", {}, noteButton("960:60"));
    expect(document.activeElement).toBe(scroll());
    press("ArrowRight", {}, document.activeElement!);
    expect(notes(h)).toContain("1440:60:240");
  });
});

describe("리스너 수명", () => {
  it("언마운트하면 리스너가 정리된다(닫힌 뒤 키가 곡을 바꾸지 않는다)", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const h = renderRoll();
    selectNotes("960:60");
    const keydownAdds = () =>
      addSpy.mock.calls.filter((c) => c[0] === "keydown").length;
    const keydownRemoves = () =>
      removeSpy.mock.calls.filter((c) => c[0] === "keydown").length;
    expect(keydownAdds()).toBeGreaterThan(0);
    const before = h.studio().song;
    h.unmount();
    // 마운트 때 건 keydown 리스너(모달 Esc·포커스 가두기·음 키·전역 단축키)가 모두 거둬진다
    expect(keydownRemoves()).toBe(keydownAdds());
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(h.studio().song).toBe(before);
  });
});
