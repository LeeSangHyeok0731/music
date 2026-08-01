"use client";

import { applyEnvelope, midiToFreq } from "../env";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";

/** sawtooth + 로우패스, 약간의 디튠으로 두께를 준다. */
export function createGuitar(ctx: AudioContext, pool: VoicePool): Instrument {
  const DETUNE_CENTS = [-6, 6];

  return {
    play(note, when, dur, vel) {
      const freq = midiToFreq(note);
      const attack = 0.008;
      const decay = Math.max(dur * 0.9, 0.25);
      const gain = pool.acquire(when, when + attack + decay);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(Math.min(freq * 6, 6000), when);
      filter.Q.setValueAtTime(0.7, when);
      filter.connect(gain);

      applyEnvelope(gain.gain, when, vel * 0.22, attack, decay);

      // 두 오실레이터가 같은 필터를 공유한다. 첫 번째만 끝나면 필터를 끊으면
      // 안 되고, 둘 다 끝날 때까지 기다려야 한다.
      let ended = 0;
      for (const cents of DETUNE_CENTS) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, when);
        osc.detune.setValueAtTime(cents, when);
        osc.connect(filter);
        osc.start(when);
        osc.stop(when + attack + decay + 0.05);
        osc.onended = () => {
          osc.disconnect();
          ended += 1;
          if (ended === DETUNE_CENTS.length) {
            filter.disconnect();
          }
        };
      }
    },
  };
}
