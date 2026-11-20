import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Engine, type AudioContextProvider } from "@/lib/audio/engine";
import { FakeAudioContext, asAudioContext } from "@/lib/audio/testing/fake-audio";
import type { Song } from "@/lib/score/model";
import { songWithNotes } from "@/lib/score/testing/builders";

const TIMER_MS = 25;

/**
 * `ensureRunning()`이 언제 끝날지 테스트가 직접 정하는 provider.
 *
 * 콜드 스타트에서 `resume()`은 수십 ms 걸리는 진짜 await이고, play/stop이
 * 그 창 안에서 겹칠 때 생기는 버그가 이 엔진에서 가장 잡기 어려웠다.
 * 그 창을 손으로 열고 닫을 수 있어야 재현이 된다.
 */
function deferredProvider(ctx: FakeAudioContext) {
  const pending: Array<{
    resolve: () => void;
    reject: (reason: unknown) => void;
  }> = [];

  const provider: AudioContextProvider = {
    get: () => asAudioContext(ctx),
    ensureRunning: () =>
      new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  };

  return {
    provider,
    /** 대기 중인 ensureRunning을 전부 성공시킨다. */
    settleAll(): void {
      for (const entry of pending.splice(0)) entry.resolve();
    },
    /** 대기 중인 ensureRunning을 전부 실패시킨다. */
    failAll(reason: unknown): void {
      for (const entry of pending.splice(0)) entry.reject(reason);
    },
    get pendingCount(): number {
      return pending.length;
    },
  };
}

/** 곧바로 성공하는 provider. 레이스를 볼 필요가 없는 테스트용. */
function immediateProvider(ctx: FakeAudioContext): AudioContextProvider {
  return {
    get: () => asAudioContext(ctx),
    ensureRunning: async () => {},
  };
}

/**
 * 마지막 박에 짧은 음 하나만 있는 1마디 곡.
 *
 * 악기는 음 길이보다 오래 울린다(피아노는 최소 0.3초). 음이 짧을수록
 * 곡 끝을 넘어 남는 여운이 길어져서, auto-stop이 그 여운을 기다리는지
 * 확인하기 좋다. 데모 곡으로는 여운이 5ms밖에 안 남아 판별이 안 된다.
 */
function songWithLongTail(): Song {
  return songWithNotes({
    notes: [
      // 마디 거의 끝. 16분음표 길이 — 엔벨로프 하한(0.3초)보다 훨씬 짧다.
      { start: 1800, length: 120, velocity: 0.7, pitch: 60 },
    ],
  });
}

/** 오디오 시계와 타이머를 함께 굴린다. 실제 재생 한 틱에 해당한다. */
function tick(ctx: FakeAudioContext): void {
  ctx.advanceBy(TIMER_MS / 1000);
  vi.advanceTimersByTime(TIMER_MS);
}

describe("Engine 시작 레이스", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("연달아 두 번 play해도 세션은 하나만 시작한다", async () => {
    const ctx = new FakeAudioContext();
    const deferred = deferredProvider(ctx);
    const engine = new Engine(songWithLongTail(), deferred.provider);

    const first = engine.play();
    const second = engine.play();

    // 두 번째는 최상단 가드에 걸려 ensureRunning까지 가지도 않는다
    expect(deferred.pendingCount).toBe(1);

    deferred.settleAll();
    await Promise.allSettled([first, second]);

    expect(engine.isPlaying()).toBe(true);
  });

  it("play -> stop -> play가 겹쳐도 고아 타이머가 남지 않는다", async () => {
    // 불리언 가드 하나로는 이 순서를 막지 못한다. stop()이 playing을 false로
    // 내리면 두 번째 play()가 가드를 통과하고, 먼저 시작한 play()도 await에서
    // 깨어나 playing이 다시 true인 것을 보고 진행한다. 둘이 각각 setInterval을
    // 걸고 나중 것이 timerId를 덮어써서, 먼저 걸린 타이머는 stop()으로도
    // dispose()로도 닿지 않는 고아가 된다.
    const ctx = new FakeAudioContext();
    const deferred = deferredProvider(ctx);
    const engine = new Engine(songWithLongTail(), deferred.provider);

    const first = engine.play();
    engine.stop();
    const second = engine.play();

    expect(deferred.pendingCount).toBe(2);

    deferred.settleAll();
    await Promise.allSettled([first, second]);

    expect(engine.isPlaying()).toBe(true);

    engine.stop();
    // 보이스 회수용 setTimeout까지 전부 소진시킨다
    vi.advanceTimersByTime(5000);

    // interval은 스스로 끝나지 않으므로, 하나라도 살아 있으면 여기 잡힌다
    expect(vi.getTimerCount()).toBe(0);
  });

  it("시작 중에 정지하면 재생이 시작되지 않는다", async () => {
    const ctx = new FakeAudioContext();
    const deferred = deferredProvider(ctx);
    const engine = new Engine(songWithLongTail(), deferred.provider);

    const started = engine.play();
    engine.stop();

    deferred.settleAll();
    await Promise.allSettled([started]);

    expect(engine.isPlaying()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispose는 타이머와 마스터 노드를 정리한다", async () => {
    // 언마운트 경로다. 여기서 타이머가 남으면 페이지가 살아있는 내내
    // 25ms마다 도는 인터벌이 엔진 참조를 붙들고 있게 된다.
    const ctx = new FakeAudioContext();
    const engine = new Engine(songWithLongTail(), immediateProvider(ctx));

    await engine.play();
    expect(engine.isPlaying()).toBe(true);

    // disconnect()가 연결 목록을 비우므로 dispose 전에 찾아 둔다
    const master = ctx.created.find(
      (node) => node.kind === "gain" && node.connected.includes(ctx.destination),
    );
    expect(master).toBeDefined();

    engine.dispose();

    expect(engine.isPlaying()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);
    expect(master!.isDisconnected).toBe(true);
  });

  it("시작에 실패하면 다시 눌렀을 때 실제로 재시도된다", async () => {
    // 실패 후에도 playing이 true로 남으면 다음 play()가 최상단 가드에 걸려
    // 조용히 아무 일도 안 한다. 에러 배너는 "다시 눌러 주세요"라고 하는데
    // 다시 눌러도 안 되는 상태가 된다.
    const ctx = new FakeAudioContext();
    const deferred = deferredProvider(ctx);
    const engine = new Engine(songWithLongTail(), deferred.provider);

    const failing = engine.play();
    deferred.failAll(new Error("resume 거부"));
    await expect(failing).rejects.toThrow("resume 거부");

    expect(engine.isPlaying()).toBe(false);

    const retry = engine.play();
    deferred.settleAll();
    await retry;

    expect(engine.isPlaying()).toBe(true);
    engine.stop();
  });
});

/** 트랙 하나짜리 1마디 곡. 트랙 id와 음을 인자로 받아 setSong 전후 곡을 쉽게 만든다. */
function songWithTrack(trackId: string, pitch: number): Song {
  return songWithNotes({
    trackId,
    // 재생 시작 즉시(첫 onTimer) 예약되도록 곡 맨 앞
    notes: [{ start: 0, length: 480, velocity: 0.7, pitch }],
  });
}

describe("Engine setSong — 악기 맵 동기화", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("불러온 곡의 트랙 id가 바뀌면 새 트랙도 소리가 난다", async () => {
    // 재현: 재생 한 번으로 악기 맵을 만들고(buildGraph는 최초 1회만 돈다),
    // 정지 후 트랙 id가 다른 곡을 setSong으로 갈아끼운다. 맵을 다시 채우지
    // 않으면 sink.schedule의 `this.instruments.get(trackId)?.play(...)`가
    // 새 id를 찾지 못해 예외도 로그도 없이 그 트랙 전체가 무음이 된다.
    const ctx = new FakeAudioContext();
    const engine = new Engine(
      songWithTrack("track-old", 60),
      immediateProvider(ctx),
    );

    await engine.play();
    tick(ctx); // tick 0의 음이 예약되며 오실레이터 3개(부분음)가 생긴다
    const oscillatorsAfterFirstPlay = ctx.created.filter(
      (n) => n.kind === "oscillator",
    ).length;
    expect(oscillatorsAfterFirstPlay).toBeGreaterThan(0);

    engine.stop();

    engine.setSong(songWithTrack("track-new", 67));

    await engine.play();
    tick(ctx);

    const oscillatorsAfterSecondPlay = ctx.created.filter(
      (n) => n.kind === "oscillator",
    ).length;

    // 두 번째 재생에서도 새 트랙의 음이 실제로 악기까지 도달해 오실레이터가
    // 새로 생겨야 한다. 맵이 갱신되지 않으면 이 수가 늘지 않는다.
    expect(oscillatorsAfterSecondPlay).toBeGreaterThan(
      oscillatorsAfterFirstPlay,
    );
  });
});

describe("Engine setSong — 템포와 재생 중 거부", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("정지 중 setSong은 곡의 템포를 엔진에 함께 적용하고 true를 돌려준다", () => {
    // song.tempo가 유일한 진실이다. 호출부가 setTempo를 따로 부르는 것에
    // 기대면 빠뜨리는 순간 화면과 재생 속도가 영구히 갈라진다.
    const engine = new Engine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
    );
    expect(engine.getTempo()).toBe(120);

    const applied = engine.setSong({ ...songWithTrack("t", 60), tempo: 90 });

    expect(applied).toBe(true);
    expect(engine.getTempo()).toBe(90);
  });

  it("재생 중 setSong은 거부하고 곡도 템포도 바꾸지 않는다", async () => {
    const engine = new Engine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
    );
    await engine.play();

    const applied = engine.setSong({ ...songWithTrack("t", 60), tempo: 90 });

    expect(applied).toBe(false);
    expect(engine.getTempo()).toBe(120);
    engine.stop();
  });

  it("재생 중에도 setTempo는 허용된다", async () => {
    const engine = new Engine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
    );
    await engine.play();

    engine.setTempo(100);

    expect(engine.getTempo()).toBe(100);
    engine.stop();
  });
});

describe("Engine 자동 정지", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("곡 끝을 지나도 마지막 음의 여운이 남아 있으면 자르지 않는다", async () => {
    // 곡 길이만 보고 바로 stop()하면 releaseAll이 5ms 페이드로 꺼버려
    // 마지막 비트의 꼬리가 매 재생마다 뚝 잘린다.
    const ctx = new FakeAudioContext();
    const song = songWithLongTail();
    const engine = new Engine(song, immediateProvider(ctx));

    let stoppedAt: number | null = null;
    engine.onStop = () => {
      stoppedAt = ctx.currentTime;
    };

    await engine.play();

    // 곡은 120BPM 4/4 1마디 = 2초, 시작 지연 0.05초를 더해 2.05초에 끝난다.
    // 넉넉히 4초까지 굴린다.
    for (let i = 0; i < 160; i++) {
      tick(ctx);
      if (stoppedAt !== null) break;
    }

    expect(stoppedAt).not.toBeNull();
    // 곡 끝(2.05초)을 지나서 멈춰야 한다. 마지막 음은 1800틱(1.875초)에
    // 시작해 엔벨로프 하한 0.3초를 타므로 2.2초 언저리까지 울린다.
    expect(stoppedAt!).toBeGreaterThan(2.15);
  });

  it("자동 정지 후에는 타이머가 남지 않는다", async () => {
    const ctx = new FakeAudioContext();
    const engine = new Engine(songWithLongTail(), immediateProvider(ctx));

    let stopped = false;
    engine.onStop = () => {
      stopped = true;
    };

    await engine.play();

    for (let i = 0; i < 160; i++) {
      tick(ctx);
      if (stopped) break;
    }

    expect(stopped).toBe(true);
    expect(engine.isPlaying()).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
