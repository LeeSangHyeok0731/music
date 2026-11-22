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
import { buildDemoSong } from "@/lib/score/demo-song";
import { expandSong, type ScheduledNote } from "@/lib/score/expand";
import type { Note, Song } from "@/lib/score/model";
import { bakeClipToNotes } from "@/lib/score/notes";
import { ticksPerBar } from "@/lib/score/time";
import { StudioProvider } from "@/state/StudioProvider";
import {
  acceptedSongs,
  createFakeDeps,
  type FakeDeps,
  type FakeDepsOptions,
} from "@/state/testing/fake-deps";
import type { StudioApi } from "@/state/types";
import { useStudio } from "@/state/useStudio";

import { PX_PER_BAR } from "../geometry";
import { hasActiveGesture } from "../gestures";
import { hasOpenModal } from "../modal";
import { hasOpenPopover } from "../popover";
import { Studio } from "../Studio";
import { installAudioContextStub } from "../testing/harness";
import {
  LANE_LEFT,
  firePointer,
  installPointerCaptureStubs,
  stubLaneRect,
  xAt,
} from "../testing/pointer";
import { ROW_HEIGHT, VELOCITY_LANE_HEIGHT } from "./geometry";

/**
 * 피아노롤 통합 시나리오(계획 Task 6). `<StudioProvider><Studio/></StudioProvider>` 전체에 가짜
 * 엔진·뱅크·저장소만 끼우고 사람이 하는 입력(클릭·포인터·키보드)으로 편집한다. 핵심 단언은
 * (1) 가짜 엔진이 **받아들인 마지막 곡**을 `expandSong`으로 편 피아노 이벤트, (2) 곡 상태다.
 * 상태 API는 읽기에만 쓰고(되돌리기 같은 사용자 동작은 키·버튼으로) 편집을 직접 부르지 않는다.
 *
 * 좌표(스텁): 격자는 화면 (GL, GT)에서 시작하고 1px = 5틱, 한 행 = 20px, 표시 범위 hi = 96이다.
 * 세기 막대 영역은 화면 y = LT에서 높이 80px(세기 0.8 → 막대 64px).
 */

const PIANO = "track-piano";
const CLIP0 = "piano-0"; // 데모의 첫 피아노 패턴 클립 [0, 3840), C 코드
const CLIP1 = "piano-1"; // [3840, 7680), Am 코드
const BAR = ticksPerBar([4, 4]); // 1920

const CLIP_BAKED =
  "음으로 바꿨습니다 — 코드 진행을 바꿔도 이 클립은 따라가지 않습니다. 되돌리기로 복구할 수 있습니다";
const READ_ONLY = "재생 중에는 편집할 수 없습니다";
const LOADING = "샘플을 불러오는 중…";

/** 격자의 화면 좌표 기준. */
const GL = 200;
const GT = 100;
const HI = 96;
/** 세기 막대 영역의 화면 y. */
const LT = 500;
const gx = (tick: number) => GL + tick / 5;
const gy = (pitch: number) => GT + (HI - pitch) * ROW_HEIGHT + ROW_HEIGHT / 2;

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
  // 복원이 먼저다. 단언이 먼저 실패하면 fake timers·전역 스텁이 다음 테스트로 새어 나간다.
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
  expect(errorCalls).toEqual([]);
  expect(warnCalls).toEqual([]);
  // 모듈 수준 카운터가 새면 다음 테스트와 전역 단축키(되돌리기·삭제)로 번진다.
  expect(hasOpenPopover()).toBe(false);
  expect(hasActiveGesture()).toBe(false);
  expect(hasOpenModal()).toBe(false);
});

// ---------------------------------------------------------------------------
// 마운트와 DOM 도우미
// ---------------------------------------------------------------------------

type Mounted = ReturnType<typeof mount>;

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

function start(options: FakeDepsOptions = {}, strict = false): Mounted {
  const h = mount(createFakeDeps(options), { strict });
  stubLanes(h.studio().song.bars);
  return h;
}

function stubLanes(bars: number) {
  for (const lane of screen.getAllByTestId(/^track-lane-/)) {
    stubLaneRect(lane, {
      left: LANE_LEFT,
      width: bars * PX_PER_BAR,
      height: 56,
    });
  }
}

/** 모달이 열린 뒤 격자·세기 막대 영역의 화면 사각형을 고정한다(jsdom은 레이아웃이 없다). */
function stubRoll(clipLength: number) {
  stubLaneRect(screen.getByTestId("roll-grid"), {
    left: GL,
    top: GT,
    width: clipLength / 5,
    height: 61 * ROW_HEIGHT, // 피아노 36~96
  });
  stubLaneRect(screen.getByTestId("roll-velocity-bars"), {
    left: 0,
    top: LT,
    width: clipLength / 5,
    height: VELOCITY_LANE_HEIGHT,
  });
}

const tile = (clipId: string) => screen.getByTestId(`clip-${clipId}`);
const body = (clipId: string) =>
  tile(clipId).querySelector("button[aria-pressed]") as HTMLElement;
const lane = (trackId: string) => screen.getByTestId(`track-lane-${trackId}`);
const roll = () => screen.getByRole("dialog", { name: "피아노롤" });
const queryRoll = () => screen.queryByRole("dialog", { name: "피아노롤" });
const scroll = () => screen.getByTestId("roll-scroll");
const grid = () => screen.getByTestId("roll-grid");

function wrap(key: string): HTMLElement {
  const el = grid().querySelector<HTMLElement>(`[data-note-key="${key}"]`);
  if (!el) throw new Error(`음 ${key}이 없다`);
  return el;
}
const noteBody = (key: string) => wrap(key).querySelector("button")!;
const noteHandle = (key: string) =>
  within(wrap(key)).getByRole("separator", { name: "음 길이 조절" });
function slider(key: string): HTMLElement {
  const el = screen
    .getByTestId("roll-velocity-bars")
    .querySelector<HTMLElement>(`[data-velocity-key="${key}"]`);
  if (!el) throw new Error(`막대 ${key}가 없다`);
  return el;
}
/** 격자에 그려진 음의 키(DOM 순서). */
function domKeys(): string[] {
  return [...grid().querySelectorAll("[data-note-key]")].map(
    (el) => el.getAttribute("data-note-key")!,
  );
}
/** 격자에서 선택된(`aria-pressed`) 음의 키. */
function selectedKeys(): string[] {
  return [...grid().querySelectorAll('button[aria-pressed="true"]')].map(
    (b) => b.closest("[data-note-key]")!.getAttribute("data-note-key")!,
  );
}

function pointerClick(el: Element, x = 0, shiftKey = false) {
  firePointer(el, "pointerdown", { clientX: x, shiftKey });
  firePointer(el, "pointerup", { clientX: x, shiftKey });
}
function ctrlZ(target: Element = document.body) {
  fireEvent.keyDown(target, { key: "z", code: "KeyZ", ctrlKey: true });
}
async function pressSpace(target: Element = scroll()) {
  await act(async () => {
    fireEvent.keyDown(target, { key: " ", code: "Space" });
  });
}
function press(key: string, init: KeyboardEventInit = {}) {
  return fireEvent.keyDown(scroll(), { key, ...init });
}

/** 격자 빈 곳 클릭(음 추가). 칸의 시작으로 내려 추가한다. */
function clickGrid(tick: number, pitch: number) {
  const o = { clientX: gx(tick), clientY: gy(pitch) };
  firePointer(grid(), "pointerdown", o);
  firePointer(grid(), "pointerup", o);
}

/** 데모 곡의 첫 피아노 패턴 클립을 눌러 팝오버에서 "음으로 바꾸기" → 모달이 열린다. */
function bakeAndOpen(clipId = CLIP0, clipLength = 2 * BAR) {
  pointerClick(body(clipId));
  const popover = screen.getByRole("dialog", { name: "패턴 선택" });
  fireEvent.click(within(popover).getByRole("button", { name: "음으로 바꾸기" }));
  stubRoll(clipLength);
}

// ---------------------------------------------------------------------------
// 곡·이벤트 도우미
// ---------------------------------------------------------------------------

function lastSong(fake: FakeDeps): Song {
  const songs = acceptedSongs(fake.engine);
  return songs[songs.length - 1];
}

function pianoEvents(song: Song): ScheduledNote[] {
  return expandSong(song).find((t) => t.instrument === "piano")!.events;
}

const ev = (
  tick: number,
  length: number,
  pitch: number,
  velocity: number,
): ScheduledNote => ({ tick, length, pitch, velocity });

const evKey = (e: ScheduledNote) =>
  `${e.tick}:${e.length}:${e.pitch}:${e.velocity}`;

/** 기준 이벤트 대비 늘어난 것·사라진 것(다중집합 차이, 순서 무관). */
function diffEvents(base: ScheduledNote[], now: ScheduledNote[]) {
  const pool = new Map<string, { e: ScheduledNote; n: number }>();
  for (const e of base) {
    const entry = pool.get(evKey(e));
    if (entry) entry.n++;
    else pool.set(evKey(e), { e, n: 1 });
  }
  const added: ScheduledNote[] = [];
  for (const e of now) {
    const entry = pool.get(evKey(e));
    if (entry && entry.n > 0) entry.n--;
    else added.push(e);
  }
  const removed: ScheduledNote[] = [];
  for (const { e, n } of pool.values()) {
    for (let i = 0; i < n; i++) removed.push(e);
  }
  return { added, removed };
}

function notesOf(song: Song, clipId: string, trackId = PIANO): Note[] {
  const clip = song.tracks
    .find((t) => t.id === trackId)!
    .clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`클립 ${clipId}이 없다`);
  return clip.body.type === "notes" ? clip.body.notes : [];
}

function clipBodyType(song: Song, clipId: string) {
  return song.tracks
    .find((t) => t.id === PIANO)!
    .clips.find((c) => c.id === clipId)?.body.type;
}

// ---------------------------------------------------------------------------
// 편집 단계(시나리오 2·3·6이 공유)
// ---------------------------------------------------------------------------

interface Step {
  name: string;
  run(): void;
  /** 이 단계 뒤, 굽기 직후 기준 피아노 이벤트에서 **늘어난** 것(곡 시작 기준 틱). 사라진 것은 없어야 한다. */
  added: ScheduledNote[];
  /** 이 단계 뒤 격자에서 선택된 음. */
  selected: string[];
}

/**
 * 굽기 직후(piano-0은 곡 틱 0부터라 클립 틱 = 곡 틱)의 모달에서 이어서 하는 8단계. 값은 손계산:
 *
 * 1. 클릭 (1000틱, 90) → 칸 240틱: floor(1000/240)·240 = 960, 길이 240, 세기 0.8.
 * 2. 본문 드래그 Δx +96px = +480틱(round(480/240)·240), Δy −40px → 반음 +2 → (1440, 92).
 * 3. 핸들 드래그 Δx +48px = +240틱 → 길이 480(상한은 3840 − 1440 = 2400이라 걸리지 않는다).
 * 4. 세기 막대: y 40 → 20 → 1 − 20/80 = 0.75.
 * 5. → : +240틱, 6. Shift+↓ : −12반음, 7. Alt+→ : 길이 +240, 8. Delete.
 */
function editSteps(h: Mounted): Step[] {
  return [
    {
      name: "빈 곳 클릭으로 음 추가",
      run: () => clickGrid(1000, 90),
      added: [ev(960, 240, 90, 0.8)],
      selected: ["960:90"],
    },
    {
      name: "본문 드래그로 이동",
      run: () => {
        const before = h.studio().song;
        const el = noteBody("960:90");
        const x = gx(960) + 20;
        firePointer(el, "pointerdown", { clientX: x, clientY: gy(90) });
        firePointer(el, "pointermove", { clientX: x + 96, clientY: gy(90) - 40 });
        // 미리보기 중에는 곡이 그대로이고 음만 미리보기 위치에 그려진다.
        expect(h.studio().song).toBe(before);
        expect(wrap("960:90").getAttribute("data-dragging")).toBe("true");
        firePointer(el, "pointerup", { clientX: x + 96, clientY: gy(90) - 40 });
      },
      added: [ev(1440, 240, 92, 0.8)],
      selected: ["1440:92"],
    },
    {
      name: "길이 핸들 드래그",
      run: () => {
        const el = noteHandle("1440:92");
        const x = gx(1440) + 44;
        firePointer(el, "pointerdown", { clientX: x, clientY: gy(92) });
        firePointer(el, "pointermove", { clientX: x + 48, clientY: gy(92) });
        firePointer(el, "pointerup", { clientX: x + 48, clientY: gy(92) });
      },
      added: [ev(1440, 480, 92, 0.8)],
      selected: ["1440:92"],
    },
    {
      name: "세기 막대 드래그",
      run: () => {
        const fill = slider("1440:92").firstElementChild!;
        firePointer(fill, "pointerdown", { clientX: 10, clientY: LT + 40 });
        firePointer(fill, "pointermove", { clientX: 10, clientY: LT + 20 });
        firePointer(fill, "pointerup", { clientX: 10, clientY: LT + 20 });
        expect(slider("1440:92").getAttribute("aria-valuenow")).toBe("75");
      },
      added: [ev(1440, 480, 92, 0.75)],
      selected: ["1440:92"],
    },
    {
      name: "→ 키로 한 칸 이동",
      run: () => {
        press("ArrowRight");
      },
      added: [ev(1680, 480, 92, 0.75)],
      selected: ["1680:92"],
    },
    {
      name: "Shift+↓ 키로 한 옥타브 내림",
      run: () => {
        press("ArrowDown", { shiftKey: true });
      },
      added: [ev(1680, 480, 80, 0.75)],
      selected: ["1680:80"],
    },
    {
      name: "Alt+→ 키로 길이 한 칸 늘림",
      run: () => {
        press("ArrowRight", { altKey: true });
      },
      added: [ev(1680, 720, 80, 0.75)],
      selected: ["1680:80"],
    },
    {
      name: "Delete 키로 음 삭제",
      run: () => {
        press("Delete");
      },
      added: [],
      selected: [],
    },
  ];
}

// ===========================================================================

describe("1. 굽기: 데모 피아노 패턴 클립 → 팝오버 → 모달", () => {
  it("모달이 열리고 안내가 뜨며, 굽기 전후 엔진이 받은 곡의 expandSong이 같다", () => {
    const h = start();
    const before = lastSong(h.fake);
    expect(before).toBe(h.studio().song);
    const beforeEvents = expandSong(before);

    bakeAndOpen();

    expect(roll()).toBeTruthy();
    expect(hasOpenModal()).toBe(true);
    expect(within(roll()).getByText(CLIP_BAKED)).toBeTruthy();
    expect(h.studio().message).toBe(CLIP_BAKED);
    // 팝오버는 닫히고 모달만 남는다.
    expect(screen.queryByRole("dialog", { name: "패턴 선택" })).toBeNull();

    const after = lastSong(h.fake);
    expect(after).toBe(h.studio().song);
    expect(after).not.toBe(before);
    expect(clipBodyType(after, CLIP0)).toBe("notes");
    // 다른 클립·트랙은 그대로 패턴이다.
    expect(clipBodyType(after, CLIP1)).toBe("pattern");
    expect(after.tracks[1].clips.every((c) => c.body.type === "pattern")).toBe(true);
    // 굽기 전후의 재생 결과가 같다(트랙 전체, 이벤트 하나하나).
    expect(expandSong(after)).toEqual(beforeEvents);

    // 손계산: 8분 아르페지오(0,1,2,1,0,1,2,1 도수), C 코드 → 60,64,67,64,60,64,67,64, 두 마디(16음).
    const notes = notesOf(after, CLIP0);
    expect(notes).toHaveLength(16);
    expect(notes[0]).toEqual({ start: 0, length: 240, pitch: 60, velocity: 0.6 });
    expect(notes.slice(0, 8).map((n) => n.pitch)).toEqual([
      60, 64, 67, 64, 60, 64, 67, 64,
    ]);
    expect(notes.slice(0, 8).map((n) => n.start)).toEqual([
      0, 240, 480, 720, 960, 1200, 1440, 1680,
    ]);
    // 모달 제목과 격자에 음이 그려진다.
    expect(
      within(roll()).getByRole("heading", { name: "피아노 · 1~2마디" }),
    ).toBeTruthy();
    expect(domKeys()).toHaveLength(16);
  });

  it("코드가 바뀌는 둘째 클립(Am)을 굽고 나서도 곡 전체 expandSong이 굽기 전과 같다", () => {
    const h = start();
    const original = expandSong(lastSong(h.fake));

    bakeAndOpen();
    fireEvent.click(within(roll()).getByRole("button", { name: "← 돌아가기" }));
    expect(queryRoll()).toBeNull();
    bakeAndOpen(CLIP1);
    fireEvent.click(within(roll()).getByRole("button", { name: "← 돌아가기" }));

    const after = lastSong(h.fake);
    expect(clipBodyType(after, CLIP0)).toBe("notes");
    expect(clipBodyType(after, CLIP1)).toBe("notes");
    expect(clipBodyType(after, "piano-2")).toBe("pattern");
    expect(expandSong(after)).toEqual(original);
    // Am 클립의 음은 C 클립과 다른 높이다(코드 진행으로 펼친 결과가 구워졌다).
    expect(notesOf(after, CLIP1).map((n) => n.pitch)).not.toEqual(
      notesOf(after, CLIP0).map((n) => n.pitch),
    );
  });
});

describe("2. 모달에서 음을 편집하면 엔진이 받는 곡에 반영된다", () => {
  it("추가 → 이동 → 길이 → 세기 → 키보드 이동·옥타브·길이 → 삭제, 단계마다 expandSong 피아노 이벤트가 맞다", () => {
    const h = start();
    bakeAndOpen();
    const baseline = pianoEvents(lastSong(h.fake));
    // 피아노 네 클립 × 두 마디 × 8음 = 64(첫 클립만 구워졌을 뿐 곡 전체 이벤트 수는 그대로).
    expect(baseline).toHaveLength(64);

    for (const step of editSteps(h)) {
      step.run();
      const song = lastSong(h.fake);
      expect(song, `${step.name}: 엔진이 받은 곡이 화면의 곡`).toBe(h.studio().song);
      expect(
        diffEvents(baseline, pianoEvents(song)),
        `${step.name}: 이벤트 변화`,
      ).toEqual({ added: step.added, removed: [] });
      expect(selectedKeys(), `${step.name}: 선택`).toEqual(step.selected);
      // 격자의 음 = 곡의 음.
      expect(
        domKeys().sort(),
        `${step.name}: 격자의 음`,
      ).toEqual(notesOf(song, CLIP0).map((n) => `${n.start}:${n.pitch}`).sort());
    }

    // 삭제까지 마치면 굽기 직후와 같은 이벤트다.
    expect(pianoEvents(lastSong(h.fake))).toEqual(baseline);
    // 편집은 피아노 이외의 트랙을 건드리지 않는다.
    const demoEvents = expandSong(buildDemoSong());
    expect(expandSong(lastSong(h.fake)).slice(1)).toEqual(demoEvents.slice(1));
  }, 20000);

  it("추가한 음의 접근 가능한 이름은 곡 기준 마디·박과 길이를 말한다", () => {
    start();
    bakeAndOpen();
    clickGrid(1000, 90);
    // 960틱 = 1마디 3박, 90 = F#6, 240틱 = 온음의 1/8.
    const note = within(grid()).getByRole("button", {
      name: "F#6, 1마디 3박, 길이 1/8",
    });
    expect(note.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("3. Ctrl+Z로 한 단계씩 복구한다", () => {
  it("굽기 + 편집 8단계를 Ctrl+Z 9번으로 하나씩 되돌리고, 마지막(굽기)에서 모달이 닫힌다", () => {
    const h = start();
    const songs: Song[] = [h.studio().song];
    bakeAndOpen();
    songs.push(h.studio().song);
    for (const step of editSteps(h)) {
      step.run();
      songs.push(h.studio().song);
    }
    // 단계마다 곡이 새 객체다(편집 9번 = 히스토리 9칸).
    expect(songs).toHaveLength(10);
    expect(new Set(songs).size).toBe(10);

    for (let i = songs.length - 1; i >= 1; i--) {
      expect(h.studio().song, `되돌리기 전 #${i}`).toBe(songs[i]);
      ctrlZ(i === 1 ? document.body : scroll());
      expect(h.studio().song, `되돌린 뒤 #${i - 1}`).toBe(songs[i - 1]);
      expect(lastSong(h.fake), `엔진 #${i - 1}`).toBe(songs[i - 1]);
      if (i > 1) {
        // 모달은 열린 채이고 격자는 되돌린 곡의 음을 그린다.
        expect(queryRoll()).toBeTruthy();
        expect(domKeys().sort()).toEqual(
          notesOf(songs[i - 1], CLIP0)
            .map((n) => `${n.start}:${n.pitch}`)
            .sort(),
        );
      }
    }
    // 마지막 되돌리기는 굽기를 취소해 클립이 패턴으로 돌아오므로 모달이 닫힌다.
    expect(h.studio().song).toBe(songs[0]);
    expect(h.studio().song).toEqual(buildDemoSong());
    expect(h.studio().canUndo).toBe(false);
    expect(queryRoll()).toBeNull();
    expect(hasOpenModal()).toBe(false);
    expect(clipBodyType(h.studio().song, CLIP0)).toBe("pattern");
  }, 20000);
});

describe("4. 모달에서 Space로 재생하면 편집이 막힌다", () => {
  it("대기 중·재생 중에는 알림과 함께 마우스·키보드 편집이 무시되고, 정지하면 다시 된다", async () => {
    const h = start({ playMode: "manual" });
    bakeAndOpen();
    clickGrid(1000, 90);
    const edited = h.studio().song;
    expect(selectedKeys()).toEqual(["960:90"]);
    const baseline = pianoEvents(bakeClipToNotes(buildDemoSong(), PIANO, CLIP0));

    // 시작: 엔진의 play()가 끝나기를 기다리는 동안(pending).
    await pressSpace();
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);
    expect(h.studio().pending).toBe(true);
    expect(h.studio().editable).toBe(false);
    expect(queryRoll()).toBeTruthy();
    expect(
      within(screen.getByTestId("roll-message-strip")).getByText(LOADING),
    ).toBeTruthy();
    expect(noteBody("960:90").getAttribute("aria-disabled")).toBe("true");
    expect(noteHandle("960:90").getAttribute("aria-disabled")).toBe("true");

    clickGrid(2000, 80); // 빈 곳 클릭
    press("ArrowRight");
    press("Delete");
    ctrlZ(scroll());
    expect(h.studio().song).toBe(edited);

    // 재생 중.
    await act(async () => h.fake.resolvePlay({ status: "playing" }));
    expect(h.studio().playing).toBe(true);
    expect(queryRoll()).toBeTruthy();
    expect(
      within(screen.getByTestId("roll-message-strip")).getByText(READ_ONLY),
    ).toBeTruthy();

    clickGrid(2000, 80);
    // 음 드래그·핸들·세기 막대·키보드 모두 무시된다.
    const el = noteBody("960:90");
    firePointer(el, "pointerdown", { clientX: gx(960) + 20, clientY: gy(90) });
    firePointer(el, "pointermove", { clientX: gx(960) + 116, clientY: gy(90) });
    firePointer(el, "pointerup", { clientX: gx(960) + 116, clientY: gy(90) });
    const fill = slider("960:90").firstElementChild!;
    firePointer(fill, "pointerdown", { clientX: 10, clientY: LT + 40 });
    firePointer(fill, "pointermove", { clientX: 10, clientY: LT + 10 });
    firePointer(fill, "pointerup", { clientX: 10, clientY: LT + 10 });
    fireEvent.keyDown(slider("960:90"), { key: "ArrowUp" });
    press("ArrowRight");
    press("ArrowUp", { shiftKey: true });
    press("ArrowRight", { altKey: true });
    press("Delete");
    ctrlZ(scroll());
    expect(h.studio().song).toBe(edited);
    expect(h.fake.engine.play).toHaveBeenCalledTimes(1);

    // 정지: 최신 곡이 엔진에 다시 맞춰지고 편집이 돌아온다.
    await pressSpace();
    expect(h.fake.engine.stop).toHaveBeenCalledTimes(1);
    expect(h.studio().playing).toBe(false);
    expect(h.studio().editable).toBe(true);
    expect(lastSong(h.fake)).toBe(h.studio().song);
    expect(queryRoll()).toBeTruthy();
    expect(noteBody("960:90").getAttribute("aria-disabled")).toBeNull();
    expect(selectedKeys()).toEqual(["960:90"]); // 모달의 선택은 재생을 거쳐도 남는다

    press("ArrowRight"); // 960 → 1200
    expect(
      diffEvents(baseline, pianoEvents(lastSong(h.fake))),
    ).toEqual({ added: [ev(1200, 240, 90, 0.8)], removed: [] });
    expect(selectedKeys()).toEqual(["1200:90"]);
  });
});

describe("5. 모달 닫기와 클립 소멸", () => {
  it("← 돌아가기로 닫으면 곡 화면의 선택과 곡이 유지되고, 다시 열면 음이 그대로다", () => {
    const h = start();
    bakeAndOpen();
    clickGrid(1000, 90);
    const edited = h.studio().song;

    fireEvent.click(within(roll()).getByRole("button", { name: "← 돌아가기" }));
    expect(queryRoll()).toBeNull();
    expect(hasOpenModal()).toBe(false);
    expect(h.studio().song).toBe(edited);
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: CLIP0 });
    expect(tile(CLIP0).getAttribute("data-selected")).toBe("true");
    expect(lastSong(h.fake)).toBe(edited);
    expect(notesOf(edited, CLIP0)).toHaveLength(17);

    // 선택된 음 클립의 "음 편집" 버튼으로 다시 연다. 음 선택은 모달의 지역 상태라 초기화된다.
    fireEvent.click(within(tile(CLIP0)).getByRole("button", { name: "음 편집" }));
    stubRoll(2 * BAR);
    expect(roll()).toBeTruthy();
    expect(domKeys()).toHaveLength(17);
    expect(wrap("960:90")).toBeTruthy();
    expect(selectedKeys()).toEqual([]);
    // 포커스가 열린 모달 안으로 옮겨져 있다.
    expect(roll().contains(document.activeElement)).toBe(true);
  });

  it("되돌리기로 클립이 패턴으로 돌아가면 모달이 저절로 닫힌다", () => {
    const h = start();
    bakeAndOpen();
    clickGrid(1000, 90);
    expect(domKeys()).toContain("960:90");

    ctrlZ(scroll()); // 음 추가를 되돌린다 — 모달은 열린 채다
    expect(queryRoll()).toBeTruthy();
    expect(domKeys()).not.toContain("960:90");
    expect(hasOpenModal()).toBe(true);

    ctrlZ(scroll()); // 굽기를 되돌린다 — 클립이 다시 패턴이 된다
    expect(clipBodyType(h.studio().song, CLIP0)).toBe("pattern");
    expect(queryRoll()).toBeNull();
    expect(hasOpenModal()).toBe(false);
    expect(screen.queryByRole("button", { name: "음 편집" })).toBeNull();
    expect(lastSong(h.fake)).toBe(h.studio().song);
  });
});

describe("6. 자동 저장과 복원", () => {
  it("300ms 뒤 저장소의 곡이 loadSong 왕복과 같고, 다시 마운트하면 음 클립이 복원된다", () => {
    const first = start();
    bakeAndOpen();
    for (const step of editSteps(first).slice(0, 3)) step.run(); // 추가·이동·길이
    const edited = first.studio().song;
    const note = { start: 1440, length: 480, pitch: 92, velocity: 0.8 };
    expect(notesOf(edited, CLIP0)).toContainEqual(note);

    const storage = first.fake.storage!;
    act(() => vi.advanceTimersByTime(299));
    expect(storage.setItem).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    const loaded = loadSong(storage.data.get(AUTOSAVE_KEY) ?? null);
    expect(loaded.notice).toBeNull();
    expect(loaded.song).toEqual(edited);
    expect(notesOf(loaded.song, CLIP0)).toContainEqual(note);

    // 모달이 열린 채 새로고침: 모달은 복원되지 않고(UI 지역 상태), 곡은 복원된다.
    first.unmount();
    expect(hasOpenModal()).toBe(false);
    const writes = storage.setItem.mock.calls.length;

    const fresh = createFakeDeps();
    const second = mount({
      ...fresh,
      createDeps: () => ({ engine: fresh.engine, bank: fresh.bank, storage }),
    });
    stubLanes(second.studio().song.bars);
    expect(second.studio().song).toEqual(edited);
    expect(second.studio().canUndo).toBe(false);
    expect(queryRoll()).toBeNull();
    expect(lastSong(second.fake)).toEqual(edited);
    expect(
      diffEvents(
        pianoEvents(bakeClipToNotes(buildDemoSong(), PIANO, CLIP0)),
        pianoEvents(lastSong(second.fake)),
      ),
    ).toEqual({ added: [ev(1440, 480, 92, 0.8)], removed: [] });

    // 복원된 음 클립은 모달로 다시 열 수 있고 음이 그려진다.
    fireEvent.doubleClick(body(CLIP0));
    expect(
      within(grid()).getByRole("button", {
        name: "G#6, 1마디 4박, 길이 1/4",
      }),
    ).toBeTruthy();
    fireEvent.click(within(roll()).getByRole("button", { name: "← 돌아가기" }));

    // 복원은 저장을 다시 쓰지 않는다.
    act(() => vi.advanceTimersByTime(1000));
    expect(storage.setItem.mock.calls.length).toBe(writes);
  }, 20000);
});

describe("7. StrictMode", () => {
  it("모달을 열고 닫기를 되풀이해도 카운터가 균형을 이루고 편집이 정상이다", () => {
    const h = start({}, true);
    expect(hasOpenModal()).toBe(false);

    bakeAndOpen();
    expect(hasOpenModal()).toBe(true);
    fireEvent.click(within(roll()).getByRole("button", { name: "← 돌아가기" }));
    expect(queryRoll()).toBeNull();
    expect(hasOpenModal()).toBe(false);

    // 두 번째: 선택된 음 클립의 "음 편집" 버튼. 앞의 열기·닫기가 어긋났다면 여기서 드러난다.
    fireEvent.click(within(tile(CLIP0)).getByRole("button", { name: "음 편집" }));
    stubRoll(2 * BAR);
    expect(hasOpenModal()).toBe(true);

    const baseline = pianoEvents(lastSong(h.fake));
    clickGrid(1000, 90);
    expect(lastSong(h.fake)).toBe(h.studio().song);
    expect(diffEvents(baseline, pianoEvents(lastSong(h.fake)))).toEqual({
      added: [ev(960, 240, 90, 0.8)],
      removed: [],
    });
    press("ArrowRight");
    expect(diffEvents(baseline, pianoEvents(lastSong(h.fake)))).toEqual({
      added: [ev(1200, 240, 90, 0.8)],
      removed: [],
    });

    // Esc: 첫 번째는 음 선택, 두 번째는 모달 닫기.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(queryRoll()).toBeTruthy();
    expect(selectedKeys()).toEqual([]);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(queryRoll()).toBeNull();
    expect(hasOpenModal()).toBe(false);

    // 셋째 열기도 카운터가 맞다.
    fireEvent.doubleClick(body(CLIP0));
    expect(hasOpenModal()).toBe(true);
    fireEvent.click(within(roll()).getByRole("button", { name: "← 돌아가기" }));
    expect(hasOpenModal()).toBe(false);
  });
});

describe("8. 빈 트랙 칸 Shift+클릭 → 빈 음 클립 → 편집 버튼 → 음 추가", () => {
  it("빈 음 클립을 만들고 선택한 뒤, 음 편집 버튼으로 열어 음을 추가한다", () => {
    const h = start();
    // 데모의 피아노 클립은 8마디를 다 덮는다. 마디를 하나 늘려 빈 칸(9마디째)을 만든다.
    fireEvent.click(screen.getByRole("button", { name: "마디 추가" }));
    expect(h.studio().song.bars).toBe(9);
    stubLanes(9);
    const idsBefore = h.studio().song.tracks[0].clips.map((c) => c.id);

    pointerClick(lane(PIANO), xAt(8 * BAR + 240), true);

    const clips = h.studio().song.tracks[0].clips;
    expect(clips).toHaveLength(idsBefore.length + 1);
    const added = clips.find((c) => !idsBefore.includes(c.id))!;
    expect(added.start).toBe(8 * BAR);
    expect(added.length).toBe(BAR);
    expect(added.body).toEqual({ type: "notes", notes: [] });
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: added.id });
    expect(queryRoll()).toBeNull(); // 모달은 열지 않는다

    fireEvent.click(
      within(tile(added.id)).getByRole("button", { name: "음 편집" }),
    );
    stubRoll(BAR);
    expect(
      within(roll()).getByRole("heading", { name: "피아노 · 9~9마디" }),
    ).toBeTruthy();
    expect(domKeys()).toEqual([]);

    const baseline = pianoEvents(lastSong(h.fake));
    // 1500틱 → 칸 240틱의 6번째(1440), 72 = C5.
    clickGrid(1500, 72);
    expect(notesOf(h.studio().song, added.id)).toEqual([
      { start: 1440, length: 240, pitch: 72, velocity: 0.8 },
    ]);
    expect(lastSong(h.fake)).toBe(h.studio().song);
    // 곡 시작 기준 틱 = 클립 시작 15360 + 1440.
    expect(diffEvents(baseline, pianoEvents(lastSong(h.fake)))).toEqual({
      added: [ev(8 * BAR + 1440, 240, 72, 0.8)],
      removed: [],
    });
    expect(selectedKeys()).toEqual(["1440:72"]);
  });
});

describe("9. 모달이 열려 있는 동안 전역 키는 음 편집에 양보한다", () => {
  it("클립이 선택돼 있어도 Delete·Backspace는 음만 지우고 클립은 지우지 않으며, 닫으면 클립을 지운다", () => {
    const h = start();
    bakeAndOpen();
    const baked = h.studio().song;
    const baseline = pianoEvents(baked);
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: CLIP0 });

    // 음 하나를 추가해 선택한 채 전역(body)에서 Delete.
    clickGrid(1000, 90);
    expect(selectedKeys()).toEqual(["960:90"]);
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(clipBodyType(h.studio().song, CLIP0)).toBe("notes");
    expect(notesOf(h.studio().song, CLIP0)).toEqual(notesOf(baked, CLIP0));
    expect(diffEvents(baseline, pianoEvents(lastSong(h.fake)))).toEqual({
      added: [],
      removed: [],
    });
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: CLIP0 });
    expect(queryRoll()).toBeTruthy();

    // 선택한 음이 없으면 Delete는 아무 일도 하지 않는다(클립을 대신 지우지 않는다).
    const before = h.studio().song;
    fireEvent.keyDown(document.body, { key: "Delete" });
    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(h.studio().song).toBe(before);
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: CLIP0 });
    expect(queryRoll()).toBeTruthy();

    // Backspace도 같다.
    clickGrid(1000, 90);
    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(clipBodyType(h.studio().song, CLIP0)).toBe("notes");
    expect(notesOf(h.studio().song, CLIP0)).toHaveLength(16);

    // 모달을 닫으면(클립 선택은 남는다) 같은 Delete가 선택한 클립을 지운다.
    fireEvent.click(within(roll()).getByRole("button", { name: "← 돌아가기" }));
    expect(queryRoll()).toBeNull();
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: CLIP0 });
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(screen.queryByTestId(`clip-${CLIP0}`)).toBeNull();
    expect(
      h.studio().song.tracks[0].clips.some((c) => c.id === CLIP0),
    ).toBe(false);
  });

  it("Esc는 한 번에 한 겹이다: 음 선택 해제 → 모달 닫기 → 클립 선택 해제", () => {
    const h = start();
    bakeAndOpen();
    clickGrid(1000, 90);
    expect(selectedKeys()).toEqual(["960:90"]);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(selectedKeys()).toEqual([]);
    expect(queryRoll()).toBeTruthy();
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: CLIP0 });

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(queryRoll()).toBeNull();
    expect(h.studio().selection).toEqual({ trackId: PIANO, clipId: CLIP0 });

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(h.studio().selection).toBeNull();
  });
});

describe("10. 서버 렌더·하이드레이션", () => {
  it("renderToString은 모달을 그리지 않고 기존처럼 통과한다", () => {
    const stored = bakeClipToNotes(buildDemoSong(), PIANO, CLIP0);
    const fake = createFakeDeps({
      stored: { [AUTOSAVE_KEY]: serializeSong(stored) },
    });
    const html = renderToString(
      <StudioProvider createDeps={fake.createDeps}>
        <Studio />
      </StudioProvider>,
    );
    for (const label of ["C", "Am", "F", "G7"]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html.match(/data-testid="track-lane-/g)).toHaveLength(4);
    expect(html).not.toContain("피아노롤");
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain('data-testid="roll-');
    expect(html).not.toContain("음 편집");
    // 서버 렌더는 effect를 돌리지 않으므로 저장소는 읽히지 않는다.
    expect(fake.storage!.getItem).not.toHaveBeenCalled();
    expect(hasOpenModal()).toBe(false);
  });

  it("하이드레이트해도 경고가 없고 모달은 닫혀 있으며, 복원된 음 클립을 열 수 있다", async () => {
    const stored = bakeClipToNotes(buildDemoSong(), PIANO, CLIP0);
    const options = { stored: { [AUTOSAVE_KEY]: serializeSong(stored) } };
    const html = renderToString(
      <StudioProvider createDeps={createFakeDeps(options).createDeps}>
        <Studio />
      </StudioProvider>,
    );
    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = html;
    let root: ReturnType<typeof hydrateRoot> | null = null;
    try {
      await act(async () => {
        root = hydrateRoot(
          container,
          <StudioProvider createDeps={createFakeDeps(options).createDeps}>
            <Studio />
          </StudioProvider>,
        );
      });
      expect(queryRoll()).toBeNull();
      // 마운트 뒤 복원: piano-0은 음 클립이다 → 더블클릭으로 연다.
      const button = within(container)
        .getByTestId(`clip-${CLIP0}`)
        .querySelector("button[aria-pressed]") as HTMLElement;
      fireEvent.doubleClick(button);
      expect(roll()).toBeTruthy();
      expect(hasOpenModal()).toBe(true);
      expect(domKeys()).toHaveLength(16);
      fireEvent.click(within(roll()).getByRole("button", { name: "← 돌아가기" }));
      expect(queryRoll()).toBeNull();
    } finally {
      act(() => (root as ReturnType<typeof hydrateRoot> | null)?.unmount());
      container.remove();
    }
  });
});
