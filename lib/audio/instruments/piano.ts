"use client";

import { applyEnvelope, midiToFreq } from "../env";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";

/** sine 기음 + 두 배음. 빠른 attack, 지수 감쇠. */
export function createPiano(ctx: AudioContext, pool: VoicePool): Instrument {
  const PARTIALS = [
    { ratio: 1, amp: 1 },
    { ratio: 2, amp: 0.35 },
    { ratio: 3, amp: 0.12 },
  ];

  return {
    play(note, when, dur, vel) {
      const freq = midiToFreq(note);
      const attack = 0.005;
      const decay = Math.max(dur, 0.3);
      const gain = pool.acquire(when, when + attack + decay);

      applyEnvelope(gain.gain, when, vel * 0.3, attack, decay);

      for (const partial of PARTIALS) {
        const osc = ctx.createOscillator();
        const partialGain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq * partial.ratio, when);
        partialGain.gain.setValueAtTime(partial.amp, when);
        osc.connect(partialGain);
        partialGain.connect(gain);
        osc.start(when);
        osc.stop(when + attack + decay + 0.05);
        osc.onended = () => {
          osc.disconnect();
          partialGain.disconnect();
        };
      }
    },
  };
}
