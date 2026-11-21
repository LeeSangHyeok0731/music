import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOSAVE_KEY, serializeSong } from "@/lib/score/autosave";
import { buildDemoSong } from "@/lib/score/demo-song";
import type { Song } from "@/lib/score/model";
import { songWithPatterns } from "@/lib/score/testing/builders";
import type { PlayMode } from "@/state/testing/fake-deps";
import { StudioContext, useStudio } from "@/state/useStudio";

import { ChordLane } from "./ChordLane";
import { Studio } from "./Studio";
import { TrackLane } from "./TrackLane";
import {
  installAudioContextStub,
  renderWithStudio,
  startPlaying,
  type StudioHarness,
} from "./testing/harness";
import {
  LANE_LEFT,
  firePointer,
  installPointerCaptureStubs,
  stubLaneRect,
  xAt,
} from "./testing/pointer";
import { hasActiveGesture } from "./gestures";
import { useShortcuts } from "./useShortcuts";

let restoreAudio: () => void;
let restorePointer: () => void;

/**
 * jsdom은 `:focus-visible`을 믿을 만하게 계산하지 않는다. 테스트가 키보드 포커스(true)·마우스
 * 포커스(false)·선택자 미지원(`"throw"`)을 정한다. 기본은 키보드 포커스.
 */
let focusVisible: boolean | "throw" = true;

beforeEach(() => {
  focusVisible = true;
  const originalMatches = Element.prototype.matches;
  vi.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    if (selector === ":focus-visible") {
      if (focusVisible === "throw") throw new SyntaxError("unsupported");
      return focusVisible;
    }
    return originalMatches.call(this, selector);
  });
  restoreAudio = installAudioContextStub();
  restorePointer = installPointerCaptureStubs();
  // 재생 중에는 10Hz 위치 표본 타이머가 돈다. 가짜로 막아 act 밖 갱신을 없앤다.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanup();
  // 제스처 수가 새면(어느 종료 경로가 해제를 빼먹으면) 다음 테스트로 번진다.
  expect(hasActiveGesture()).toBe(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  restorePointer();
  restoreAudio();
});

const PIANO = "track-piano";
const DRUMS = "track-drums";

/** 8마디(데모 진행 4구간). 피아노 [0,1920) / [5760,7680), 드럼 [0,1920). 가운데가 비어 있다. */
function editorSong(): Song {
  return songWithPatterns({
    bars: 8,
    progression: buildDemoSong().progression,
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

function Keys() {
  useShortcuts();
  return null;
}

/** 키 이벤트의 기본 동작을 받아 줄 여러 종류의 요소. 단축키가 이들 위에서 가로채면 안 된다. */
function Extras() {
  return (
    <div>
      <input type="text" aria-label="텍스트" />
      <input type="number" aria-label="숫자" />
      <textarea aria-label="메모" />
      <div
        data-testid="editable"
        contentEditable
        suppressContentEditableWarning
      />
      <select aria-label="고르기">
        <option>a</option>
      </select>
      <input type="range" aria-label="슬라이더" />
      <input type="checkbox" aria-label="체크" />
      <input type="radio" aria-label="라디오" />
      <input type="button" value="입력 버튼" />
      <button type="button">버튼</button>
      <a href="#x">링크</a>
      <details>
        <summary>요약</summary>
      </details>
      <div role="button" tabIndex={0} data-testid="role-button">
        역할 버튼
      </div>
      <div role="separator" tabIndex={0} data-testid="role-separator" />
      <div role="dialog" aria-label="임시 대화상자">
        <span data-testid="in-dialog">안</span>
      </div>
    </div>
  );
}

function KeysGate() {
  const [on, setOn] = useState(true);
  return (
    <>
      <button type="button" data-testid="gate" onClick={() => setOn(false)} />
      {on && <Keys />}
    </>
  );
}

interface EditorOptions {
  /** `useShortcuts`를 레인보다 먼저(true) 또는 나중에(false) 마운트한다. */
  keysFirst?: boolean;
  /** 기본 "manual": play()가 끝나지 않고 대기 중으로 남아 act 밖 갱신이 없다. */
  playMode?: PlayMode;
}

function renderEditor({
  keysFirst = false,
  playMode = "manual",
}: EditorOptions = {}): StudioHarness {
  const h = renderWithStudio(
    <>
      {keysFirst && <Keys />}
      <ChordLane />
      <TrackLane trackId={PIANO} />
      <TrackLane trackId={DRUMS} />
      {!keysFirst && <Keys />}
      <Extras />
    </>,
    {
      stored: { [AUTOSAVE_KEY]: serializeSong(editorSong()) },
      playMode,
    },
  );
  stubLaneRect(screen.getByTestId("chord-lane"), {
    left: LANE_LEFT,
    width: 1280,
    height: 40,
  });
  for (const id of [PIANO, DRUMS]) {
    stubLaneRect(screen.getByTestId(`track-lane-${id}`), {
      left: LANE_LEFT,
      width: 1280,
      height: 56,
    });
  }
  return h;
}

function press(
  target: Element | Document,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key,
    code: key === " " ? "Space" : key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(target, ev);
  return ev;
}
const space = (target: Element | Document = document.body, init = {}) =>
  press(target, " ", init);
const esc = (target: Element | Document = document.body, init = {}) =>
  press(target, "Escape", init);
const del = (target: Element | Document = document.body, init = {}) =>
  press(target, "Delete", init);
const backspace = (target: Element | Document = document.body, init = {}) =>
  press(target, "Backspace", init);
const ctrlZ = (target: Element | Document = document.body, init = {}) =>
  press(target, "z", { ctrlKey: true, ...init });

function tile(id: string) {
  return screen.getByTestId(`clip-${id}`);
}
function body(id: string): HTMLElement {
  return tile(id).querySelector("button[aria-pressed]") as HTMLElement;
}
function clipIds(h: StudioHarness, trackId = PIANO) {
  return h
    .studio()
    .song.tracks.find((t) => t.id === trackId)!
    .clips.map((c) => c.id);
}
function selectClip(h: StudioHarness, clipId: string, trackId = PIANO) {
  act(() => h.studio().select({ trackId, clipId }));
}
function selected(h: StudioHarness) {
  return h.studio().selection;
}
function pointerClick(el: Element, x: number) {
  firePointer(el, "pointerdown", { clientX: x });
  firePointer(el, "pointerup", { clientX: x });
}
function patternDialog() {
  return screen.getByRole("dialog", { name: "패턴 선택" });
}
function chordDialog() {
  return screen.getByRole("dialog", { name: "코드 선택" });
}
/** clip-1 본문을 5px 넘게 끌어 드래그를 시작한다(놓지 않는다). */
function startClipDrag(): Element {
  const x = xAt(100);
  firePointer(body("clip-1"), "pointerdown", { clientX: x });
  firePointer(body("clip-1"), "pointermove", { clientX: x + 100 });
  return body("clip-1");
}
/** clip-1의 길이 핸들을 끌어 길이 드래그를 시작한다(놓지 않는다). */
function startResizeDrag(): Element {
  const handle = within(tile("clip-1")).getByRole("separator", {
    name: "클립 길이 조절",
  });
  firePointer(handle, "pointerdown", { clientX: xAt(1920) });
  firePointer(handle, "pointermove", { clientX: xAt(1920) + 100 });
  return handle;
}
/** 코드 경계 1을 끌어 드래그를 시작한다(놓지 않는다). */
function startBoundaryDrag(): Element {
  const handle = screen.getByRole("separator", { name: "코드 경계 1" });
  firePointer(handle, "pointerdown", { clientX: xAt(3840) });
  firePointer(handle, "pointermove", { clientX: xAt(5760) });
  return handle;
}
function chordWidths() {
  return within(screen.getByTestId("chord-lane"))
    .getAllByRole("button")
    .map((b) => b.style.width);
}

/** 포커스가 어떻게 왔든 Space를 네이티브에 맡기는 대상. */
const NATIVE_TARGETS: Array<[string, () => Element]> = [
  ["a", () => screen.getByRole("link", { name: "링크" })],
  ["summary", () => screen.getByText("요약")],
  ["select", () => screen.getByRole("combobox", { name: "고르기" })],
  ["textarea", () => screen.getByRole("textbox", { name: "메모" })],
  ["input[text]", () => screen.getByRole("textbox", { name: "텍스트" })],
  ["input[number]", () => screen.getByRole("spinbutton", { name: "숫자" })],
  ["input[checkbox]", () => screen.getByRole("checkbox", { name: "체크" })],
  ["input[radio]", () => screen.getByRole("radio", { name: "라디오" })],
  ["[contenteditable]", () => screen.getByTestId("editable")],
  ["[role=dialog] 자신", () => screen.getByRole("dialog")],
  ["[role=dialog] 안의 요소", () => screen.getByTestId("in-dialog")],
];

/** 키보드로 포커스됐을 때만 Space를 네이티브에 맡기는 버튼 계열(마우스 포커스면 Space가 재생한다). */
const BUTTON_TARGETS: Array<[string, () => Element]> = [
  ["button", () => screen.getByRole("button", { name: "버튼" })],
  [
    "input[type=button]",
    () => screen.getByRole("button", { name: "입력 버튼" }),
  ],
  ["[role=button]", () => screen.getByTestId("role-button")],
  ["[role=separator]", () => screen.getByTestId("role-separator")],
  ["클립 본문 버튼", () => body("clip-1")],
  [
    "클립 길이 핸들",
    () =>
      within(tile("clip-1")).getByRole("separator", { name: "클립 길이 조절" }),
  ],
  [
    "코드 경계 핸들",
    () => screen.getByRole("separator", { name: "코드 경계 1" }),
  ],
  [
    "코드 구간 버튼",
    () => within(screen.getByTestId("chord-lane")).getAllByRole("button")[0],
  ],
];

describe("Space — 재생/정지 토글", () => {
  it("재생 → 대기 중 Space는 정지(play를 다시 부르지 않는다) → 다시 Space로 재생 → 재생 중 → 정지", async () => {
    const h = renderEditor({ playMode: "manual" });
    const play = h.fake.engine.play;

    expect(space().defaultPrevented).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(h.studio().pending).toBe(true);

    // 대기 중 Space는 정지한다(받기가 끝나지 않을 때의 탈출구). play를 다시 부르지 않는다.
    expect(space().defaultPrevented).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(h.fake.engine.stop).toHaveBeenCalledTimes(1);
    expect(h.studio().pending).toBe(false);
    expect(h.studio().editable).toBe(true);

    // 그 옛 play()가 뒤늦게 끝나도 화면은 정지 상태로 남는다.
    await act(async () => {
      h.fake.resolvePlay({ status: "playing" });
    });
    expect(h.studio().playing).toBe(false);

    // 정지 뒤 Space는 새로 재생한다(대기). 이번 결과는 반영된다.
    space();
    expect(play).toHaveBeenCalledTimes(2);
    expect(h.studio().pending).toBe(true);
    await act(async () => {
      h.fake.resolvePlay({ status: "playing" });
    });
    expect(h.studio().playing).toBe(true);
    expect(h.studio().editable).toBe(false);

    // 편집 불가(재생 중)에서도 Space는 정지한다.
    expect(space().defaultPrevented).toBe(true);
    expect(h.fake.engine.stop).toHaveBeenCalledTimes(2);
    expect(h.studio().playing).toBe(false);
    expect(h.studio().editable).toBe(true);

    // 정지 뒤에는 다시 재생된다.
    space();
    expect(play).toHaveBeenCalledTimes(3);
  });

  it("body에 포커스가 있을 때 동작한다(target이 body)", () => {
    const h = renderEditor();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    space(document.body);
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
  });

  it("누르고 있어 반복되는 keydown(event.repeat)은 무시한다", () => {
    const h = renderEditor();
    const ev = space(document.body, { repeat: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(h.fake.engine.play).not.toHaveBeenCalled();
    expect(h.studio().pending).toBe(false);
  });

  it("IME 조합 중(isComposing)이면 무시한다", () => {
    const h = renderEditor();
    const ev = space(document.body, { isComposing: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(h.fake.engine.play).not.toHaveBeenCalled();
  });

  it.each(NATIVE_TARGETS)(
    "%s 위에서는 포커스 방식과 무관하게 처리하지 않는다(네이티브 동작에 맡긴다)",
    (_name, getTarget) => {
      focusVisible = false;
      const h = renderEditor();
      const ev = space(getTarget());
      expect(ev.defaultPrevented).toBe(false);
      expect(h.fake.engine.play).not.toHaveBeenCalled();
      expect(h.studio().pending).toBe(false);
    },
  );

  it("정지 중이 아니어도(재생 중) 입력 요소 위에서는 정지하지 않는다", async () => {
    const h = renderEditor({ playMode: { status: "playing" } });
    await startPlaying(h);
    expect(h.studio().playing).toBe(true);
    const ev = space(screen.getByRole("textbox", { name: "텍스트" }));
    expect(ev.defaultPrevented).toBe(false);
    expect(h.fake.engine.stop).not.toHaveBeenCalled();
    expect(h.studio().playing).toBe(true);
  });

  it.each(BUTTON_TARGETS)(
    "키보드로 포커스된(:focus-visible) %s 위에서는 처리하지 않는다(네이티브 Space·Enter 유지)",
    (_name, getTarget) => {
      focusVisible = true;
      const h = renderEditor();
      const ev = space(getTarget());
      expect(ev.defaultPrevented).toBe(false);
      expect(h.fake.engine.play).not.toHaveBeenCalled();
      expect(h.studio().pending).toBe(false);
    },
  );

  it.each(BUTTON_TARGETS)(
    "마우스로 포커스된(:focus-visible 아님) %s 위에서는 Space가 재생한다",
    (_name, getTarget) => {
      focusVisible = false;
      const h = renderEditor();
      const ev = space(getTarget());
      expect(ev.defaultPrevented).toBe(true);
      expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
      expect(h.studio().pending).toBe(true);
    },
  );

  it("클립을 마우스로 만진 뒤(팝오버를 Esc로 닫아 포커스가 클립 버튼으로 돌아온 상태)에도 Space가 재생·정지한다", async () => {
    const h = renderEditor();
    pointerClick(body("clip-1"), xAt(100));
    esc();
    expect(document.activeElement).toBe(body("clip-1"));
    focusVisible = false;

    expect(space(body("clip-1")).defaultPrevented).toBe(true);
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
    await act(async () => {
      h.fake.resolvePlay({ status: "playing" });
    });
    expect(h.studio().playing).toBe(true);
    expect(space(body("clip-1")).defaultPrevented).toBe(true);
    expect(h.fake.engine.stop).toHaveBeenCalledTimes(1);
    // 클립은 팝오버를 다시 열지 않았다(Space가 클릭으로 새지 않는다).
    expect(screen.queryByRole("dialog", { name: "패턴 선택" })).toBeNull();
  });

  it("range 슬라이더에 포커스가 있어도 Space가 재생한다(키보드 포커스여도)", () => {
    focusVisible = true;
    const h = renderEditor();
    const ev = space(screen.getByRole("slider", { name: "슬라이더" }));
    expect(ev.defaultPrevented).toBe(true);
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
  });

  it(":focus-visible를 모르는 환경(matches가 던짐)이면 키보드 포커스로 보고 버튼 위 Space를 넘긴다", () => {
    focusVisible = "throw";
    const h = renderEditor();
    for (const [, get] of BUTTON_TARGETS) {
      expect(space(get()).defaultPrevented).toBe(false);
    }
    expect(h.fake.engine.play).not.toHaveBeenCalled();
    // range는 선택자를 묻지 않으므로 여전히 재생한다.
    space(screen.getByRole("slider", { name: "슬라이더" }));
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
  });

  it("대기 중 Space는 삼키되 단축키 자신이 play()를 다시 부르지 않는다", () => {
    const play = vi.fn(() => Promise.resolve());
    function PendingOverride({ children }: { children: ReactNode }) {
      const api = useStudio();
      return (
        <StudioContext.Provider
          value={{
            ...api,
            playing: false,
            pending: true,
            editable: false,
            play,
          }}
        >
          {children}
        </StudioContext.Provider>
      );
    }
    renderWithStudio(
      <PendingOverride>
        <Keys />
      </PendingOverride>,
    );
    expect(space().defaultPrevented).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });

  it("처리한 Space의 keyup은 막고(버튼이 keyup에 클릭되지 않게), 처리 안 한 Space의 keyup은 두며, 반복 keydown은 표시를 지우지 않는다", () => {
    renderEditor();
    const up = (target: Element | Document = document.body) => {
      const ev = new KeyboardEvent("keyup", {
        key: " ",
        code: "Space",
        bubbles: true,
        cancelable: true,
      });
      fireEvent(target, ev);
      return ev;
    };
    // 처리 안 함(텍스트 입력) → keyup도 그대로.
    const input = screen.getByRole("textbox", { name: "텍스트" });
    space(input);
    expect(up(input).defaultPrevented).toBe(false);

    // 처리함(+ 반복 keydown) → keyup 막음, 한 번만.
    space();
    space(document.body, { repeat: true });
    expect(up().defaultPrevented).toBe(true);
    expect(up().defaultPrevented).toBe(false);
  });

  it("열린 패턴 팝오버·코드 팝오버 안에서는 (마우스 포커스여도) 처리하지 않는다", () => {
    focusVisible = false;
    const h = renderEditor();
    pointerClick(body("clip-1"), xAt(100));
    expect(space(patternDialog()).defaultPrevented).toBe(false);
    expect(
      space(within(patternDialog()).getAllByRole("button")[0]).defaultPrevented,
    ).toBe(false);
    esc();
    fireEvent.click(
      within(screen.getByTestId("chord-lane")).getAllByRole("button")[0],
    );
    expect(space(chordDialog()).defaultPrevented).toBe(false);
    expect(h.fake.engine.play).not.toHaveBeenCalled();
  });

  it("Studio: 키보드 포커스된 재생 버튼·메트로놈 체크박스 위에서는 처리하지 않고, 템포 슬라이더에서는 재생한다", () => {
    const h = renderWithStudio(<Studio />, { playMode: "manual" });
    for (const t of [
      screen.getByRole("button", { name: "재생" }),
      screen.getByRole("checkbox", { name: "메트로놈" }),
    ]) {
      t.focus();
      expect(space(t).defaultPrevented).toBe(false);
    }
    expect(h.fake.engine.play).not.toHaveBeenCalled();

    const slider = screen.getByRole("slider", { name: "템포" });
    slider.focus();
    expect(space(slider).defaultPrevented).toBe(true);
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
  });

  it("Studio: 마우스로 포커스된 재생 버튼 위의 Space도 재생한다", () => {
    focusVisible = false;
    const h = renderWithStudio(<Studio />, { playMode: "manual" });
    const button = screen.getByRole("button", { name: "재생" });
    button.focus();
    expect(space(button).defaultPrevented).toBe(true);
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
  });

  it("Studio에서 body의 Space는 play를 정확히 한 번 부른다(단축키가 한 번만 걸려 있다)", () => {
    const h = renderWithStudio(<Studio />, { playMode: "manual" });
    space();
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
  });

  it("Ctrl/Meta/Alt가 눌려 있으면 무시하고 Shift는 허용한다", () => {
    const h = renderEditor();
    for (const mod of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
    ]) {
      expect(space(document.body, mod).defaultPrevented).toBe(false);
    }
    expect(h.fake.engine.play).not.toHaveBeenCalled();
    expect(space(document.body, { shiftKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
  });
});

describe("Ctrl+Z / Cmd+Z — 실행취소", () => {
  function editOnce(h: StudioHarness) {
    act(() => h.studio().edit.setBars(9));
    expect(h.studio().song.bars).toBe(9);
    expect(h.studio().canUndo).toBe(true);
  }

  it("Ctrl+Z가 되돌린다(기본 동작 막음)", () => {
    const h = renderEditor();
    editOnce(h);
    expect(ctrlZ().defaultPrevented).toBe(true);
    expect(h.studio().song.bars).toBe(8);
    expect(h.studio().canUndo).toBe(false);
  });

  it("Cmd+Z도 되돌린다", () => {
    const h = renderEditor();
    editOnce(h);
    expect(press(document.body, "z", { metaKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(h.studio().song.bars).toBe(8);
  });

  it("CapsLock 등으로 key가 대문자 Z여도(Shift 없음) 되돌린다", () => {
    const h = renderEditor();
    editOnce(h);
    press(document.body, "Z", { ctrlKey: true });
    expect(h.studio().song.bars).toBe(8);
  });

  it("되돌릴 것이 없으면 아무 일도 없고 기본 동작도 막지 않는다", () => {
    const h = renderEditor();
    const before = h.studio().song;
    expect(ctrlZ().defaultPrevented).toBe(false);
    expect(h.studio().song).toBe(before);
  });

  it("재생 대기 중·재생 중에는 되돌리지 않는다", async () => {
    const h = renderEditor({ playMode: "manual" });
    editOnce(h);
    await startPlaying(h);
    expect(h.studio().pending).toBe(true);
    expect(ctrlZ().defaultPrevented).toBe(false);
    expect(h.studio().song.bars).toBe(9);

    await act(async () => {
      h.fake.resolvePlay({ status: "playing" });
    });
    expect(h.studio().playing).toBe(true);
    expect(ctrlZ().defaultPrevented).toBe(false);
    expect(h.studio().song.bars).toBe(9);
    expect(h.studio().canUndo).toBe(true);
  });

  it.each([
    ["input[text]", () => screen.getByRole("textbox", { name: "텍스트" })],
    ["input[number]", () => screen.getByRole("spinbutton", { name: "숫자" })],
    ["textarea", () => screen.getByRole("textbox", { name: "메모" })],
    ["[contenteditable]", () => screen.getByTestId("editable")],
  ])("%s 위에서는 처리하지 않는다(네이티브 텍스트 되돌리기)", (_n, get) => {
    const h = renderEditor();
    editOnce(h);
    expect(ctrlZ(get()).defaultPrevented).toBe(false);
    expect(h.studio().song.bars).toBe(9);
  });

  it.each([
    ["input[range]", () => screen.getByRole("slider", { name: "슬라이더" })],
    ["input[checkbox]", () => screen.getByRole("checkbox", { name: "체크" })],
    ["button", () => screen.getByRole("button", { name: "버튼" })],
    ["body", () => document.body],
  ])("%s에 포커스가 있어도 되돌린다", (_n, get) => {
    const h = renderEditor();
    editOnce(h);
    expect(ctrlZ(get()).defaultPrevented).toBe(true);
    expect(h.studio().song.bars).toBe(8);
  });

  it("Studio의 템포 슬라이더·메트로놈 체크박스에 포커스가 있어도 되돌린다", () => {
    const h = renderWithStudio(<Studio />);
    act(() => h.studio().edit.setBars(9));
    const slider = screen.getByRole("slider", { name: "템포" });
    slider.focus();
    ctrlZ(slider);
    expect(h.studio().song.bars).toBe(8);

    act(() => h.studio().edit.setBars(9));
    const check = screen.getByRole("checkbox", { name: "메트로놈" });
    check.focus();
    ctrlZ(check);
    expect(h.studio().song.bars).toBe(8);
  });

  it("열린 팝오버 안에서도 되돌린다(팝오버가 새 상태를 보여 준다)", () => {
    const h = renderEditor();
    pointerClick(body("clip-1"), xAt(100));
    const item = within(patternDialog()).getByRole("button", {
      name: "8분 아르페지오",
    });
    fireEvent.click(item);
    expect(h.studio().canUndo).toBe(true);
    expect(ctrlZ(item).defaultPrevented).toBe(true);
    expect(h.studio().canUndo).toBe(false);
    expect(patternDialog()).toBeTruthy();
  });

  it("Shift·Alt가 같이 눌린 Z와 Ctrl+Y는 처리하지 않는다(다시실행 없음)", () => {
    const h = renderEditor();
    editOnce(h);
    expect(ctrlZ(document.body, { shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(ctrlZ(document.body, { altKey: true }).defaultPrevented).toBe(false);
    expect(press(document.body, "y", { ctrlKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(h.studio().song.bars).toBe(9);
  });

  it("modifier 없는 z는 처리하지 않는다", () => {
    const h = renderEditor();
    editOnce(h);
    expect(press(document.body, "z").defaultPrevented).toBe(false);
    expect(h.studio().song.bars).toBe(9);
  });

  it("한글 IME 등 비라틴 배열(key가 z가 아님)에서도 물리 키 KeyZ로 되돌린다", () => {
    const h = renderEditor();
    editOnce(h);
    const ev = press(document.body, "ㅋ", { ctrlKey: true, code: "KeyZ" });
    expect(ev.defaultPrevented).toBe(true);
    expect(h.studio().song.bars).toBe(8);
  });

  it("key가 ASCII면 물리 키 KeyZ를 z로 보지 않는다(Dvorak의 Ctrl+;)", () => {
    const h = renderEditor();
    editOnce(h);
    const ev = press(document.body, ";", { ctrlKey: true, code: "KeyZ" });
    expect(ev.defaultPrevented).toBe(false);
    expect(h.studio().song.bars).toBe(9);
  });

  it("key가 문자열이 아닌 합성 이벤트(자동완성 등)는 던지지 않고 무시한다", () => {
    const h = renderEditor();
    editOnce(h);
    const ev = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    Object.defineProperty(ev, "key", { value: undefined });
    // 리스너가 던져도 dispatchEvent는 던지지 않고 window "error" 이벤트로 알린다.
    const onError = vi.fn((e: ErrorEvent) => e.preventDefault());
    window.addEventListener("error", onError);
    try {
      fireEvent(document.body, ev);
    } finally {
      window.removeEventListener("error", onError);
    }
    expect(onError).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    expect(h.studio().song.bars).toBe(9);
  });

  it("이미 처리된(defaultPrevented) Space·Delete·Ctrl+Z에는 아무것도 하지 않는다", () => {
    const h = renderEditor();
    editOnce(h);
    selectClip(h, "clip-1");
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", claim, true);
    try {
      space();
      del();
      backspace();
      ctrlZ();
    } finally {
      window.removeEventListener("keydown", claim, true);
    }
    expect(h.fake.engine.play).not.toHaveBeenCalled();
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);
    expect(h.studio().song.bars).toBe(9);
  });

  it("IME 조합 중에는 무시한다", () => {
    const h = renderEditor();
    editOnce(h);
    expect(ctrlZ(document.body, { isComposing: true }).defaultPrevented).toBe(
      false,
    );
    expect(h.studio().song.bars).toBe(9);
  });
});

describe("Delete / Backspace — 선택한 클립 삭제", () => {
  it.each([
    ["Delete", del],
    ["Backspace", backspace],
  ])("%s가 선택한 클립을 지우고(기록 한 번) 선택을 푼다", (_n, key) => {
    const h = renderEditor();
    selectClip(h, "clip-1");
    expect(h.studio().canUndo).toBe(false);

    expect(key().defaultPrevented).toBe(true);
    expect(clipIds(h)).toEqual(["clip-2"]);
    expect(selected(h)).toBeNull();
    expect(h.studio().canUndo).toBe(true);
    // 다른 트랙은 그대로.
    expect(clipIds(h, DRUMS)).toEqual(["drum-1"]);

    // 기록이 한 번만 쌓였다: 한 번 되돌리면 처음 상태다.
    ctrlZ();
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);
    expect(h.studio().canUndo).toBe(false);
  });

  it("다른 트랙의 선택도 그 트랙의 클립을 지운다", () => {
    const h = renderEditor();
    selectClip(h, "drum-1", DRUMS);
    del();
    expect(clipIds(h, DRUMS)).toEqual([]);
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);
  });

  it("선택이 없으면 아무 일도 없다(기본 동작도 막지 않는다)", () => {
    const h = renderEditor();
    expect(del().defaultPrevented).toBe(false);
    expect(backspace().defaultPrevented).toBe(false);
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);
    expect(h.studio().canUndo).toBe(false);
  });

  it("재생 대기 중·재생 중(편집 불가)에는 지우지 않는다", async () => {
    const h = renderEditor({ playMode: "manual" });
    selectClip(h, "clip-1");
    await startPlaying(h);
    expect(h.studio().pending).toBe(true);
    // 편집 불가에서는 처리하지 않는다(기본 동작도 막지 않는다).
    expect(del().defaultPrevented).toBe(false);
    expect(backspace().defaultPrevented).toBe(false);
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);

    await act(async () => {
      h.fake.resolvePlay({ status: "playing" });
    });
    expect(del().defaultPrevented).toBe(false);
    expect(backspace().defaultPrevented).toBe(false);
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);
    expect(h.studio().canUndo).toBe(false);
  });

  it("열린 패턴 팝오버 안(대화상자)에서는 지우지 않는다", () => {
    const h = renderEditor();
    pointerClick(body("clip-1"), xAt(100));
    expect(selected(h)).toEqual({ trackId: PIANO, clipId: "clip-1" });
    const item = within(patternDialog()).getAllByRole("button")[0];
    expect(del(item).defaultPrevented).toBe(false);
    expect(backspace(patternDialog()).defaultPrevented).toBe(false);
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);
  });

  it.each([
    ["input[text]", () => screen.getByRole("textbox", { name: "텍스트" })],
    ["input[number]", () => screen.getByRole("spinbutton", { name: "숫자" })],
    ["textarea", () => screen.getByRole("textbox", { name: "메모" })],
    ["select", () => screen.getByRole("combobox", { name: "고르기" })],
    ["[contenteditable]", () => screen.getByTestId("editable")],
    ["[role=dialog] 안", () => screen.getByTestId("in-dialog")],
  ])("%s 위에서는 지우지 않는다", (_n, get) => {
    const h = renderEditor();
    selectClip(h, "clip-1");
    expect(del(get()).defaultPrevented).toBe(false);
    expect(backspace(get()).defaultPrevented).toBe(false);
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);
    expect(selected(h)).not.toBeNull();
  });

  it("클립 본문 버튼·삭제 버튼·슬라이더에 포커스가 있어도 지운다", () => {
    const h = renderEditor();
    selectClip(h, "clip-1");
    del(body("clip-1"));
    expect(clipIds(h)).toEqual(["clip-2"]);

    selectClip(h, "clip-2");
    backspace(screen.getByRole("slider", { name: "슬라이더" }));
    expect(clipIds(h)).toEqual([]);
  });

  it("Ctrl/Meta/Alt가 눌려 있으면 무시하고 Shift는 허용한다", () => {
    const h = renderEditor();
    selectClip(h, "clip-1");
    for (const mod of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
    ]) {
      expect(del(document.body, mod).defaultPrevented).toBe(false);
      expect(backspace(document.body, mod).defaultPrevented).toBe(false);
    }
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);
    del(document.body, { shiftKey: true });
    expect(clipIds(h)).toEqual(["clip-2"]);
  });

  it("IME 조합 중에는 무시한다", () => {
    const h = renderEditor();
    selectClip(h, "clip-1");
    expect(del(document.body, { isComposing: true }).defaultPrevented).toBe(
      false,
    );
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);
  });
});

describe("Esc — 한 번에 한 겹만 닫는다(드래그 → 팝오버 → 선택)", () => {
  // 마운트 순서를 바꿔 돌리지만 증명하는 것은 "캡처 단계(드래그·팝오버)가 버블 단계(useShortcuts)보다
  // 항상 먼저 돈다"는 분리다 — 순서가 달라도 결과가 같아야 하는 구조다.
  describe.each([
    ["캡처·버블 분리: useShortcuts(버블)가 레인보다 먼저 마운트", true],
    ["캡처·버블 분리: useShortcuts(버블)가 레인보다 나중에 마운트", false],
  ])("%s", (_label, keysFirst) => {
    it("(1) 클립 드래그 중 Esc는 드래그만 취소한다", () => {
      const h = renderEditor({ keysFirst });
      startClipDrag();
      expect(tile("clip-1").style.left).not.toBe("0px");
      expect(selected(h)).toEqual({ trackId: PIANO, clipId: "clip-1" });

      const ev = esc();
      expect(ev.defaultPrevented).toBe(true);
      // 드래그만 취소: 위치 복귀, 선택은 그대로, 팝오버 없음, 커밋 없음.
      expect(tile("clip-1").style.left).toBe("0px");
      expect(selected(h)).toEqual({ trackId: PIANO, clipId: "clip-1" });
      expect(screen.queryByRole("dialog", { name: "패턴 선택" })).toBeNull();
      expect(h.studio().canUndo).toBe(false);

      // 다음 Esc가 선택을 푼다.
      esc();
      expect(selected(h)).toBeNull();
    });

    it("(1b) 길이 드래그 중 Esc도 드래그만 취소한다", () => {
      const h = renderEditor({ keysFirst });
      selectClip(h, "clip-1");
      const handle = within(tile("clip-1")).getByRole("separator", {
        name: "클립 길이 조절",
      });
      const x = xAt(1920);
      firePointer(handle, "pointerdown", { clientX: x });
      firePointer(handle, "pointermove", { clientX: x + 100 });
      expect(tile("clip-1").style.width).not.toBe("160px");

      esc();
      expect(tile("clip-1").style.width).toBe("160px");
      expect(selected(h)).toEqual({ trackId: PIANO, clipId: "clip-1" });
      esc();
      expect(selected(h)).toBeNull();
    });

    it("(2) 패턴 팝오버가 열려 있으면 Esc는 팝오버만 닫는다", () => {
      const h = renderEditor({ keysFirst });
      pointerClick(body("clip-1"), xAt(100));
      expect(patternDialog()).toBeTruthy();
      expect(selected(h)).toEqual({ trackId: PIANO, clipId: "clip-1" });

      expect(esc().defaultPrevented).toBe(true);
      expect(screen.queryByRole("dialog", { name: "패턴 선택" })).toBeNull();
      expect(selected(h)).toEqual({ trackId: PIANO, clipId: "clip-1" });
      expect(document.activeElement).toBe(body("clip-1"));

      esc();
      expect(selected(h)).toBeNull();
    });

    it("(3) 선택만 있으면 Esc가 선택을 푼다", () => {
      const h = renderEditor({ keysFirst });
      selectClip(h, "clip-2");
      esc();
      expect(selected(h)).toBeNull();
      // 선택이 없을 때의 Esc는 아무 일도 없다.
      esc();
      expect(selected(h)).toBeNull();
      expect(h.studio().canUndo).toBe(false);
    });

    it("(5a) 코드 경계 드래그 중 Esc는 드래그만 취소한다", () => {
      const h = renderEditor({ keysFirst });
      selectClip(h, "clip-1");
      startBoundaryDrag();
      expect(chordWidths()[0]).toBe("480px");

      expect(esc().defaultPrevented).toBe(true);
      expect(chordWidths()).toEqual(["320px", "320px", "320px", "320px"]);
      expect(selected(h)).toEqual({ trackId: PIANO, clipId: "clip-1" });
      expect(h.studio().canUndo).toBe(false);

      esc();
      expect(selected(h)).toBeNull();
    });

    it("(5b) 코드 팝오버가 열려 있으면 Esc는 팝오버만 닫는다", () => {
      const h = renderEditor({ keysFirst });
      selectClip(h, "clip-1");
      fireEvent.click(
        within(screen.getByTestId("chord-lane")).getAllByRole("button")[0],
      );
      expect(chordDialog()).toBeTruthy();

      expect(esc().defaultPrevented).toBe(true);
      expect(screen.queryByRole("dialog", { name: "코드 선택" })).toBeNull();
      expect(selected(h)).toEqual({ trackId: PIANO, clipId: "clip-1" });

      esc();
      expect(selected(h)).toBeNull();
    });

    it("(4) 포커스가 어디에 있든 한 번의 Esc는 한 겹만 닫는다", () => {
      const h = renderEditor({ keysFirst });
      pointerClick(body("clip-1"), xAt(100));
      // 팝오버 안의 버튼에 포커스가 있을 때 누른다.
      const item = within(patternDialog()).getAllByRole("button")[0];
      item.focus();
      esc(item);
      expect(screen.queryByRole("dialog", { name: "패턴 선택" })).toBeNull();
      expect(selected(h)).not.toBeNull();
      esc(document.activeElement ?? document.body);
      expect(selected(h)).toBeNull();
    });

    it("재생 중(편집 불가)에도 Esc는 선택을 풀 뿐 정지하지 않는다", async () => {
      const h = renderEditor({ keysFirst, playMode: { status: "playing" } });
      selectClip(h, "clip-1");
      await startPlaying(h);
      expect(h.studio().playing).toBe(true);
      esc();
      expect(selected(h)).toBeNull();
      expect(h.studio().playing).toBe(true);
      expect(h.fake.engine.stop).not.toHaveBeenCalled();
    });
  });

  it("다른 곳에서 이미 처리한 Esc(defaultPrevented)는 팝오버도 선택도 건드리지 않는다", () => {
    const h = renderEditor();
    pointerClick(body("clip-1"), xAt(100));
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", claim, true);
    try {
      esc();
    } finally {
      window.removeEventListener("keydown", claim, true);
    }
    expect(patternDialog()).toBeTruthy();
    expect(selected(h)).toEqual({ trackId: PIANO, clipId: "clip-1" });
  });

  it("이미 처리된 Esc는 진행 중인 드래그도 취소하지 않는다(클립·경계)", () => {
    const h = renderEditor();
    const claim = (e: Event) => e.preventDefault();

    startClipDrag();
    window.addEventListener("keydown", claim, true);
    try {
      esc();
    } finally {
      window.removeEventListener("keydown", claim, true);
    }
    expect(tile("clip-1").style.left).not.toBe("0px");
    expect(hasActiveGesture()).toBe(true);
    firePointer(body("clip-1"), "pointerup", { clientX: xAt(100) + 100 });
    expect(h.studio().song.tracks[0].clips[0].start).toBe(960);

    const handle = startBoundaryDrag();
    window.addEventListener("keydown", claim, true);
    try {
      esc();
    } finally {
      window.removeEventListener("keydown", claim, true);
    }
    expect(chordWidths()[0]).toBe("480px");
    firePointer(handle, "pointerup", { clientX: xAt(5760) });
    expect(h.studio().song.progression[1].start).toBe(5760);
  });

  it("IME 조합 중의 Esc는 선택을 풀지 않는다", () => {
    const h = renderEditor();
    selectClip(h, "clip-1");
    esc(document.body, { isComposing: true });
    expect(selected(h)).not.toBeNull();
  });

  it("드래그가 끝난 뒤의 Esc는 드래그를 다시 취소하지 않고 선택을 푼다", () => {
    const h = renderEditor();
    startClipDrag();
    firePointer(body("clip-1"), "pointerup", { clientX: xAt(100) + 100 });
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);
    expect(h.studio().canUndo).toBe(true);
    expect(esc().defaultPrevented).toBe(false);
    expect(selected(h)).toBeNull();
  });
});

describe("리스너 수명", () => {
  it("keydown 리스너는 document에 한 번만 걸리고 렌더가 반복돼도 다시 걸리지 않는다", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const h = renderEditor({ playMode: "manual" });
    const keydownAdds = () =>
      add.mock.calls.filter(([type]) => type === "keydown").length;
    const keydownRemoves = () =>
      remove.mock.calls.filter(([type]) => type === "keydown").length;
    expect(keydownAdds()).toBe(1);

    act(() => h.studio().edit.setBars(9));
    selectClip(h, "clip-1");
    await startPlaying(h);
    await act(async () => {
      h.fake.resolvePlay({ status: "playing" });
    });
    act(() => h.studio().stop());
    expect(keydownAdds()).toBe(1);
    expect(keydownRemoves()).toBe(0);
  });

  it("최신 값을 읽는다: 렌더 사이에 바뀐 선택·편집 가능 여부가 곧바로 반영된다", async () => {
    const h = renderEditor({ playMode: "manual" });
    // 선택 없음 → 삭제 무동작 → 선택 → 삭제 동작(같은 리스너).
    del();
    expect(clipIds(h)).toEqual(["clip-1", "clip-2"]);
    selectClip(h, "clip-2");
    del();
    expect(clipIds(h)).toEqual(["clip-1"]);
    // 재생 대기로 바뀐 직후의 삭제는 무시.
    selectClip(h, "clip-1");
    await startPlaying(h);
    del();
    expect(clipIds(h)).toEqual(["clip-1"]);
  });

  it("언마운트하면 리스너가 떼어져 이후의 키가 아무 일도 하지 않는다", () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const h = renderWithStudio(<KeysGate />, { playMode: "manual" });
    space();
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
    act(() => h.studio().stop());
    fireEvent.click(screen.getByTestId("gate"));
    expect(
      remove.mock.calls.filter(([type]) => type === "keydown"),
    ).toHaveLength(1);

    space();
    ctrlZ();
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
  });
});

describe("진행 중인 드래그 동안의 실행취소", () => {
  function withHistory(h: StudioHarness) {
    act(() => h.studio().edit.setBars(9));
    expect(h.studio().song.bars).toBe(9);
    expect(h.studio().canUndo).toBe(true);
  }
  const pianoClip = (h: StudioHarness) => h.studio().song.tracks[0].clips[0];

  it("클립 이동 드래그 중 Ctrl+Z는 되돌리지 않고, 놓으면 정상 커밋되며, 끝난 뒤에는 되돌린다", () => {
    const h = renderEditor();
    withHistory(h);
    startClipDrag();
    expect(hasActiveGesture()).toBe(true);

    expect(ctrlZ().defaultPrevented).toBe(false);
    expect(h.studio().song.bars).toBe(9);
    expect(h.studio().canUndo).toBe(true);

    firePointer(body("clip-1"), "pointerup", { clientX: xAt(100) + 100 });
    expect(hasActiveGesture()).toBe(false);
    expect(pianoClip(h).start).toBe(960);

    expect(ctrlZ().defaultPrevented).toBe(true);
    expect(pianoClip(h).start).toBe(0);
    expect(h.studio().song.bars).toBe(9);
  });

  it("길이 드래그 중 Ctrl+Z는 되돌리지 않고, 놓으면 정상 커밋된다", () => {
    const h = renderEditor();
    withHistory(h);
    const handle = startResizeDrag();
    expect(ctrlZ().defaultPrevented).toBe(false);
    expect(h.studio().song.bars).toBe(9);

    firePointer(handle, "pointerup", { clientX: xAt(1920) + 100 });
    expect(pianoClip(h).length).toBeGreaterThan(1920);
    expect(ctrlZ().defaultPrevented).toBe(true);
    expect(pianoClip(h).length).toBe(1920);
  });

  it("코드 경계 드래그 중 Ctrl+Z는 되돌리지 않고, 놓으면 정상 커밋된다", () => {
    const h = renderEditor();
    withHistory(h);
    const handle = startBoundaryDrag();
    expect(ctrlZ().defaultPrevented).toBe(false);
    expect(h.studio().song.bars).toBe(9);

    firePointer(handle, "pointerup", { clientX: xAt(5760) });
    expect(h.studio().song.progression[1].start).toBe(5760);
    expect(ctrlZ().defaultPrevented).toBe(true);
    expect(h.studio().song.progression[1].start).toBe(3840);
  });

  it("누르고만 있는(임계값 전) 제스처도 센다: 놓으면(클릭) 풀린다", () => {
    const h = renderEditor();
    withHistory(h);
    firePointer(body("clip-1"), "pointerdown", { clientX: xAt(100) });
    expect(hasActiveGesture()).toBe(true);
    expect(ctrlZ().defaultPrevented).toBe(false);
    firePointer(body("clip-1"), "pointerup", { clientX: xAt(100) });
    expect(hasActiveGesture()).toBe(false);
  });

  const STARTS: Array<[string, () => Element]> = [
    ["클립 이동", startClipDrag],
    ["클립 길이", startResizeDrag],
    ["코드 경계", startBoundaryDrag],
  ];
  const ENDS: Array<[string, (el: Element) => void]> = [
    ["pointerup", (el) => firePointer(el, "pointerup", { clientX: 0 })],
    ["pointercancel", (el) => firePointer(el, "pointercancel", { clientX: 0 })],
    [
      "lostpointercapture",
      (el) =>
        fireEvent(
          el,
          new PointerEvent("lostpointercapture", {
            bubbles: true,
            pointerId: 1,
          }),
        ),
    ],
    ["Esc", () => esc()],
  ];
  describe.each(STARTS)("%s 드래그", (_n, start) => {
    it.each(ENDS)("%s로 끝나면 제스처 수가 풀린다", (_e, end) => {
      renderEditor();
      const el = start();
      expect(hasActiveGesture()).toBe(true);
      end(el);
      expect(hasActiveGesture()).toBe(false);
    });

    it("편집 불가(재생 시작)가 되면 풀린다", async () => {
      const h = renderEditor();
      start();
      expect(hasActiveGesture()).toBe(true);
      await startPlaying(h);
      expect(h.studio().editable).toBe(false);
      expect(hasActiveGesture()).toBe(false);
    });

    it("드래그 중 언마운트하면 풀린다", () => {
      const h = renderEditor();
      start();
      expect(hasActiveGesture()).toBe(true);
      h.unmount();
      expect(hasActiveGesture()).toBe(false);
    });
  });
});
