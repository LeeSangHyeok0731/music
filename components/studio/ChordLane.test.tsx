import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildDemoSong } from "@/lib/score/demo-song";

import { ChordLane } from "./ChordLane";
import { Studio } from "./Studio";
import {
  installAudioContextStub,
  renderWithStudio,
  type StudioHarness,
} from "./testing/harness";
import {
  firePointer,
  installPointerCaptureStubs,
  stubLaneRect,
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

const ORIGINAL = buildDemoSong().progression;
const LANE_LEFT = 96;
/** 틱을 레인 왼쪽이 `LANE_LEFT`일 때의 화면 x로. 1px = 12틱. */
const xAt = (tick: number) => LANE_LEFT + tick / 12;

function lane() {
  return screen.getByTestId("chord-lane");
}
function seg(name: string) {
  return within(lane()).getByRole("button", { name });
}
function segments() {
  return within(lane()).getAllByRole("button");
}
function widths() {
  return segments().map((b) => b.style.width);
}
function handle(n: number) {
  return screen.getByRole("separator", { name: `코드 경계 ${n}` });
}
function dialog() {
  return screen.getByRole("dialog", { name: "코드 선택" });
}
function inDialog(name: string) {
  return within(dialog()).getByRole("button", { name });
}

function renderLane(options?: Parameters<typeof renderWithStudio>[1]) {
  const h = renderWithStudio(<ChordLane />, options);
  stubLaneRect(lane(), { left: LANE_LEFT, width: 1280, height: 40 });
  return h;
}

/** jsdom의 PointerEvent는 NaN clientX를 거부한다. 만든 뒤 값을 덮어써 비정상 입력을 흉내 낸다. */
function fireBadPointer(el: Element, type: string, clientX: number) {
  const ev = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
  });
  Object.defineProperty(ev, "clientX", { value: clientX });
  fireEvent(el, ev);
}

async function startPlaying(h: StudioHarness) {
  await act(async () => {
    void h.studio().play();
  });
}

describe("ChordLane 렌더", () => {
  it("데모 진행의 4구간을 chordLabel 이름과 clipRect 위치·폭으로 그린다", () => {
    renderLane();
    expect(segments().map((b) => b.textContent)).toEqual([
      "C",
      "Am",
      "F",
      "G7",
    ]);
    expect(segments().map((b) => b.style.left)).toEqual([
      "0px",
      "320px",
      "640px",
      "960px",
    ]);
    expect(widths()).toEqual(["320px", "320px", "320px", "320px"]);
  });

  it("레인은 높이·구분선을 유지하고 배경이 투명하다", () => {
    renderLane();
    expect(lane().style.height).toBe("40px");
    expect(lane().style.boxShadow).not.toBe("");
    expect(lane().style.background).toBe("");
    expect(lane().className).toContain("relative");
  });

  it("경계 핸들이 구간 수 - 1개이고 8px 폭 separator다", () => {
    renderLane();
    const handles = screen.getAllByRole("separator");
    expect(handles).toHaveLength(3);
    expect(handles.map((h) => h.getAttribute("aria-label"))).toEqual([
      "코드 경계 1",
      "코드 경계 2",
      "코드 경계 3",
    ]);
    expect(
      handles.every((h) => h.getAttribute("aria-orientation") === "vertical"),
    ).toBe(true);
    expect(handles.map((h) => h.style.left)).toEqual([
      "316px",
      "636px",
      "956px",
    ]);
    expect(handles.every((h) => h.style.width === "8px")).toBe(true);
  });

  it("편집 가능하면 aria-disabled가 없다", () => {
    renderLane();
    for (const el of [...segments(), ...screen.getAllByRole("separator")]) {
      expect(el.getAttribute("aria-disabled")).not.toBe("true");
    }
  });
});

describe("ChordLane 팝오버 열고 닫기", () => {
  it("구간을 누르면 근음 12개 + 종류 5개 버튼이 있는 대화상자가 열린다", () => {
    renderLane();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(seg("C"));
    const d = dialog();
    const names = within(d)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names.slice(0, 12)).toEqual([
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ]);
    expect(names.slice(12, 17)).toEqual([
      "메이저",
      "마이너",
      "도미넌트 7",
      "메이저 7",
      "마이너 7",
    ]);
    const quality = within(d).getAllByRole("button").slice(12, 17);
    expect(quality.map((b) => b.textContent)).toEqual([
      "maj",
      "m",
      "7",
      "maj7",
      "m7",
    ]);
    expect(names.slice(17)).toEqual(["가운데에서 나누기", "오른쪽과 합치기"]);
  });

  it("현재 근음·종류가 aria-pressed로 표시된다", () => {
    renderLane();
    fireEvent.click(seg("Am"));
    const pressed = within(dialog())
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(pressed).toEqual(["A", "마이너"]);
  });

  it("Esc로 닫히고 포커스가 구간 버튼으로 돌아온다", () => {
    renderLane();
    fireEvent.click(seg("F"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(seg("F"));
  });

  it("바깥을 누르면 닫힌다", () => {
    renderLane();
    fireEvent.click(seg("C"));
    firePointer(document.body, "pointerdown", { clientX: 5 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("팝오버 안을 누르면 닫히지 않는다", () => {
    renderLane();
    fireEvent.click(seg("C"));
    firePointer(dialog(), "pointerdown", { clientX: 5 });
    expect(dialog()).toBeTruthy();
  });

  it("같은 구간을 다시 누르면 닫힌다(토글)", () => {
    renderLane();
    fireEvent.click(seg("C"));
    firePointer(seg("C"), "pointerdown", { clientX: 5 });
    fireEvent.click(seg("C"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("다른 구간을 누르면 그 구간의 값으로 옮겨 열린다", () => {
    renderLane();
    fireEvent.click(seg("C"));
    firePointer(seg("G7"), "pointerdown", { clientX: 5 });
    fireEvent.click(seg("G7"));
    const pressed = within(dialog())
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(pressed).toEqual(["G", "도미넌트 7"]);
  });

  it("열리면 첫 컨트롤로 포커스가 간다", () => {
    renderLane();
    fireEvent.click(seg("C"));
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(inDialog("C"));
  });

  it("구간 버튼은 aria-expanded로 열림을 알린다", () => {
    renderLane();
    expect(seg("C").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(seg("C"));
    expect(seg("C").getAttribute("aria-expanded")).toBe("true");
  });

  it("팝오버는 레인 안이 아니라 document.body 직속으로 그려진다(잘리지 않게)", () => {
    renderLane();
    fireEvent.click(seg("C"));
    expect(dialog().parentElement).toBe(document.body);
    expect(lane().contains(dialog())).toBe(false);
    expect(dialog().style.position).toBe("fixed");
  });

  it("구간 버튼 아래에 놓이고 뷰포트 안으로 클램프된다", () => {
    renderLane();
    const rect = (left: number) =>
      ({
        left,
        right: left + 100,
        top: 60,
        bottom: 100,
        width: 100,
        height: 40,
      }) as DOMRect;

    seg("C").getBoundingClientRect = () => rect(200);
    fireEvent.click(seg("C"));
    expect(dialog().style.left).toBe("200px");
    expect(dialog().style.top).toBe("104px");
    fireEvent.keyDown(document, { key: "Escape" });

    seg("C").getBoundingClientRect = () => rect(5000);
    fireEvent.click(seg("C"));
    const w = Number.parseFloat(dialog().style.width);
    expect(Number.parseFloat(dialog().style.left)).toBe(
      window.innerWidth - w - 8,
    );
    fireEvent.keyDown(document, { key: "Escape" });

    seg("C").getBoundingClientRect = () => rect(-50);
    fireEvent.click(seg("C"));
    expect(dialog().style.left).toBe("8px");
  });

  it("창 크기가 바뀌면 닫힌다", () => {
    renderLane();
    fireEvent.click(seg("C"));
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("타임라인을 가로로 스크롤하면 닫힌다", () => {
    renderWithStudio(<Studio />);
    fireEvent.click(seg("C"));
    expect(dialog()).toBeTruthy();
    fireEvent.scroll(screen.getByTestId("timeline"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ChordLane 코드 선택", () => {
  it("근음을 고르면 종류는 유지된다(Am -> Dm)", () => {
    const h = renderLane();
    fireEvent.click(seg("Am"));
    fireEvent.click(inDialog("D"));
    expect(h.studio().song.progression[1].chord).toEqual({
      root: 2,
      quality: "min",
    });
    // 팝오버는 열려 있고 값이 갱신된다
    expect(inDialog("D").getAttribute("aria-pressed")).toBe("true");
    expect(inDialog("마이너").getAttribute("aria-pressed")).toBe("true");
    expect(seg("Dm")).toBeTruthy();
  });

  it("종류를 고르면 근음은 유지된다(G7 -> Gm7)", () => {
    const h = renderLane();
    fireEvent.click(seg("G7"));
    fireEvent.click(inDialog("마이너 7"));
    expect(h.studio().song.progression[3].chord).toEqual({
      root: 7,
      quality: "min7",
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("근음과 종류를 이어서 바꿀 수 있다(C -> F#maj7)", () => {
    const h = renderLane();
    fireEvent.click(seg("C"));
    fireEvent.click(inDialog("F#"));
    fireEvent.click(inDialog("메이저 7"));
    expect(h.studio().song.progression[0].chord).toEqual({
      root: 6,
      quality: "maj7",
    });
    expect(seg("F#maj7")).toBeTruthy();
  });

  it("같은 값을 다시 고르면 기록이 쌓이지 않는다", () => {
    const h = renderLane();
    fireEvent.click(seg("C"));
    fireEvent.click(inDialog("C"));
    expect(h.studio().canUndo).toBe(false);
  });

  it("코드 바꾸기는 한 번에 한 기록이고 되돌리면 원래대로다", () => {
    const h = renderLane();
    fireEvent.click(seg("C"));
    fireEvent.click(inDialog("E"));
    expect(h.studio().canUndo).toBe(true);
    act(() => h.studio().undo());
    expect(h.studio().song.progression).toEqual(ORIGINAL);
  });
});

describe("ChordLane 나누기·합치기", () => {
  it("나누기는 가운데에서 같은 코드의 두 구간으로 쪼갠다", () => {
    const h = renderLane();
    fireEvent.click(seg("C"));
    fireEvent.click(inDialog("가운데에서 나누기"));
    const p = h.studio().song.progression;
    expect(p).toHaveLength(5);
    expect(p.slice(0, 2).map((s) => [s.start, s.length])).toEqual([
      [0, 1920],
      [1920, 1920],
    ]);
    expect(p[0].chord).toEqual(p[1].chord);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.studio().canUndo).toBe(true);
  });

  it("구간이 반마디 둘보다 짧아지면 나누기가 비활성이다", () => {
    const h = renderLane();
    // 3840 -> 1920 -> 960
    for (let i = 0; i < 2; i++) {
      fireEvent.click(segments()[0]);
      expect(inDialog("가운데에서 나누기").hasAttribute("disabled")).toBe(
        false,
      );
      fireEvent.click(inDialog("가운데에서 나누기"));
    }
    expect(h.studio().song.progression[0].length).toBe(960);
    fireEvent.click(segments()[0]);
    expect(inDialog("가운데에서 나누기").hasAttribute("disabled")).toBe(true);
  });

  it("합치기는 오른쪽 구간과 합치고 닫는다(왼쪽 코드 유지)", () => {
    const h = renderLane();
    fireEvent.click(seg("C"));
    fireEvent.click(inDialog("오른쪽과 합치기"));
    const p = h.studio().song.progression;
    expect(p).toHaveLength(3);
    expect(p[0]).toMatchObject({
      start: 0,
      length: 7680,
      chord: { root: 0, quality: "maj" },
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("마지막 구간은 합치기가 비활성이다", () => {
    const h = renderLane();
    fireEvent.click(seg("G7"));
    const merge = inDialog("오른쪽과 합치기");
    expect(merge.hasAttribute("disabled")).toBe(true);
    fireEvent.click(merge);
    expect(h.studio().song.progression).toHaveLength(4);
    expect(h.studio().canUndo).toBe(false);
  });

  it("나눈 뒤 포커스는 구간 버튼으로 돌아온다", () => {
    renderLane();
    fireEvent.click(seg("C"));
    fireEvent.click(inDialog("가운데에서 나누기"));
    expect(document.activeElement).toBe(segments()[0]);
  });
});

describe("ChordLane 경계 드래그", () => {
  it("놓을 때 한 번만 커밋한다: 중간 move는 곡·실행취소를 바꾸지 않고 폭만 바꾼다", () => {
    const h = renderLane();
    firePointer(handle(1), "pointerdown", { clientX: xAt(3840) });
    firePointer(handle(1), "pointermove", { clientX: xAt(4800) });
    // 미리보기: 폭이 바뀌고 곡은 그대로
    expect(widths()).toEqual(["400px", "240px", "320px", "320px"]);
    expect(h.studio().song.progression).toEqual(ORIGINAL);
    expect(h.studio().canUndo).toBe(false);

    firePointer(handle(1), "pointermove", { clientX: xAt(5760) });
    expect(widths()).toEqual(["480px", "160px", "320px", "320px"]);
    expect(h.studio().song.progression).toEqual(ORIGINAL);
    expect(h.studio().canUndo).toBe(false);

    firePointer(handle(1), "pointerup", { clientX: xAt(5760) });
    const p = h.studio().song.progression;
    expect(p[0].length).toBe(5760);
    expect(p[1].start).toBe(5760);
    expect(widths()).toEqual(["480px", "160px", "320px", "320px"]);
    // 한 번의 기록: 한 번 되돌리면 원래 진행
    expect(h.studio().canUndo).toBe(true);
    act(() => h.studio().undo());
    expect(h.studio().song.progression).toEqual(ORIGINAL);
    expect(h.studio().canUndo).toBe(false);
  });

  it("스냅되지 않은 끝 위치는 가장 가까운 반마디 격자로 커밋된다", () => {
    const h = renderLane();
    firePointer(handle(2), "pointerdown", { clientX: xAt(7680) });
    firePointer(handle(2), "pointerup", { clientX: xAt(7680 - 1000) });
    // 6680 -> 7 * 960 = 6720
    expect(h.studio().song.progression[2].start).toBe(6720);
  });

  it("제자리에 놓으면 기록이 없다", () => {
    const h = renderLane();
    firePointer(handle(1), "pointerdown", { clientX: xAt(3840) });
    firePointer(handle(1), "pointermove", { clientX: xAt(3840) + 10 });
    firePointer(handle(1), "pointerup", { clientX: xAt(3840) + 10 });
    expect(h.studio().canUndo).toBe(false);
    expect(h.studio().song.progression).toEqual(ORIGINAL);
  });

  it("끝까지 끌면 양쪽 구간이 반마디 남는 곳에서 멈춘다", () => {
    const h = renderLane();
    firePointer(handle(1), "pointerdown", { clientX: xAt(3840) });
    firePointer(handle(1), "pointermove", { clientX: -500 });
    expect(widths()[0]).toBe("80px");
    firePointer(handle(1), "pointerup", { clientX: -500 });
    expect(h.studio().song.progression[1].start).toBe(960);

    firePointer(handle(1), "pointerdown", { clientX: xAt(960) });
    firePointer(handle(1), "pointermove", { clientX: 9000 });
    firePointer(handle(1), "pointerup", { clientX: 9000 });
    // 오른쪽 구간 끝(7680) - 960
    expect(h.studio().song.progression[1].start).toBe(6720);
  });

  it("pointerdown에서 포인터를 캡처하고 놓을 때 해제한다", () => {
    renderLane();
    const h1 = handle(1);
    expect(h1.hasPointerCapture(1)).toBe(false);
    firePointer(h1, "pointerdown", { clientX: xAt(3840), pointerId: 1 });
    expect(h1.hasPointerCapture(1)).toBe(true);
    firePointer(h1, "pointerup", { clientX: xAt(3840), pointerId: 1 });
    expect(h1.hasPointerCapture(1)).toBe(false);
  });

  it("Esc는 취소한다: 곡 그대로, 폭 복귀, 이후 놓아도 커밋 없음", () => {
    const h = renderLane();
    firePointer(handle(1), "pointerdown", { clientX: xAt(3840) });
    firePointer(handle(1), "pointermove", { clientX: xAt(5760) });
    expect(widths()[0]).toBe("480px");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(widths()).toEqual(["320px", "320px", "320px", "320px"]);
    firePointer(handle(1), "pointermove", { clientX: xAt(6000) });
    expect(widths()[0]).toBe("320px");
    firePointer(handle(1), "pointerup", { clientX: xAt(5760) });
    expect(h.studio().song.progression).toEqual(ORIGINAL);
    expect(h.studio().canUndo).toBe(false);
  });

  it("pointercancel은 취소한다", () => {
    const h = renderLane();
    firePointer(handle(1), "pointerdown", { clientX: xAt(3840) });
    firePointer(handle(1), "pointermove", { clientX: xAt(5760) });
    firePointer(handle(1), "pointercancel", { clientX: xAt(5760) });
    expect(widths()).toEqual(["320px", "320px", "320px", "320px"]);
    firePointer(handle(1), "pointerup", { clientX: xAt(5760) });
    expect(h.studio().canUndo).toBe(false);
  });

  it("pointerup 없이 캡처를 잃으면(lostpointercapture) 취소한다", () => {
    const h = renderLane();
    firePointer(handle(1), "pointerdown", { clientX: xAt(3840) });
    firePointer(handle(1), "pointermove", { clientX: xAt(5760) });
    fireEvent(
      handle(1),
      new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 1 }),
    );
    expect(widths()).toEqual(["320px", "320px", "320px", "320px"]);
    expect(h.studio().canUndo).toBe(false);
  });

  it("pointerup 뒤에 오는 lostpointercapture는 두 번째 커밋을 만들지 않는다", () => {
    const h = renderLane();
    firePointer(handle(1), "pointerdown", { clientX: xAt(3840) });
    firePointer(handle(1), "pointerup", { clientX: xAt(5760) });
    fireEvent(
      handle(1),
      new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 1 }),
    );
    expect(h.studio().song.progression[1].start).toBe(5760);
    act(() => h.studio().undo());
    expect(h.studio().canUndo).toBe(false);
  });

  it("주 버튼이 아닌 클릭은 드래그를 시작하지 않는다", () => {
    const h = renderLane();
    const spy = vi.spyOn(HTMLElement.prototype, "setPointerCapture");
    firePointer(handle(1), "pointerdown", { clientX: xAt(3840), button: 2 });
    firePointer(handle(1), "pointermove", { clientX: xAt(5760) });
    firePointer(handle(1), "pointerup", { clientX: xAt(5760) });
    expect(spy).not.toHaveBeenCalled();
    expect(widths()).toEqual(["320px", "320px", "320px", "320px"]);
    expect(h.studio().canUndo).toBe(false);
  });

  it("다른 포인터 id의 move·up은 무시한다", () => {
    const h = renderLane();
    firePointer(handle(1), "pointerdown", { clientX: xAt(3840), pointerId: 1 });
    firePointer(handle(1), "pointermove", { clientX: xAt(5760), pointerId: 2 });
    expect(widths()[0]).toBe("320px");
    firePointer(handle(1), "pointerup", { clientX: xAt(5760), pointerId: 2 });
    expect(h.studio().canUndo).toBe(false);
    firePointer(handle(1), "pointerup", { clientX: xAt(3840), pointerId: 1 });
  });

  it("NaN clientX는 무시한다: 시작하지 않고, 끌던 중이면 마지막 값을 유지한다", () => {
    const h = renderLane();
    const spy = vi.spyOn(HTMLElement.prototype, "setPointerCapture");
    fireBadPointer(handle(1), "pointerdown", Number.NaN);
    expect(spy).not.toHaveBeenCalled();

    firePointer(handle(1), "pointerdown", { clientX: xAt(3840) });
    firePointer(handle(1), "pointermove", { clientX: xAt(5760) });
    fireBadPointer(handle(1), "pointermove", Number.NaN);
    expect(widths()[0]).toBe("480px");
    fireBadPointer(handle(1), "pointerup", Number.NaN);
    expect(h.studio().song.progression[1].start).toBe(5760);
  });

  it("레인의 화면 위치가 스크롤로 밀려 있어도 scrollLeft를 또 더하지 않는다", () => {
    const h = renderWithStudio(<Studio />);
    const laneEl = screen.getByTestId("chord-lane");
    const timeline = screen.getByTestId("timeline");
    // 320px 스크롤됨: 레인 요소의 화면 left가 이미 96 - 320이다.
    Object.defineProperty(timeline, "scrollLeft", {
      value: 320,
      configurable: true,
    });
    stubLaneRect(laneEl, { left: LANE_LEFT - 320, width: 1280, height: 40 });
    const hd = handle(1);
    firePointer(hd, "pointerdown", { clientX: LANE_LEFT - 320 + 320 });
    firePointer(hd, "pointermove", { clientX: LANE_LEFT - 320 + 480 });
    firePointer(hd, "pointerup", { clientX: LANE_LEFT - 320 + 480 });
    expect(h.studio().song.progression[1].start).toBe(5760);
  });
});

describe("ChordLane 편집 불가(재생 중·대기 중)", () => {
  it("재생 중이면 클릭해도 열리지 않고 버튼에 aria-disabled가 있다", async () => {
    const h = renderLane();
    await startPlaying(h);
    expect(h.studio().editable).toBe(false);
    for (const el of [...segments(), ...screen.getAllByRole("separator")]) {
      expect(el.getAttribute("aria-disabled")).toBe("true");
    }
    fireEvent.click(seg("C"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("재생 중이면 드래그가 시작되지 않는다(캡처 없음·미리보기 없음·커밋 없음)", async () => {
    const h = renderLane();
    await startPlaying(h);
    const spy = vi.spyOn(HTMLElement.prototype, "setPointerCapture");
    firePointer(handle(1), "pointerdown", { clientX: xAt(3840) });
    firePointer(handle(1), "pointermove", { clientX: xAt(5760) });
    expect(widths()).toEqual(["320px", "320px", "320px", "320px"]);
    firePointer(handle(1), "pointerup", { clientX: xAt(5760) });
    expect(spy).not.toHaveBeenCalled();
    expect(h.studio().song.progression).toEqual(ORIGINAL);
  });

  it("재생 시작 대기 중(pending)에도 막힌다", async () => {
    const h = renderLane({ playMode: "manual" });
    await startPlaying(h);
    expect(h.studio().pending).toBe(true);
    fireEvent.click(seg("C"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(seg("C").getAttribute("aria-disabled")).toBe("true");
  });

  it("팝오버가 열린 채 재생이 시작되면 닫힌다(멈춘 뒤 다시 나타나지 않는다)", async () => {
    const h = renderLane();
    fireEvent.click(seg("C"));
    expect(dialog()).toBeTruthy();
    await startPlaying(h);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => h.studio().stop());
    expect(h.studio().editable).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("드래그 중 재생이 시작되면 미리보기를 되돌리고 커밋하지 않는다", async () => {
    const h = renderLane();
    firePointer(handle(1), "pointerdown", { clientX: xAt(3840) });
    firePointer(handle(1), "pointermove", { clientX: xAt(5760) });
    expect(widths()[0]).toBe("480px");
    await startPlaying(h);
    expect(widths()).toEqual(["320px", "320px", "320px", "320px"]);
    act(() => h.studio().stop());
    // 멈춘 뒤 늦게 온 pointerup이 커밋하지 않는다
    firePointer(handle(1), "pointerup", { clientX: xAt(5760) });
    expect(h.studio().song.progression).toEqual(ORIGINAL);
    expect(h.studio().canUndo).toBe(false);
    expect(widths()).toEqual(["320px", "320px", "320px", "320px"]);
  });
});

describe("ChordLane 렌더 비용", () => {
  it("재생 위치(10Hz)가 바뀌어도 레인은 다시 렌더되지 않는다", async () => {
    const onViewRender = vi.fn();
    const h = renderWithStudio(<ChordLane onViewRender={onViewRender} />);
    h.fake.engine.currentTick.mockReturnValue(1920 * 2);
    await startPlaying(h);
    const before = onViewRender.mock.calls.length;
    const pos = h.studio().position;
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(h.studio().position).not.toEqual(pos); // 위치는 실제로 바뀌었다
    expect(onViewRender.mock.calls.length).toBe(before);
  });
});

describe("Studio 연결", () => {
  it("chord-lane 자리에 4구간이 그려지고 헤더가 유지된다", () => {
    renderWithStudio(<Studio />);
    expect(
      within(screen.getByTestId("chord-lane"))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["C", "Am", "F", "G7"]);
    expect(screen.getByTestId("chord-lane-header").textContent).toBe("코드");
  });
});
