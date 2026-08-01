"use client";

import { applyEnvelope, midiToFreq } from "../env";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";

/** sine 저음 + 소프트 클립으로 배음을 살짝 만든다. */
export function createBass(ctx: AudioContext, pool: VoicePool): Instrument {
  // 부드러운 tanh 곡선. 매 노트마다 만들지 않도록 한 번만 계산한다.
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2);
  }

  return {
    play(note, when, dur, vel) {
      const freq = midiToFreq(note);
      const attack = 0.01;
      const decay = Math.max(dur * 0.95, 0.2);
      const gain = pool.acquire(when, when + attack + decay);

      const shaper = ctx.createWaveShaper();
      shaper.curve = curve;
      shaper.connect(gain);

      applyEnvelope(gain.gain, when, vel * 0.35, attack, decay);

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, when);
      osc.connect(shaper);
      osc.start(when);
      osc.stop(when + attack + decay + 0.05);
      osc.onended = () => {
        osc.disconnect();
        shaper.disconnect();
      };
    },
  };
}
