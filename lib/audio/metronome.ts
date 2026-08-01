"use client";

import { applyEnvelope } from "./env";

export type Metronome = {
  click(when: number, accent: boolean): void;
};

/** 곡 데이터에 들어가지 않는다. 엔진이 직접 예약하는 짧은 클릭이다. */
export function createMetronome(ctx: AudioContext, out: AudioNode): Metronome {
  return {
    click(when, accent) {
      const decay = 0.03;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(out);

      applyEnvelope(gain.gain, when, accent ? 0.25 : 0.15, 0.001, decay);

      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(accent ? 1600 : 1000, when);
      osc.connect(gain);
      osc.start(when);
      osc.stop(when + decay + 0.02);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    },
  };
}
