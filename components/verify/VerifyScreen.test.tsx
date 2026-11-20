import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VerifyScreen,
  type VerifyDeps,
} from "@/components/verify/VerifyScreen";
import type { PlayResult } from "@/lib/audio/engine";
import type { SampleStatus } from "@/lib/audio/samples/bank";
import { buildDemoSong, DEMO_BARS } from "@/lib/score/demo-song";
import type { InstrumentId } from "@/lib/score/model";
import { songLengthTicks, ticksToBarBeat } from "@/lib/score/time";

type Statuses = Record<InstrumentId, SampleStatus>;

function makeDeps(
  playResult: PlayResult,
  override: Partial<Statuses> = {},
): VerifyDeps {
  const snapshot: Statuses = {
    piano: "ready",
    guitar: "ready",
    bass: "ready",
    drums: "ready",
    ...override,
  };
  return {
    engine: {
      play: vi.fn(async () => playResult),
      stop: vi.fn(),
      setSong: vi.fn(() => true),
      setTempo: vi.fn(),
      setMetronome: vi.fn(),
      currentTick: vi.fn(() => 0),
      dispose: vi.fn(),
      onStop: null,
    },
    bank: {
      prefetch: vi.fn(),
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    },
  };
}

type WindowWithAudio = { AudioContext?: unknown };

beforeEach(() => {
  // jsdom에는 Web Audio가 없다. 지원하는 브라우저인 척한다.
  (window as unknown as WindowWithAudio).AudioContext = class {};
});

afterEach(() => {
  cleanup();
  delete (window as unknown as WindowWithAudio).AudioContext;
});

describe("VerifyScreen", () => {
  it("악기별 샘플 상태를 보여 준다", () => {
    const deps = makeDeps({ status: "playing" }, { drums: "loading", bass: "downloaded" });
    render(<VerifyScreen createDeps={() => deps} />);

    expect(screen.getByText("드럼").parentElement?.textContent).toContain("불러오는 중");
    expect(screen.getByText("베이스").parentElement?.textContent).toContain("받음");
    expect(screen.getByText("피아노").parentElement?.textContent).toContain("준비됨");
  });

  it("재생을 누르면 엔진을 부르고 정지 버튼으로 바뀐다", async () => {
    const deps = makeDeps({ status: "playing" });
    render(<VerifyScreen createDeps={() => deps} />);

    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(deps.engine.play).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "정지" })).toBeTruthy();
  });

  it("샘플이 준비되지 않아 시작하지 못하면 이유를 보여 주고 정지 상태로 남는다", async () => {
    const deps = makeDeps({ status: "not-ready", failed: ["piano"] }, { piano: "error" });
    render(<VerifyScreen createDeps={() => deps} />);

    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(await screen.findByText(/재생하지 않았습니다/)).toBeTruthy();
    expect(screen.getByText(/피아노/, { selector: "[role='alert']" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "재생" })).toBeTruthy();
  });

  it("실패한 악기에는 다시 시도 버튼이 있고 누르면 다시 받는다", () => {
    const deps = makeDeps({ status: "playing" }, { piano: "error" });
    render(<VerifyScreen createDeps={() => deps} />);

    fireEvent.click(screen.getByRole("button", { name: "피아노 다시 시도" }));

    expect(deps.bank.prefetch).toHaveBeenCalledWith(["piano"]);
  });

  it("준비된 악기에는 다시 시도 버튼이 없다", () => {
    render(<VerifyScreen createDeps={() => makeDeps({ status: "playing" })} />);
    expect(screen.queryByRole("button", { name: /다시 시도/ })).toBeNull();
  });

  it("템포를 바꾸면 곡의 템포와 엔진 템포를 함께 바꾼다", () => {
    const deps = makeDeps({ status: "playing" });
    render(<VerifyScreen createDeps={() => deps} />);

    fireEvent.change(screen.getByLabelText(/템포/), { target: { value: "90" } });

    expect(deps.engine.setTempo).toHaveBeenCalledWith(90);
    expect(deps.engine.setSong).toHaveBeenLastCalledWith(
      expect.objectContaining({ tempo: 90 }),
    );
  });

  it("메트로놈 토글을 엔진에 전달한다", () => {
    const deps = makeDeps({ status: "playing" });
    render(<VerifyScreen createDeps={() => deps} />);

    fireEvent.click(screen.getByLabelText("메트로놈"));

    expect(deps.engine.setMetronome).toHaveBeenCalledWith(true);
  });

  it("언마운트하면 엔진을 정리하고 자동 정지 콜백을 뗀다", () => {
    const deps = makeDeps({ status: "playing" });
    const { unmount } = render(<VerifyScreen createDeps={() => deps} />);
    expect(typeof deps.engine.onStop).toBe("function");

    unmount();

    expect(deps.engine.dispose).toHaveBeenCalled();
    expect(deps.engine.onStop).toBeNull();
  });

  describe("재생 상태는 play()가 playing으로 끝났을 때만 켜진다", () => {
    it("play()가 끝나기 전에는 정지 버튼을 보이지 않는다", async () => {
      const deps = makeDeps({ status: "playing" });
      let resolve: ((r: PlayResult) => void) | undefined;
      deps.engine.play = vi.fn(
        () => new Promise<PlayResult>((r) => (resolve = r)),
      );
      render(<VerifyScreen createDeps={() => deps} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "재생" }));
      });

      expect(deps.engine.play).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "정지" })).toBeNull();
      expect(screen.getByRole("button", { name: "재생" })).toBeTruthy();

      await act(async () => resolve?.({ status: "playing" }));

      expect(screen.getByRole("button", { name: "정지" })).toBeTruthy();
    });

    it("play()가 거부되면 다시 누르라는 문구를 보이고 재생 버튼으로 남는다", async () => {
      const deps = makeDeps({ status: "playing" });
      deps.engine.play = vi.fn(() => Promise.reject(new Error("resume failed")));
      render(<VerifyScreen createDeps={() => deps} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "재생" }));
      });

      expect(screen.getByRole("alert").textContent).toBe(
        "소리를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.",
      );
      expect(screen.queryByRole("button", { name: "정지" })).toBeNull();
      expect(screen.getByRole("button", { name: "재생" })).toBeTruthy();
    });

    it.each(["superseded", "already-playing"] as const)(
      "%s이면 정지 버튼도 문구도 없다",
      async (status) => {
        const deps = makeDeps({ status });
        render(<VerifyScreen createDeps={() => deps} />);

        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "재생" }));
        });

        expect(deps.engine.play).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("button", { name: "정지" })).toBeNull();
        expect(screen.getByRole("button", { name: "재생" })).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
      },
    );
  });

  describe("정지하면 화면과 곡을 엔진에 다시 맞춘다", () => {
    /** 재생을 시작하고, 위치가 3마디로 샘플링될 때까지 기다린 뒤 템포를 90으로 바꾼다. */
    async function playThenChangeTempo(deps: VerifyDeps) {
      const perBar = songLengthTicks(buildDemoSong()) / DEMO_BARS;
      deps.engine.currentTick = vi.fn(() => perBar * 2);
      render(<VerifyScreen createDeps={() => deps} />);

      fireEvent.click(screen.getByRole("button", { name: "재생" }));
      expect(await screen.findByRole("button", { name: "정지" })).toBeTruthy();
      expect(await screen.findByText("3마디 · 1박")).toBeTruthy();

      fireEvent.change(screen.getByLabelText(/템포/), { target: { value: "90" } });
      // 슬라이더도 setSong을 부른다. 정지 뒤의 재동기화만 보려고 기록을 지운다.
      vi.mocked(deps.engine.setSong).mockClear();
    }

    it("곡 끝에서 엔진이 스스로 멈추면 재생 버튼과 처음 위치로 돌아가고 바뀐 템포로 곡을 맞춘다", async () => {
      const deps = makeDeps({ status: "playing" });
      await playThenChangeTempo(deps);

      act(() => deps.engine.onStop?.());

      expect(screen.getByRole("button", { name: "재생" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "정지" })).toBeNull();
      expect(screen.getByText("1마디 · 1박")).toBeTruthy();
      expect(deps.engine.setSong).toHaveBeenLastCalledWith(
        expect.objectContaining({ tempo: 90 }),
      );
    });

    it("정지를 누르면 엔진을 멈추고 처음 위치로 돌아가며 바뀐 템포로 곡을 맞춘다", async () => {
      const deps = makeDeps({ status: "playing" });
      await playThenChangeTempo(deps);

      fireEvent.click(screen.getByRole("button", { name: "정지" }));

      expect(deps.engine.stop).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "재생" })).toBeTruthy();
      expect(screen.getByText("1마디 · 1박")).toBeTruthy();
      expect(deps.engine.setSong).toHaveBeenLastCalledWith(
        expect.objectContaining({ tempo: 90 }),
      );
    });

    it("재생 중 템포를 바꾸면 setTempo가 먹고, 거절된 setSong은 화면을 깨지 않는다", async () => {
      const deps = makeDeps({ status: "playing" });
      // 실제 엔진은 재생 중 setSong을 거절하고 false를 돌려준다.
      deps.engine.setSong = vi.fn(() => false);
      render(<VerifyScreen createDeps={() => deps} />);

      fireEvent.click(screen.getByRole("button", { name: "재생" }));
      expect(await screen.findByRole("button", { name: "정지" })).toBeTruthy();

      fireEvent.change(screen.getByLabelText(/템포/), { target: { value: "90" } });

      expect(deps.engine.setTempo).toHaveBeenLastCalledWith(90);
      expect(deps.engine.setSong).toHaveBeenLastCalledWith(
        expect.objectContaining({ tempo: 90 }),
      );
      expect(screen.getByText("90 BPM")).toBeTruthy();
      expect(screen.getByRole("button", { name: "정지" })).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("위치 표시", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("릴리즈 꼬리 동안 엔진 틱이 곡 끝을 넘어도 마지막 마디·박을 넘지 않는다", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const song = buildDemoSong();
      const length = songLengthTicks(song);
      const deps = makeDeps({ status: "playing" });
      deps.engine.currentTick = vi.fn(() => length + length / DEMO_BARS);
      render(<VerifyScreen createDeps={() => deps} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "재생" }));
      });
      act(() => vi.advanceTimersByTime(100));

      const last = ticksToBarBeat(length - 1, song.timeSignature);
      expect(last.bar).toBe(DEMO_BARS);
      expect(screen.getByText(`${last.bar}마디 · ${last.beat}박`)).toBeTruthy();
    });
  });

  it("클라이언트 뱅크가 이미 받는 중이어도 서버 HTML과 하이드레이션이 어긋나지 않는다", async () => {
    // 서버의 뱅크는 받지 않으므로(enabled: false) 전부 대기다. 클라이언트의 뱅크는
    // 엔진 생성자의 prefetch 때문에 첫 렌더 전에 이미 불러오는 중이다.
    const serverDeps = makeDeps({ status: "playing" }, {
      piano: "idle", guitar: "idle", bass: "idle", drums: "idle",
    });
    const clientDeps = makeDeps({ status: "playing" }, {
      piano: "loading", guitar: "loading", bass: "loading", drums: "loading",
    });
    const container = document.createElement("div");
    container.innerHTML = renderToString(<VerifyScreen createDeps={() => serverDeps} />);
    document.body.appendChild(container);

    const onRecoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <VerifyScreen createDeps={() => clientDeps} />, {
          onRecoverableError,
        });
      });

      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(screen.getByText("피아노").parentElement?.textContent).toContain("불러오는 중");
    } finally {
      // cleanup()은 직접 만든 루트를 내리지 않는다.
      act(() => root?.unmount());
      container.remove();
    }
  });

  it("Web Audio를 지원하지 않으면 이유를 보여 주고 재생을 막는다", () => {
    delete (window as unknown as WindowWithAudio).AudioContext;
    render(<VerifyScreen createDeps={() => makeDeps({ status: "playing" })} />);

    expect(screen.getByText(/Web Audio를 지원하지 않습니다/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "재생" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
