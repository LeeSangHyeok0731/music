import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOSAVE_KEY, serializeSong } from "@/lib/score/autosave";
import type { Song } from "@/lib/score/model";
import { songWithPatterns } from "@/lib/score/testing/builders";

import { PX_PER_BAR } from "../geometry";
import { Studio } from "../Studio";
import { beginGesture } from "../gestures";
import { hasOpenModal } from "../modal";
import {
  installAudioContextStub,
  renderWithStudio,
  startPlaying,
} from "../testing/harness";
import {
  LANE_LEFT,
  firePointer,
  installPointerCaptureStubs,
  stubLaneRect,
  xAt,
} from "../testing/pointer";
import { PianoRoll } from "./PianoRoll";
import { ROW_HEIGHT, initialScrollTop } from "./geometry";

let restoreAudio: () => void;
let restorePointer: () => void;

beforeEach(() => {
  restoreAudio = installAudioContextStub();
  restorePointer = installPointerCaptureStubs();
  // 재생 중 10Hz 위치 표본 타이머를 가짜로 둔다(act 밖 갱신을 막는다).
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanup();
  // 모달 카운터가 새면(정리 누락) 다음 테스트와 전역 단축키로 번진다.
  expect(hasOpenModal()).toBe(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  restorePointer();
  restoreAudio();
});

const PIANO = "track-piano";
const DRUMS = "track-drums";

/**
 * 4마디. 진행 C [0,1920) / Am [1920,3840) / G [3840,7680).
 * 피아노: 음 클립 n1 [960,2880)(C4 @클립 0, A4 @클립 1500), 패턴 클립 p1 [3840,5760).
 * 드럼: d1 [0,1920).
 */
function rollSong(): Song {
  const song = songWithPatterns({
    bars: 4,
    progression: [
      { start: 0, length: 1920, chord: { root: 0, quality: "maj" } },
      { start: 1920, length: 1920, chord: { root: 9, quality: "min" } },
      { start: 3840, length: 3840, chord: { root: 7, quality: "maj" } },
    ],
    tracks: [
      {
        id: PIANO,
        instrument: "piano",
        clips: [{ id: "p1", start: 3840, length: 1920, pattern: "piano-block" }],
      },
      {
        id: DRUMS,
        instrument: "drums",
        clips: [{ id: "d1", start: 0, length: 1920, pattern: "drum-basic-rock" }],
      },
    ],
  });
  song.tracks[0].clips.unshift({
    id: "n1",
    start: 960,
    length: 1920,
    body: {
      type: "notes",
      notes: [
        { start: 0, length: 240, pitch: 60, velocity: 0.8 },
        { start: 1500, length: 360, pitch: 69, velocity: 0.6 },
      ],
    },
  });
  return song;
}

function stubLanes(song: Song) {
  for (const t of song.tracks) {
    stubLaneRect(screen.getByTestId(`track-lane-${t.id}`), {
      left: LANE_LEFT,
      width: song.bars * PX_PER_BAR,
      height: 56,
    });
  }
}

function renderStudio(song: Song = rollSong()) {
  const h = renderWithStudio(<Studio />, {
    stored: { [AUTOSAVE_KEY]: serializeSong(song) },
  });
  stubLanes(song);
  return h;
}

function tile(clipId: string) {
  return screen.getByTestId(`clip-${clipId}`);
}
function body(clipId: string): HTMLElement {
  return tile(clipId).querySelector("button[aria-pressed]") as HTMLElement;
}
function pointerClick(el: Element, x = 0, shiftKey = false) {
  firePointer(el, "pointerdown", { clientX: x, shiftKey });
  firePointer(el, "pointerup", { clientX: x, shiftKey });
}
function roll() {
  return screen.getByRole("dialog", { name: "피아노롤" });
}
function queryRoll() {
  return screen.queryByRole("dialog", { name: "피아노롤" });
}
function popover() {
  return screen.getByRole("dialog", { name: "패턴 선택" });
}
function clipBody(
  h: { studio(): { song: Song } },
  clipId: string,
  track = PIANO,
) {
  return h
    .studio()
    .song.tracks.find((t) => t.id === track)!
    .clips.find((c) => c.id === clipId)?.body;
}
/** n1을 선택하고 "음 편집" 버튼으로 연다. */
function openN1() {
  pointerClick(body("n1"));
  fireEvent.click(within(tile("n1")).getByRole("button", { name: "음 편집" }));
}
/** p1의 팝오버를 열어 버튼 하나를 누른다. */
function popoverPick(name: "음으로 바꾸기" | "빈 음 클립으로") {
  pointerClick(body("p1"));
  fireEvent.click(within(popover()).getByRole("button", { name }));
}

describe("진입점", () => {
  it("음 클립은 선택하면 '음 편집' 버튼이 생기고, 그 버튼이 모달을 연다", () => {
    renderStudio();
    expect(screen.queryByRole("button", { name: "음 편집" })).toBeNull();
    pointerClick(body("n1"));
    expect(queryRoll()).toBeNull();
    const edit = within(tile("n1")).getByRole("button", { name: "음 편집" });
    fireEvent.click(edit);
    expect(roll()).toBeTruthy();
  });

  it("패턴 클립·드럼 클립에는 '음 편집' 버튼이 없다", () => {
    renderStudio();
    pointerClick(body("p1"));
    expect(screen.queryByRole("button", { name: "음 편집" })).toBeNull();
    pointerClick(body("d1"));
    expect(screen.queryByRole("button", { name: "음 편집" })).toBeNull();
  });

  it("본문 버튼 더블클릭으로 열린다", () => {
    renderStudio();
    fireEvent.doubleClick(body("n1"));
    expect(roll()).toBeTruthy();
  });

  it("키보드 클릭(Enter, detail 0)으로 열리고 마우스 클릭 한 번은 선택만 한다", () => {
    const h = renderStudio();
    pointerClick(body("n1"));
    expect(queryRoll()).toBeNull();
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "n1" });
    // 마우스 클릭 뒤 브라우저가 따로 보내는 click(detail 1)은 삼켜진다.
    fireEvent.click(body("n1"), { detail: 1 });
    expect(queryRoll()).toBeNull();
    fireEvent.click(body("n1"), { detail: 0 });
    expect(roll()).toBeTruthy();
  });

  it("패턴 클립에서 더블클릭·Enter는 모달을 열지 않는다", () => {
    renderStudio();
    fireEvent.doubleClick(body("p1"));
    fireEvent.click(body("p1"), { detail: 0 });
    expect(queryRoll()).toBeNull();
  });

  it("재생 중에는 열리지 않는다", async () => {
    const h = renderStudio();
    await startPlaying(h);
    fireEvent.doubleClick(body("n1"));
    fireEvent.click(body("n1"), { detail: 0 });
    expect(queryRoll()).toBeNull();
  });

  it("팝오버 '음으로 바꾸기': 굽고 모달을 열고 굽기 안내가 보인다", () => {
    const h = renderStudio();
    popoverPick("음으로 바꾸기");
    const b = clipBody(h, "p1");
    expect(b?.type).toBe("notes");
    if (b?.type === "notes") expect(b.notes.length).toBeGreaterThan(0);
    // 팝오버는 닫히고 모달만 남는다.
    expect(screen.queryByRole("dialog", { name: "패턴 선택" })).toBeNull();
    expect(roll()).toBeTruthy();
    expect(within(roll()).getByText(/음으로 바꿨습니다/)).toBeTruthy();
  });

  it("팝오버 '빈 음 클립으로': 빈 음 클립이 되고 모달이 열린다", () => {
    const h = renderStudio();
    popoverPick("빈 음 클립으로");
    expect(clipBody(h, "p1")).toEqual({ type: "notes", notes: [] });
    expect(roll()).toBeTruthy();
  });

  it("드럼 클립의 팝오버에는 두 버튼이 없다", () => {
    renderStudio();
    pointerClick(body("d1"));
    const d = popover();
    expect(within(d).queryByRole("button", { name: "음으로 바꾸기" })).toBeNull();
    expect(within(d).queryByRole("button", { name: "빈 음 클립으로" })).toBeNull();
  });

  it("빈 칸 Shift+클릭(피아노)은 빈 음 클립을 만들고 선택하되 모달은 열지 않는다", () => {
    const h = renderStudio();
    const lane = screen.getByTestId(`track-lane-${PIANO}`);
    const before = h.studio().song.tracks[0].clips.map((c) => c.id);
    pointerClick(lane, xAt(6000), true);
    const clips = h.studio().song.tracks[0].clips;
    const added = clips.find((c) => !before.includes(c.id))!;
    expect(added.body).toEqual({ type: "notes", notes: [] });
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: added.id });
    expect(queryRoll()).toBeNull();
  });

  it("빈 칸 Shift+클릭은 되돌리기 한 번으로 클립째 사라진다(기록 한 칸)", () => {
    const h = renderStudio();
    const before = h.studio().song;
    pointerClick(screen.getByTestId(`track-lane-${PIANO}`), xAt(6000), true);
    expect(h.studio().song).not.toBe(before);
    act(() => h.studio().undo());
    expect(h.studio().song).toBe(before);
    expect(h.studio().canUndo).toBe(false);
  });

  it("Shift 없는 빈 칸 클릭은 패턴 클립이고, 드럼 Shift+클릭도 패턴 클립이다", () => {
    const h = renderStudio();
    const before = h.studio().song.tracks[0].clips.map((c) => c.id);
    pointerClick(screen.getByTestId(`track-lane-${PIANO}`), xAt(6000));
    const added = h
      .studio()
      .song.tracks[0].clips.find((c) => !before.includes(c.id))!;
    expect(added.body.type).toBe("pattern");

    const beforeDrums = h.studio().song.tracks[1].clips.map((c) => c.id);
    pointerClick(screen.getByTestId(`track-lane-${DRUMS}`), xAt(3000), true);
    const drum = h
      .studio()
      .song.tracks[1].clips.find((c) => !beforeDrums.includes(c.id))!;
    expect(drum.body.type).toBe("pattern");
  });
});

describe("모달 열림·닫힘·포커스", () => {
  it("role·aria-modal·이름을 갖고 document.body로 포털되며 열린 동안 카운터가 켜진다", () => {
    renderStudio();
    expect(hasOpenModal()).toBe(false);
    openN1();
    const dialog = roll();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.parentElement).toBe(document.body);
    expect(hasOpenModal()).toBe(true);
  });

  it("← 돌아가기로 닫히고 포커스가 연 요소(음 편집 버튼)로 돌아온다", () => {
    renderStudio();
    openN1();
    const opener = within(tile("n1")).getByRole("button", { name: "음 편집" });
    fireEvent.click(within(roll()).getByRole("button", { name: "← 돌아가기" }));
    expect(queryRoll()).toBeNull();
    expect(hasOpenModal()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("더블클릭으로 열었다면 닫을 때 클립 본문 버튼으로 돌아온다", () => {
    renderStudio();
    fireEvent.doubleClick(body("n1"));
    fireEvent.click(within(roll()).getByRole("button", { name: "← 돌아가기" }));
    expect(document.activeElement).toBe(body("n1"));
  });

  it("연 요소가 사라졌으면(선택 해제로 음 편집 버튼 제거) 닫을 때 클립 본문 버튼으로 돌아온다", () => {
    const h = renderStudio();
    openN1();
    const opener = within(tile("n1")).getByRole("button", { name: "음 편집" });
    act(() => h.studio().select(null)); // 편집 버튼은 선택된 클립에만 있다
    expect(opener.isConnected).toBe(false);
    fireEvent.click(within(roll()).getByRole("button", { name: "← 돌아가기" }));
    expect(queryRoll()).toBeNull();
    expect(document.activeElement).toBe(body("n1"));
  });

  it("팝오버 경로로 열었다면 닫을 때 포커스가 그 클립 본문으로 돌아온다", () => {
    renderStudio();
    popoverPick("빈 음 클립으로");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(queryRoll()).toBeNull();
    expect(document.activeElement).toBe(body("p1"));
  });

  it("Esc로 닫히고 선택은 그대로다(한 번에 한 겹)", () => {
    const h = renderStudio();
    openN1();
    expect(hasOpenModal()).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(queryRoll()).toBeNull();
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: "n1" });
    // 모달이 없으니 다음 Esc는 선택을 푼다.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(h.studio().selection).toBeNull();
  });

  it("이미 처리된 Esc(defaultPrevented)에는 닫지 않는다", () => {
    renderStudio();
    const earlier = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener("keydown", earlier, true);
    try {
      openN1();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(roll()).toBeTruthy();
    } finally {
      document.removeEventListener("keydown", earlier, true);
    }
  });

  it("진행 중인 제스처가 있으면 Esc는 모달을 닫지 않는다", () => {
    renderStudio();
    openN1();
    const release = beginGesture();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(roll()).toBeTruthy();
    release();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(queryRoll()).toBeNull();
  });

  it("처음 포커스는 격자 영역이고 Tab은 안에서 돈다", () => {
    renderStudio();
    openN1();
    const dialog = roll();
    expect(document.activeElement).toBe(
      within(dialog).getByTestId("roll-scroll"),
    );
    const back = within(dialog).getByRole("button", { name: "← 돌아가기" });
    const all = [
      ...dialog.querySelectorAll<HTMLElement>("button, input, [tabindex]"),
    ].filter(
      (el) =>
        !(el as HTMLButtonElement).disabled &&
        el.getAttribute("tabindex") !== "-1",
    );
    const last = all[all.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(back, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("클립이 사라지면(되돌리기) 모달이 닫히고 카운터가 내려간다", () => {
    const h = renderStudio();
    popoverPick("음으로 바꾸기");
    expect(roll()).toBeTruthy();
    act(() => h.studio().undo()); // 패턴 클립으로 돌아간다
    expect(clipBody(h, "p1")?.type).toBe("pattern");
    expect(queryRoll()).toBeNull();
    expect(hasOpenModal()).toBe(false);
  });

  it("모달 안에서 Ctrl+Z로 되돌려도 닫힌다(전역 단축키)", () => {
    const h = renderStudio();
    popoverPick("빈 음 클립으로");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "z",
      ctrlKey: true,
    });
    expect(clipBody(h, "p1")?.type).toBe("pattern");
    expect(queryRoll()).toBeNull();
  });

  it("클립을 삭제하면(되돌리기 없이) 모달이 닫힌다", () => {
    const h = renderStudio();
    openN1();
    act(() => h.studio().edit.removeClip(PIANO, "n1"));
    expect(queryRoll()).toBeNull();
    expect(hasOpenModal()).toBe(false);
  });

  it("언마운트(Studio가 사라짐)에서도 카운터가 내려간다", () => {
    const h = renderStudio();
    openN1();
    expect(hasOpenModal()).toBe(true);
    h.unmount();
    expect(hasOpenModal()).toBe(false);
  });
});

describe("재생과 전역 단축키", () => {
  it("모달 안에서 Space는 재생한다(전역 단축키, 격자 영역에 포커스)", () => {
    const h = renderStudio();
    openN1();
    expect(h.fake.engine.play).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
  });

  it("재생 중에도 열려 있고 헤더에 편집 불가 알림이 보인다", async () => {
    const h = renderStudio();
    openN1();
    await startPlaying(h);
    expect(h.studio().playing).toBe(true);
    expect(roll()).toBeTruthy();
    expect(
      within(screen.getByTestId("roll-message-strip")).getByText(
        "재생 중에는 편집할 수 없습니다",
      ),
    ).toBeTruthy();
  });

  it("헤더의 재생/정지 버튼이 실제 Provider를 움직인다", async () => {
    const h = renderStudio();
    openN1();
    const dialog = roll();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "재생" }));
    });
    expect(h.studio().playing).toBe(true);
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "정지" }));
    expect(h.studio().playing).toBe(false);
    expect(h.fake.engine.stop).toHaveBeenCalled();
  });

  it("헤더 위치 표시는 font-mono tabular-nums다", () => {
    renderStudio();
    openN1();
    const pos = within(roll()).getByText(/1마디 · 1박/);
    expect(pos.className).toContain("font-mono");
    expect(pos.className).toContain("tabular-nums");
  });

  it("헤더 되돌리기 버튼은 되돌릴 게 없으면 비활성이고, 있으면 되돌린다", () => {
    const h = renderStudio();
    openN1();
    const undo = within(roll()).getByRole("button", { name: "되돌리기" });
    expect((undo as HTMLButtonElement).disabled).toBe(true);
    act(() => h.studio().edit.setBars(5));
    expect((undo as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(undo);
    expect(h.studio().song.bars).toBe(4);
  });

  it("모달 안 플레이헤드는 정지 중 translateX(0px)이다", () => {
    renderStudio();
    openN1();
    const heads = within(roll()).getAllByTestId("playhead");
    expect(heads).toHaveLength(1);
    expect(heads[0].style.transform).toBe("translateX(0px)");
  });
});

describe("헤더", () => {
  it("제목은 '<악기> · N~M마디'(클립 시작·끝 마디, 반마디 시작도 포함)", () => {
    renderStudio();
    openN1(); // [960, 2880) → 1마디 ~ 2마디
    expect(
      within(roll()).getByRole("heading", { name: "피아노 · 1~2마디" }),
    ).toBeTruthy();
  });

  it("격자 단위 라디오 셋, 기본 1/8, 선택하면 바뀐다", () => {
    renderStudio();
    openN1();
    const group = within(roll()).getByRole("radiogroup", { name: "격자 단위" });
    const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(["1/4", "1/8", "1/16"]);
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
    fireEvent.click(radios[2]);
    expect(
      (within(group).getAllByRole("radio") as HTMLInputElement[]).map(
        (r) => r.checked,
      ),
    ).toEqual([false, false, true]);
  });

  it("격자 단위는 격자 배경의 선 간격을 바꾼다(1/8 → 48px, 1/16 → 24px)", () => {
    renderStudio();
    openN1();
    const grid = within(roll()).getByTestId("roll-grid");
    const styleOf = () => grid.getAttribute("style") ?? "";
    expect(styleOf()).toContain("48px");
    fireEvent.click(within(roll()).getByRole("radio", { name: "1/16" }));
    expect(styleOf()).toContain("24px");
    expect(styleOf()).not.toContain("48px");
  });
});

describe("본문", () => {
  it("건반 열은 표시 범위(피아노 36~96)의 행이고 검은 건반이 표시된다", () => {
    renderStudio();
    openN1();
    const keys = within(roll()).getByTestId("roll-keys");
    const rows = [...keys.querySelectorAll<HTMLElement>("[data-pitch]")];
    expect(rows).toHaveLength(96 - 36 + 1);
    expect(rows[0].textContent).toBe("C7");
    expect(rows[0].getAttribute("data-pitch")).toBe("96");
    expect(rows.at(-1)!.textContent).toBe("C2");
    for (const r of rows) {
      const p = Number(r.getAttribute("data-pitch"));
      expect(r.hasAttribute("data-black")).toBe(
        [1, 3, 6, 8, 10].includes(p % 12),
      );
      expect(r.style.height).toBe(`${ROW_HEIGHT}px`);
    }
  });

  it("코드 띠는 클립 구간의 코드 이름을 클립 기준 위치에 읽기 전용으로 그린다", () => {
    renderStudio();
    openN1(); // [960,2880): C 960틱(192px), Am 960틱
    const labels = within(roll()).getAllByTestId("roll-chord-label");
    expect(labels.map((l) => l.textContent)).toEqual(["C", "Am"]);
    expect(labels.map((l) => l.style.left)).toEqual(["0px", "192px"]);
    expect(labels.map((l) => l.style.width)).toEqual(["192px", "192px"]);
  });

  it("행 색칠은 코드 구성음 행에만 붙는다(구간 단위: C [0,4,7], Am [0,4,9])", () => {
    renderStudio();
    openN1();
    const tones = [
      ...within(roll())
        .getByTestId("roll-grid")
        .querySelectorAll<HTMLElement>("[data-chord-tone]"),
    ];
    const bySegment = new Map<string, number[]>();
    for (const el of tones) {
      const seg = el.getAttribute("data-chord-segment")!;
      bySegment.set(seg, [
        ...(bySegment.get(seg) ?? []),
        Number(el.getAttribute("data-chord-tone")),
      ]);
    }
    const expectRows = (classes: number[]) => {
      const rows: number[] = [];
      for (let p = 96; p >= 36; p--) if (classes.includes(p % 12)) rows.push(p);
      return rows;
    };
    expect(bySegment.get("0")).toEqual(expectRows([0, 4, 7]));
    expect(bySegment.get("1")).toEqual(expectRows([0, 4, 9]));
    // 구간마다 가로 범위가 다르다.
    const first = tones.find(
      (t) => t.getAttribute("data-chord-segment") === "0",
    )!;
    const second = tones.find(
      (t) => t.getAttribute("data-chord-segment") === "1",
    )!;
    expect([first.style.left, first.style.width]).toEqual(["0px", "192px"]);
    expect([second.style.left, second.style.width]).toEqual(["192px", "192px"]);
    // 코드 구성음이 아닌 행(D, 62)에는 색칠이 없다.
    expect(tones.some((t) => t.getAttribute("data-chord-tone") === "62")).toBe(
      false,
    );
  });

  it("음은 실제 button이고 이름은 '<음>, <곡 기준 마디·박>, 길이 <분수>', 위치는 rect다", () => {
    renderStudio();
    openN1();
    const grid = within(roll()).getByTestId("roll-grid");
    const c4 = within(grid).getByRole("button", {
      name: "C4, 1마디 3박, 길이 1/8",
    });
    const a4 = within(grid).getByRole("button", {
      name: "A4, 2마디 2박, 길이 3/16",
    });
    expect(c4.tagName).toBe("BUTTON");
    expect(c4.getAttribute("aria-pressed")).toBe("false");
    expect(c4.className).toContain("bg-indigo-500/25");
    expect(c4.className).toContain("border-indigo-400/60");
    // 위치는 음 칸(본문 버튼과 길이 핸들을 감싼 래퍼)에 있다.
    // hi 96: C4 = (96-60)*20 = 720px, 폭 240틱 = 48px
    const c4Cell = c4.closest<HTMLElement>("[data-note-key]")!;
    const a4Cell = a4.closest<HTMLElement>("[data-note-key]")!;
    expect(
      [c4Cell.style.left, c4Cell.style.top, c4Cell.style.width, c4Cell.style.height],
    ).toEqual(["0px", "720px", "48px", "20px"]);
    expect([a4Cell.style.left, a4Cell.style.top, a4Cell.style.width]).toEqual([
      "300px",
      `${(96 - 69) * 20}px`,
      "72px",
    ]);
  });

  it("빈 음 클립이면 음 버튼이 없다", () => {
    renderStudio();
    popoverPick("빈 음 클립으로");
    const grid = within(roll()).getByTestId("roll-grid");
    expect(grid.querySelectorAll("button")).toHaveLength(0);
  });

  it("격자선은 CSS 배경이고 격자 아래 DOM은 코드 색칠과 음 칸(본문 버튼 + 길이 핸들)뿐이다", () => {
    renderStudio();
    openN1();
    const grid = within(roll()).getByTestId("roll-grid");
    for (const child of grid.children) {
      expect(
        child.hasAttribute("data-chord-tone") ||
          child.hasAttribute("data-note-key"),
      ).toBe(true);
      if (child.hasAttribute("data-note-key")) {
        expect([...child.children].map((c) => c.tagName)).toEqual([
          "BUTTON",
          "DIV",
        ]);
      }
    }
  });

  it("스크롤은 격자 영역 하나가 소유한다(.timeline-scroll, overflow-auto)", () => {
    renderStudio();
    openN1();
    const scroll = within(roll()).getByTestId("roll-scroll");
    expect(scroll.className).toContain("timeline-scroll");
    expect(scroll.className).toContain("overflow-auto");
    expect(scroll.contains(within(roll()).getByTestId("roll-keys"))).toBe(true);
    expect(scroll.contains(within(roll()).getByTestId("roll-chord-strip"))).toBe(
      true,
    );
  });

  it("세기 레인 자리가 있다", () => {
    renderStudio();
    openN1();
    expect(within(roll()).getByTestId("roll-velocity")).toBeTruthy();
  });
});

describe("렌더 비용", () => {
  it("재생 위치가 10Hz로 바뀌어도 격자와 코드 띠는 다시 그려지지 않는다(헤더만 바뀐다)", async () => {
    const probe = vi.fn();
    const h = renderWithStudio(
      <PianoRoll
        trackId={PIANO}
        clipId="n1"
        onClose={() => {}}
        onGridRender={probe}
      />,
      { stored: { [AUTOSAVE_KEY]: serializeSong(rollSong()) } },
    );
    await startPlaying(h);
    const rendered = probe.mock.calls.length;
    // 격자와 코드 띠가 각각 한 번 이상 커밋됐다.
    expect(rendered).toBeGreaterThanOrEqual(2);
    h.fake.engine.currentTick.mockReturnValue(1920);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(within(roll()).getByText(/2마디 · 1박/)).toBeTruthy();
    expect(probe.mock.calls.length).toBe(rendered);
  });
});

describe("처음 열 때 세로 스크롤", () => {
  /** jsdom은 레이아웃이 없다: scrollTop 쓰기를 기록하고 clientHeight를 고정한다. */
  function stubScrollBox(clientHeight: number) {
    const writes: number[] = [];
    const proto = HTMLElement.prototype;
    Object.defineProperty(proto, "scrollTop", {
      configurable: true,
      get: () => writes.at(-1) ?? 0,
      set: (v: number) => void writes.push(v),
    });
    Object.defineProperty(proto, "clientHeight", {
      configurable: true,
      get: () => clientHeight,
    });
    return {
      writes,
      // 두 속성은 원래 Element.prototype에 있다. 덮어쓴 HTMLElement.prototype 쪽만 지우면 돌아온다.
      restore() {
        delete (proto as unknown as Record<string, unknown>).scrollTop;
        delete (proto as unknown as Record<string, unknown>).clientHeight;
      },
    };
  }

  it("음이 있으면 음 범위 가운데로 한 번 스크롤한다", () => {
    renderStudio();
    const box = stubScrollBox(500);
    try {
      openN1();
      // n1의 음은 60·69 → 가운데 64.5, 표시 범위 hi 96
      expect(box.writes).toEqual([
        initialScrollTop(
          [{ pitch: 60 }, { pitch: 69 }],
          96,
          500,
        ),
      ]);
    } finally {
      box.restore();
    }
  });

  it("빈 음 클립이면 C4 근처로 스크롤한다", () => {
    renderStudio();
    const box = stubScrollBox(500);
    try {
      popoverPick("빈 음 클립으로");
      expect(box.writes).toEqual([initialScrollTop([], 96, 500)]);
    } finally {
      box.restore();
    }
  });
});
