"use client";

import { DRUM_HIHAT, DRUM_KICK, DRUM_SNARE } from "@/lib/score/types";

import { applyEnvelope } from "../env";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";

/** 노이즈 버퍼는 한 번만 만들어 재사용한다. 매 노트마다 만들면 GC가 돈다. */
function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export function createDrums(ctx: AudioContext, pool: VoicePool): Instrument {
  const noise = createNoiseBuffer(ctx);

  function playKick(when: number, vel: number): void {
    const decay = 0.35;
    const gain = pool.acquire(when, when + decay);
    applyEnvelope(gain.gain, when, vel * 0.9, 0.002, decay);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    // 피치 드롭이 킥의 정체다
    osc.frequency.setValueAtTime(140, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
    osc.connect(gain);
    osc.start(when);
    osc.stop(when + decay + 0.02);
    osc.onended = () => osc.disconnect();
  }

  function playNoiseHit(
    when: number,
    vel: number,
    decay: number,
    filterType: BiquadFilterType,
    frequency: number,
    peak: number,
  ): void {
    const gain = pool.acquire(when, when + decay);
    applyEnvelope(gain.gain, when, vel * peak, 0.001, decay);

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, when);
    filter.connect(gain);

    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.connect(filter);
    source.start(when);
    source.stop(when + decay + 0.02);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
    };
  }

  return {
    play(note, when, _dur, vel) {
      if (note === DRUM_KICK) {
        playKick(when, vel);
      } else if (note === DRUM_SNARE) {
        playNoiseHit(when, vel, 0.18, "bandpass", 1800, 0.5);
      } else if (note === DRUM_HIHAT) {
        playNoiseHit(when, vel, 0.05, "highpass", 7000, 0.3);
      }
      // 알 수 없는 드럼 번호는 조용히 무시한다 — 소리 없는 편이 낫다
    },
  };
}
