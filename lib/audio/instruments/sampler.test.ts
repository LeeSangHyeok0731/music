import { describe, expect, it } from "vitest";

import { createSampler } from "@/lib/audio/instruments/sampler";
import type { SamplePort } from "@/lib/audio/samples/bank";
import { FakeSampleBank } from "@/lib/audio/testing/fake-bank";
import {
  FakeAudioContext,
  FakeAudioNode,
  FakeScheduledSource,
  asAudioContext,
  asAudioNode,
} from "@/lib/audio/testing/fake-audio";
import { VoicePool } from "@/lib/audio/voices";

function setup(bank: SamplePort = new FakeSampleBank()) {
  const ctx = new FakeAudioContext();
  const out = new FakeAudioNode("out");
  const pool = new VoicePool(asAudioContext(ctx), asAudioNode(out));
  return { ctx, pool, bank };
}

function bufferSources(ctx: FakeAudioContext) {
  return ctx.created.filter((n) => n.kind === "bufferSource") as (FakeScheduledSource & {
    playbackRate: { calls: { method: string; value: number | null; time: number }[] };
  })[];
}

describe("createSampler — 음이 있는 악기", () => {
  it("음마다 새 버퍼 소스를 만들어 정해진 시각에 시작한다", () => {
    const { ctx, pool, bank } = setup();
    const piano = createSampler("piano", asAudioContext(ctx), pool, bank);

    piano.play(60, 1.0, 0.5, 0.8);
    piano.play(64, 1.5, 0.5, 0.8);

    const sources = bufferSources(ctx);
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.startedAt)).toEqual([1.0, 1.5]);
  });

  it("뱅크가 준 재생 속도를 소스에 건다", () => {
    const { ctx, pool } = setup();
    const bank: SamplePort = {
      prefetch() {},
      ensureReady: async () => ({ ok: true }),
      zoneFor: () => ({ buffer: { duration: 2 } as unknown as AudioBuffer, rate: 1.5 }),
    };
    createSampler("guitar", asAudioContext(ctx), pool, bank).play(60, 1, 0.5, 0.8);

    const [source] = bufferSources(ctx);
    expect(source.playbackRate.calls).toContainEqual({
      method: "setValueAtTime",
      value: 1.5,
      time: 1,
    });
  });

  it("음 길이 뒤에 짧게 줄여 끝낸다 — 뚝 자르면 클릭이 난다", () => {
    const { ctx, pool, bank } = setup();
    const vel = 0.8;
    createSampler("bass", asAudioContext(ctx), pool, bank).play(40, 1.0, 0.5, vel);

    const [source] = bufferSources(ctx);
    // 1.0 + 0.5(dur) + 릴리즈(0.08) 이후에 멈춘다
    expect(source.stoppedAt!).toBeGreaterThan(1.58);
    const gain = ctx.created.find((n) => n.kind === "gain") as unknown as {
      gain: { calls: { method: string; value: number | null; time: number }[] };
    };
    const calls = gain.gain.calls;

    // 시작 레벨: vel × SAMPLE_GAIN(sampler.ts의 0.8)
    const attack = calls.find((c) => c.method === "setValueAtTime" && c.time === 1.0);
    expect(attack?.value).toBeCloseTo(vel * 0.8, 9);

    // 음 길이 끝(1.5)에 같은 레벨을 붙잡아야 램프가 거기서 시작한다. 이 점이
    // 없으면 Web Audio는 직전 이벤트(1.0의 setValueAtTime)부터 램프를 그어
    // 음 전체가 서서히 꺼진다.
    const holdIndex = calls.findIndex(
      (c) => c.method === "setValueAtTime" && Math.abs(c.time - 1.5) < 1e-9,
    );
    const rampIndex = calls.findIndex((c) => c.method === "linearRampToValueAtTime");
    expect(holdIndex).toBeGreaterThanOrEqual(0);
    expect(calls[holdIndex].value).toBe(attack?.value);
    expect(rampIndex).toBeGreaterThan(holdIndex);

    const ramp = calls[rampIndex];
    expect(ramp.value).toBe(0);
    expect(ramp.time).toBeCloseTo(1.58, 6);

    // 풀은 릴리즈가 끝난 뒤에야 이 보이스를 회수해야 한다. 음 길이 끝(1.5)을
    // 넘기면 reap이 램프 도중에 게인을 끊어, 바로 막으려던 클릭이 난다.
    expect(pool.latestEndsAt()).toBeCloseTo(1.58, 6);
  });

  it("velocity가 클수록 소리가 크다", () => {
    const { ctx, pool, bank } = setup();
    const piano = createSampler("piano", asAudioContext(ctx), pool, bank);
    piano.play(60, 1, 0.5, 0.2);
    piano.play(60, 2, 0.5, 0.9);

    const gains = ctx.created.filter((n) => n.kind === "gain") as unknown as {
      gain: { calls: { method: string; value: number | null }[] };
    }[];
    const level = (i: number) =>
      gains[i].gain.calls.find((c) => c.method === "setValueAtTime")!.value!;
    expect(level(1)).toBeGreaterThan(level(0));
  });

  it("소리가 끝나면 소스를 끊는다 (노드 누수 방지)", () => {
    const { ctx, pool, bank } = setup();
    createSampler("piano", asAudioContext(ctx), pool, bank).play(60, 1, 0.5, 0.8);
    const [source] = bufferSources(ctx);
    expect(source.isDisconnected).toBe(false);

    ctx.advanceTo(source.stoppedAt! + 0.001);

    expect(source.isDisconnected).toBe(true);
  });

  it("준비되지 않은 음(zoneFor가 null)은 노드를 만들지 않는다", () => {
    const { ctx, pool } = setup();
    const bank: SamplePort = {
      prefetch() {},
      ensureReady: async () => ({ ok: true }),
      zoneFor: () => null,
    };
    createSampler("piano", asAudioContext(ctx), pool, bank).play(60, 1, 0.5, 0.8);
    expect(ctx.created).toHaveLength(0);
  });
});

describe("createSampler — 드럼", () => {
  it("드럼은 음 길이와 무관하게 샘플 길이만큼 울리는 원샷이다", () => {
    const { ctx, pool, bank } = setup(); // 가짜 샘플 길이 0.5초
    createSampler("drums", asAudioContext(ctx), pool, bank).play(38, 1.0, 0.05, 0.8);

    const [source] = bufferSources(ctx);
    expect(source.stoppedAt!).toBeGreaterThanOrEqual(1.5);
    expect(source.stoppedAt!).toBeLessThan(1.6);
    // 풀도 음 길이(1.05)가 아니라 샘플 길이(1.0 + 0.5)까지 살아 있다고 본다.
    expect(pool.latestEndsAt()).toBeCloseTo(1.5, 6);
  });

  it("드럼은 음 길이 뒤에 릴리즈 램프를 만들지 않는다", () => {
    const { ctx, pool, bank } = setup();
    createSampler("drums", asAudioContext(ctx), pool, bank).play(38, 1.0, 0.05, 0.8);
    const gain = ctx.created.find((n) => n.kind === "gain") as unknown as {
      gain: { calls: { method: string }[] };
    };
    expect(gain.gain.calls.some((c) => c.method === "linearRampToValueAtTime")).toBe(
      false,
    );
  });

  it("드럼은 뱅크가 준 속도를 무시하고 원래 속도(1)로 튼다 — 음높이 보정을 하지 않는다", () => {
    // 매니페스트에 없는 GM 번호면 뱅크는 가장 가까운 샘플과 1이 아닌 속도를
    // 돌려줄 수 있다. 드럼은 번호마다 샘플 하나라 그 속도를 걸면 다른 북의
    // 음높이를 바꾼 엉뚱한 소리가 난다(스펙 §4.3).
    const { ctx, pool } = setup();
    const bank: SamplePort = {
      prefetch() {},
      ensureReady: async () => ({ ok: true }),
      zoneFor: () => ({ buffer: { duration: 0.5 } as unknown as AudioBuffer, rate: 2 }),
    };
    createSampler("drums", asAudioContext(ctx), pool, bank).play(39, 1, 0.05, 0.8);

    const [source] = bufferSources(ctx);
    // 기본값이 1이라 value만 보면 아무것도 증명하지 못한다 — 호출을 본다.
    expect(source.playbackRate.calls).toContainEqual({
      method: "setValueAtTime",
      value: 1,
      time: 1,
    });
    expect(source.playbackRate.calls.some((c) => c.value === 2)).toBe(false);
  });
});
