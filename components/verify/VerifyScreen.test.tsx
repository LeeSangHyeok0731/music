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
import type { InstrumentId } from "@/lib/score/model";

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

  it("언마운트하면 엔진을 정리한다", () => {
    const deps = makeDeps({ status: "playing" });
    const { unmount } = render(<VerifyScreen createDeps={() => deps} />);
    unmount();
    expect(deps.engine.dispose).toHaveBeenCalled();
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
