import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_TEMPO, MIN_TEMPO } from "@/lib/score/model";
import { acceptedSongs } from "@/state/testing/fake-deps";

import { TopBar } from "./TopBar";
import {
  installAudioContextStub,
  removeAudioContextStub,
  renderWithStudio,
} from "./testing/harness";

let restoreAudio: () => void;

beforeEach(() => {
  restoreAudio = installAudioContextStub();
  // 재생 중에는 10Hz 위치 표본 타이머가 돈다. 가짜로 막아 act 밖 갱신을 없앤다.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  restoreAudio();
});

const playButton = () => screen.getByRole("button", { name: "재생" });
const stopButton = () => screen.getByRole("button", { name: "정지" });
const undoButton = () => screen.getByRole("button", { name: "되돌리기" });

async function clickPlay() {
  await act(async () => {
    fireEvent.click(playButton());
  });
}

describe("TopBar 재생·정지", () => {
  it("멈춘 상태: 재생 버튼만 있고 활성이며 안내문이 없다", () => {
    renderWithStudio(<TopBar />);
    expect(playButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: "정지" })).toBeNull();
    expect(screen.queryByText("재생 중에는 편집할 수 없습니다")).toBeNull();
    expect(screen.queryByText("샘플을 불러오는 중…")).toBeNull();
  });

  it("재생을 누르면 엔진 play를 부르고 정지 버튼과 편집 불가 안내로 바뀐다", async () => {
    const { fake } = renderWithStudio(<TopBar />);
    await clickPlay();

    expect(fake.engine.play).toHaveBeenCalledTimes(1);
    expect(stopButton()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "재생" })).toBeNull();
    expect(screen.getByText("재생 중에는 편집할 수 없습니다")).toBeTruthy();
  });

  it("정지를 누르면 엔진 stop을 부르고 재생 버튼으로 돌아온다", async () => {
    const { fake } = renderWithStudio(<TopBar />);
    await clickPlay();
    act(() => {
      fireEvent.click(stopButton());
    });

    expect(fake.engine.stop).toHaveBeenCalledTimes(1);
    expect(playButton()).toBeTruthy();
    expect(screen.queryByText("재생 중에는 편집할 수 없습니다")).toBeNull();
  });

  it("시작 대기 중: 재생 버튼 대신 정지 버튼 하나만 보이고(재생은 없다), play는 한 번뿐이다", async () => {
    const { fake } = renderWithStudio(<TopBar />, { playMode: "manual" });
    await clickPlay();

    expect(stopButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: "재생" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /재생|정지/ })).toHaveLength(1);
    expect(screen.getByText("샘플을 불러오는 중…")).toBeTruthy();
    expect(screen.queryByText("재생 중에는 편집할 수 없습니다")).toBeNull();
    expect(fake.engine.play).toHaveBeenCalledTimes(1);

    await act(async () => {
      fake.resolvePlay({ status: "playing" });
    });
    expect(stopButton()).toBeTruthy();
    expect(screen.queryByText("샘플을 불러오는 중…")).toBeNull();
    expect(fake.engine.play).toHaveBeenCalledTimes(1);
  });

  it("시작 대기 중 정지를 누르면 엔진 stop이 한 번 불리고 재생 버튼으로 돌아오며, 늦게 온 playing 결과는 무시된다", async () => {
    const { fake, studio } = renderWithStudio(<TopBar />, { playMode: "manual" });
    await clickPlay();
    expect(studio().pending).toBe(true);

    act(() => {
      fireEvent.click(stopButton());
    });
    expect(fake.engine.stop).toHaveBeenCalledTimes(1);
    expect(studio().pending).toBe(false);
    expect(studio().editable).toBe(true);
    expect(playButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: "정지" })).toBeNull();
    expect(screen.queryByText("샘플을 불러오는 중…")).toBeNull();

    // 옛 play()가 뒤늦게 playing으로 끝나도(가짜 엔진은 강제하지 않는다) 화면은 정지 상태다.
    await act(async () => {
      fake.resolvePlay({ status: "playing" });
    });
    expect(studio().playing).toBe(false);
    expect(playButton()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "정지" })).toBeNull();
    expect(fake.engine.play).toHaveBeenCalledTimes(1);
  });

  it("not-ready로 돌아오면 재생 버튼이 돌아오고 이유가 메시지 줄에 보인다", async () => {
    renderWithStudio(<TopBar />, {
      playMode: { status: "not-ready", failed: ["piano"] },
      statuses: { piano: "error" },
    });
    await clickPlay();

    expect(screen.queryByRole("button", { name: "정지" })).toBeNull();
    expect(
      within(screen.getByRole("alert")).getByText(/재생하지 않았습니다.*피아노/),
    ).toBeTruthy();
  });

  it("Web Audio를 지원하지 않으면 경고를 보이고 재생을 비활성화한다", () => {
    removeAudioContextStub();
    const { fake } = renderWithStudio(<TopBar />);

    expect(screen.getByRole("alert").textContent).toContain(
      "Web Audio를 지원하지 않습니다",
    );
    expect(playButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(playButton());
    expect(fake.engine.play).not.toHaveBeenCalled();
  });

  it("지원하는 브라우저에는 경고가 없다", () => {
    renderWithStudio(<TopBar />);
    expect(screen.queryByText(/Web Audio를 지원하지 않습니다/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("TopBar 위치·템포·메트로놈", () => {
  it("위치를 N마디 · M박으로 보이고 숫자는 고정폭이다", () => {
    renderWithStudio(<TopBar />);
    const el = screen.getByText("1마디 · 1박");
    expect(el.className).toContain("font-mono");
    expect(el.className).toContain("tabular-nums");
  });

  it("템포 슬라이더는 범위가 있고 값을 바꾸면 엔진 템포와 표시가 바뀐다", () => {
    const { fake, studio } = renderWithStudio(<TopBar />);
    const slider = screen.getByLabelText("템포") as HTMLInputElement;
    const initial = studio().song.tempo;

    expect(slider.min).toBe(String(MIN_TEMPO));
    expect(slider.max).toBe(String(MAX_TEMPO));
    expect(slider.value).toBe(String(initial));

    fireEvent.change(slider, { target: { value: "90" } });

    expect(fake.engine.setTempo).toHaveBeenCalledWith(90);
    expect((screen.getByLabelText("템포") as HTMLInputElement).value).toBe("90");
    const shown = screen.getByText("90 BPM");
    expect(shown.className).toContain("font-mono");
    expect(shown.className).toContain("tabular-nums");
  });

  it("재생 중에도 템포를 바꿀 수 있다", async () => {
    const { fake } = renderWithStudio(<TopBar />);
    await clickPlay();
    fireEvent.change(screen.getByLabelText("템포"), { target: { value: "150" } });
    expect(fake.engine.setTempo).toHaveBeenCalledWith(150);
  });

  it("메트로놈 체크박스가 엔진에 전달된다", () => {
    const { fake } = renderWithStudio(<TopBar />);
    const box = screen.getByLabelText("메트로놈") as HTMLInputElement;
    expect(box.checked).toBe(false);

    fireEvent.click(box);

    expect(fake.engine.setMetronome).toHaveBeenLastCalledWith(true);
    expect((screen.getByLabelText("메트로놈") as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(screen.getByLabelText("메트로놈"));
    expect(fake.engine.setMetronome).toHaveBeenLastCalledWith(false);
  });
});

describe("TopBar 되돌리기", () => {
  it("편집이 없으면 비활성이다", () => {
    renderWithStudio(<TopBar />);
    expect(undoButton().hasAttribute("disabled")).toBe(true);
  });

  it("편집 뒤에는 활성이고 누르면 이전 곡이 엔진에 닿는다", () => {
    const { fake, studio } = renderWithStudio(<TopBar />);
    const before = studio().song.bars;
    act(() => studio().edit.setBars(before + 1));
    expect(undoButton().hasAttribute("disabled")).toBe(false);
    expect(acceptedSongs(fake.engine).at(-1)?.bars).toBe(before + 1);

    fireEvent.click(undoButton());

    expect(acceptedSongs(fake.engine).at(-1)?.bars).toBe(before);
    expect(undoButton().hasAttribute("disabled")).toBe(true);
  });

  it("되돌릴 기록이 있어도 샘플 대기 중이나 재생 중에는 비활성이다", async () => {
    const { fake, studio } = renderWithStudio(<TopBar />, { playMode: "manual" });
    act(() => studio().edit.setBars(studio().song.bars + 1));
    expect(studio().canUndo).toBe(true);

    await clickPlay();
    expect(studio().canUndo).toBe(true);
    expect(undoButton().hasAttribute("disabled")).toBe(true);

    await act(async () => {
      fake.resolvePlay({ status: "playing" });
    });
    expect(studio().canUndo).toBe(true);
    expect(undoButton().hasAttribute("disabled")).toBe(true);
  });
});

describe("TopBar 샘플 상태", () => {
  it("악기별 상태를 문구로 보여 준다", () => {
    renderWithStudio(<TopBar />, {
      statuses: {
        piano: "ready",
        guitar: "loading",
        bass: "downloaded",
        drums: "idle",
      },
    });
    const row = (name: string) => screen.getByText(name).parentElement!.textContent;
    expect(row("피아노")).toContain("준비됨");
    expect(row("기타")).toContain("불러오는 중");
    expect(row("베이스")).toContain("받음 (재생 때 마무리)");
    expect(row("드럼")).toContain("대기");
  });

  it("실패한 악기에만 다시 시도 버튼이 있고 누르면 그 악기를 다시 받는다", () => {
    const { fake } = renderWithStudio(<TopBar />, { statuses: { bass: "error" } });
    expect(screen.getByText("베이스").parentElement?.textContent).toContain("실패");
    expect(screen.getAllByRole("button", { name: /다시 시도/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "베이스 다시 시도" }));

    expect(fake.bank.prefetch).toHaveBeenCalledWith(["bass"]);
  });

  it("실패한 악기가 없으면 다시 시도 버튼이 없다", () => {
    renderWithStudio(<TopBar />);
    expect(screen.queryByRole("button", { name: /다시 시도/ })).toBeNull();
  });

  it("샘플 상태가 바뀌면 화면이 따라간다", () => {
    const { fake } = renderWithStudio(<TopBar />, { statuses: { piano: "loading" } });
    expect(screen.getByText("피아노").parentElement?.textContent).toContain(
      "불러오는 중",
    );
    act(() => fake.bank.setStatuses({ piano: "ready" }));
    expect(screen.getByText("피아노").parentElement?.textContent).toContain(
      "준비됨",
    );
  });
});

describe("TopBar 메시지 줄", () => {
  it("메시지가 없으면 alert가 없다", () => {
    renderWithStudio(<TopBar />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("재생 시작 실패 메시지를 role=alert로 보이고 닫기 버튼으로 지운다", async () => {
    renderWithStudio(<TopBar />, { playMode: { reject: new Error("boom") } });
    await clickPlay();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("소리를 시작하지 못했습니다");

    fireEvent.click(within(alert).getByRole("button", { name: "메시지 닫기" }));

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("TopBar 안내 줄 자리 예약", () => {
  // jsdom은 레이아웃을 못 하므로 예약 높이 클래스를 고정한다. 안내가 나타나고 사라져도
  // 줄 높이가 같아야 본문이 밀리지 않는다.
  const strip = () => screen.getByTestId("message-strip");
  const RESERVED = /(^|\s)min-h-7(\s|$)/;

  it("아무 안내도 없을 때 줄은 비어 있어도 높이를 예약한다", () => {
    renderWithStudio(<TopBar />);
    expect(strip().className).toMatch(RESERVED);
    expect(strip().textContent).toBe("");
    expect(within(strip()).queryByRole("alert")).toBeNull();
    expect(within(strip()).queryByRole("status")).toBeNull();
  });

  it("재생 중 안내(role=status)가 같은 줄 안에 들어오고 예약 높이는 그대로다", async () => {
    renderWithStudio(<TopBar />);
    await clickPlay();
    const s = strip();
    expect(s.className).toMatch(RESERVED);
    expect(within(s).getByRole("status").textContent).toBe(
      "재생 중에는 편집할 수 없습니다",
    );
  });

  it("샘플 대기 안내도 같은 줄 안에서 예약 높이를 유지한다", async () => {
    renderWithStudio(<TopBar />, { playMode: "manual" });
    await clickPlay();
    expect(strip().className).toMatch(RESERVED);
    expect(within(strip()).getByRole("status").textContent).toBe(
      "샘플을 불러오는 중…",
    );
  });

  it("메시지(role=alert)가 떠도 예약 높이는 그대로이고 닫으면 줄이 비어도 유지된다", async () => {
    renderWithStudio(<TopBar />, { playMode: { reject: new Error("boom") } });
    await clickPlay();
    const s = strip();
    expect(s.className).toMatch(RESERVED);
    const alert = within(s).getByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "메시지 닫기" }));
    expect(within(s).queryByRole("alert")).toBeNull();
    expect(s.className).toMatch(RESERVED);
  });

  it("Web Audio 경고(role=alert)도 같은 줄 안에 있다", () => {
    removeAudioContextStub();
    renderWithStudio(<TopBar />);
    expect(within(strip()).getByRole("alert").textContent).toContain(
      "Web Audio를 지원하지 않습니다",
    );
    expect(strip().className).toMatch(RESERVED);
  });
});
