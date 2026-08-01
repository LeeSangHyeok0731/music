import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FakeAudioContext,
  FakeAudioNode,
  asAudioContext,
  asAudioNode,
} from "@/lib/audio/testing/fake-audio";
import { VoicePool } from "@/lib/audio/voices";

const FADE_SECONDS = 0.005;
const RETIRE_MARGIN_MS = 20;

function setup(max?: number) {
  const ctx = new FakeAudioContext();
  const out = new FakeAudioNode("master");
  const pool = new VoicePool(asAudioContext(ctx), asAudioNode(out), max);
  return { ctx, out, pool };
}

/** VoicePool이 돌려주는 GainNode를 가짜 타입으로 다시 본다. */
function asFake(node: unknown): FakeAudioNode {
  return node as unknown as FakeAudioNode;
}

describe("VoicePool.acquire", () => {
  it("새 보이스를 출력에 연결해서 돌려준다", () => {
    const { out, pool } = setup();
    const gain = asFake(pool.acquire(0, 1));

    expect(gain.connected).toContain(out);
    expect(gain.isDisconnected).toBe(false);
  });

  it("아직 울리고 있는 보이스를 회수하지 않는다", () => {
    // 이게 이 파일에서 제일 중요한 테스트다. acquire는 reap에 `when`이 아니라
    // 지금 시각을 넘겨야 한다. `when`은 lookahead만큼(최대 100ms) 미래라,
    // when 기준으로 회수하면 하이햇(감쇠 50ms)처럼 짧은 소리가 한창 울리는
    // 도중에 페이드 없이 잘려 클릭이 난다.
    const { ctx, pool } = setup();

    const hihat = asFake(pool.acquire(0, 0.05));

    // 지금은 0.02초 — 하이햇은 0.05초까지 울린다. 아직 소리가 남았다.
    ctx.advanceTo(0.02);
    // 다음 노트는 0.1초(=100ms 미래)에 시작하도록 예약된다.
    pool.acquire(0.1, 0.4);

    expect(hihat.isDisconnected).toBe(false);
  });

  it("이미 끝난 보이스는 다음 acquire에서 회수한다", () => {
    const { ctx, pool } = setup();

    const done = asFake(pool.acquire(0, 0.05));

    ctx.advanceTo(0.06); // 0.05초에 끝났으므로 이미 무음이다
    pool.acquire(0.06, 0.4);

    expect(done.isDisconnected).toBe(true);
  });
});

describe("VoicePool 상한과 voice stealing", () => {
  it("상한을 넘으면 가장 오래된 보이스를 훔친다", () => {
    const { pool } = setup(3);

    const first = asFake(pool.acquire(0, 10));
    pool.acquire(0, 10);
    pool.acquire(0, 10);

    // 넷째를 요청하면 첫째가 밀려난다
    pool.acquire(0, 10);

    // 페이드가 예약됐는지로 확인한다 — disconnect는 페이드 뒤라 아직이다
    const gainParam = (first as unknown as { gain: { calls: unknown[] } }).gain;
    expect(gainParam.calls.length).toBeGreaterThan(0);
  });

  it("상한 안에서는 아무도 훔치지 않는다", () => {
    const { pool } = setup(3);

    const first = asFake(pool.acquire(0, 10));
    pool.acquire(0, 10);
    pool.acquire(0, 10);

    const gainParam = (first as unknown as { gain: { calls: unknown[] } }).gain;
    expect(gainParam.calls).toHaveLength(0);
  });
});

describe("VoicePool.latestEndsAt", () => {
  it("비어 있으면 0이다", () => {
    const { pool } = setup();
    expect(pool.latestEndsAt()).toBe(0);
  });

  it("살아있는 보이스 중 가장 늦게 끝나는 시각을 돌려준다", () => {
    const { pool } = setup();
    pool.acquire(0, 0.4);
    pool.acquire(0, 1.2);
    pool.acquire(0, 0.8);

    expect(pool.latestEndsAt()).toBe(1.2);
  });

  it("풀 상태를 건드리지 않는다 — 여러 번 불러도 같은 값이다", () => {
    // engine의 auto-stop이 이 값으로 "아직 울리는 중인가"를 판단한다.
    // 조회가 reap을 유발하면 부르는 시점에 따라 답이 달라져 쓸 수 없다.
    const { ctx, pool } = setup();
    pool.acquire(0, 0.4);
    ctx.advanceTo(1); // 이미 끝난 시점이지만 조회는 아무것도 정리하지 않는다

    expect(pool.latestEndsAt()).toBe(0.4);
    expect(pool.latestEndsAt()).toBe(0.4);
  });
});

describe("VoicePool 노드 회수 타이밍", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("회수 지연이 when까지의 거리에 따라 늘어난다", () => {
    // 고정 지연(예: 50ms)으로는 when이 45ms보다 먼 미래일 때 페이드가
    // 시작하기도 전에 노드를 끊는다. lookahead가 100ms이므로 그건 예외가
    // 아니라 평상시 동작이고, 막으려던 클릭을 오히려 만든다.
    const { pool } = setup();
    const when = 0.1; // 100ms 미래

    const voice = asFake(pool.acquire(0, 10));
    pool.releaseAll(when);

    const expectedMs = when * 1000 + FADE_SECONDS * 1000 + RETIRE_MARGIN_MS;

    vi.advanceTimersByTime(expectedMs - 5);
    expect(voice.isDisconnected).toBe(false);

    vi.advanceTimersByTime(10);
    expect(voice.isDisconnected).toBe(true);
  });

  it("훔친 보이스도 결국 회수된다", () => {
    // 훔친 보이스는 active 배열에서 빠지므로, 그 자리에서 회수를 예약해
    // 두지 않으면 reap도 releaseAll도 다시 볼 수 없어 마스터에 영원히 남는다.
    const { pool } = setup(1);

    const stolen = asFake(pool.acquire(0, 10));
    pool.acquire(0, 10); // 상한 1이라 첫째를 훔친다

    vi.advanceTimersByTime(1000);
    expect(stolen.isDisconnected).toBe(true);
  });

  it("releaseAll은 울리던 보이스를 전부 회수한다", () => {
    const { pool } = setup();

    const voices = [
      asFake(pool.acquire(0, 10)),
      asFake(pool.acquire(0, 10)),
      asFake(pool.acquire(0, 10)),
    ];

    pool.releaseAll(0);
    vi.advanceTimersByTime(1000);

    for (const voice of voices) {
      expect(voice.isDisconnected).toBe(true);
    }
  });

  it("releaseAll 직후에는 아직 끊지 않는다 — 페이드가 잘리면 클릭이 난다", () => {
    const { pool } = setup();
    const voice = asFake(pool.acquire(0, 10));

    pool.releaseAll(0);

    expect(voice.isDisconnected).toBe(false);
  });
});
