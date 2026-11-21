import { vi, type Mock } from "vitest";

import type { PlayResult } from "@/lib/audio/engine";
import type { SampleStatus } from "@/lib/audio/samples/bank";
import { INSTRUMENT_IDS, type InstrumentId, type Song } from "@/lib/score/model";
import type {
  StudioBank,
  StudioDeps,
  StudioEngine,
  StudioStorage,
} from "@/state/types";

/**
 * 테스트용 가짜 엔진·뱅크·저장소. `StudioProvider`와 그 위의 UI 테스트가 함께 쓴다.
 *
 * 가짜 엔진은 실제 엔진의 계약 중 UI 상태가 엔진과 어긋나는 경로에 걸리는 부분을
 * 그대로 흉내 낸다: `play()`를 부르는 순간부터(첫 await 전) 바쁜 상태가 되고,
 * 그동안과 재생 중에는 `setSong`이 `false`를 돌려주며 아무것도 바꾸지 않는다.
 * `not-ready`·`superseded`·거부·`stop()`·자동 정지가 바쁜 상태를 푼다.
 * 이걸 흉내 내지 않으면 "대기 중 편집은 엔진에 닿지 않는다"는 버그를 테스트가 못 본다.
 */

export type Statuses = Record<InstrumentId, SampleStatus>;

/** `play()`가 어떻게 끝날지. `"manual"`이면 `resolvePlay`/`rejectPlay`로 직접 끝낸다. */
export type PlayMode = PlayResult | { reject: unknown } | "manual";

export type FakeEngine = StudioEngine & {
  play: Mock<() => Promise<PlayResult>>;
  stop: Mock<() => void>;
  setSong: Mock<(song: Song) => boolean>;
  setTempo: Mock<(bpm: number) => void>;
  setMetronome: Mock<(on: boolean) => void>;
  currentTick: Mock<() => number>;
  dispose: Mock<() => void>;
};

export type FakeBank = StudioBank & {
  prefetch: Mock<(instruments: readonly InstrumentId[]) => void>;
  /** 상태를 바꾸고 구독자에게 알린다. 렌더가 일어나므로 `act` 안에서 부른다. */
  setStatuses(next: Partial<Statuses>): void;
};

export type FakeStorage = StudioStorage & {
  getItem: Mock<(key: string) => string | null>;
  setItem: Mock<(key: string, value: string) => void>;
  readonly data: Map<string, string>;
  /** 참이면 `setItem`이 던진다(용량 초과·차단 흉내). */
  failSetItem: boolean;
  /** 참이면 `getItem`이 던진다(쿠키 차단 등). */
  failGetItem: boolean;
};

export type FakeDeps = {
  engine: FakeEngine;
  bank: FakeBank;
  storage: FakeStorage | null;
  /** `<StudioProvider createDeps={fake.createDeps}>`에 그대로 넘긴다. */
  createDeps: () => StudioDeps;
  /** 다음 `play()`들이 끝나는 방식. 기본은 `{ status: "playing" }`으로 바로. */
  playMode: PlayMode;
  /** 실제 엔진의 `playing` 필드에 해당. 참이면 `setSong`이 거절된다. */
  readonly engineBusy: boolean;
  /** `"manual"` 모드에서 기다리는 `play()`를 끝낸다. 렌더가 일어나므로 `act` 안에서. */
  resolvePlay(result: PlayResult): void;
  rejectPlay(error: unknown): void;
  /** 곡 끝 자동 정지: 엔진이 스스로 멈추고 `onStop`을 부른다. `act` 안에서. */
  autoStop(): void;
};

export type FakeDepsOptions = {
  playMode?: PlayMode;
  statuses?: Partial<Statuses>;
  /** 저장소에 미리 들어 있는 `[키, 값]`. */
  stored?: Record<string, string>;
  /** false면 저장소가 없는 환경(`storage: null`). */
  storage?: boolean;
};

export function createFakeDeps(options: FakeDepsOptions = {}): FakeDeps {
  let busy = false;
  let waiting: {
    resolve: (r: PlayResult) => void;
    reject: (e: unknown) => void;
  } | null = null;

  const engine: FakeEngine = {
    play: vi.fn(() => {
      if (busy) return Promise.resolve<PlayResult>({ status: "already-playing" });
      busy = true;
      const mode = fake.playMode;
      // 거부 약속은 부를 때 만든다. 미리 만들어 두면 처리기가 달리기 전에
      // 처리되지 않은 거부로 잡힌다.
      const settled =
        mode === "manual"
          ? new Promise<PlayResult>((resolve, reject) => {
              waiting = { resolve, reject };
            })
          : "reject" in mode
            ? Promise.reject(mode.reject)
            : Promise.resolve(mode);
      return settled.then(
        (result) => {
          if (result.status !== "playing") busy = false;
          return result;
        },
        (error: unknown) => {
          busy = false;
          throw error;
        },
      );
    }),
    stop: vi.fn(() => {
      busy = false;
    }),
    setSong: vi.fn(() => !busy),
    setTempo: vi.fn(),
    setMetronome: vi.fn(),
    currentTick: vi.fn(() => 0),
    dispose: vi.fn(() => {
      busy = false;
    }),
    onStop: null,
  };

  let snapshot: Statuses = {
    ...(Object.fromEntries(INSTRUMENT_IDS.map((id) => [id, "ready"])) as Statuses),
    ...options.statuses,
  };
  const listeners = new Set<() => void>();
  const bank: FakeBank = {
    prefetch: vi.fn(),
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setStatuses(next) {
      snapshot = { ...snapshot, ...next };
      for (const listener of listeners) listener();
    },
  };

  let storage: FakeStorage | null = null;
  if (options.storage !== false) {
    const data = new Map(Object.entries(options.stored ?? {}));
    const s: FakeStorage = {
      data,
      failSetItem: false,
      failGetItem: false,
      getItem: vi.fn((key: string) => {
        if (s.failGetItem) throw new Error("SecurityError");
        return data.get(key) ?? null;
      }),
      setItem: vi.fn((key: string, value: string) => {
        if (s.failSetItem) throw new Error("QuotaExceededError");
        data.set(key, value);
      }),
    };
    storage = s;
  }

  function takeWaiting() {
    if (!waiting) throw new Error("기다리는 play()가 없습니다");
    const w = waiting;
    waiting = null;
    return w;
  }

  const deps: StudioDeps = { engine, bank, storage };
  const fake: FakeDeps = {
    engine,
    bank,
    storage,
    createDeps: () => deps,
    playMode: options.playMode ?? { status: "playing" },
    get engineBusy() {
      return busy;
    },
    resolvePlay(result) {
      takeWaiting().resolve(result);
    },
    rejectPlay(error) {
      takeWaiting().reject(error);
    },
    autoStop() {
      busy = false;
      engine.onStop?.();
    },
  };
  return fake;
}

/** `setSong` 호출 중 엔진이 받아들인(`true`를 돌려준) 곡들. 오래된 것부터. */
export function acceptedSongs(engine: FakeEngine): Song[] {
  return engine.setSong.mock.calls
    .filter((_, i) => engine.setSong.mock.results[i]?.value === true)
    .map(([song]) => song);
}
