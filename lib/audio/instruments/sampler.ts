"use client";

import type { InstrumentId } from "@/lib/score/model";

import type { SamplePort } from "../samples/bank";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";

/** 음 길이가 끝난 뒤 소리를 줄여 끝내는 시간. 뚝 자르면 클릭 노이즈가 난다. */
const RELEASE = 0.08;
/** 소스 정지를 엔벨로프 끝보다 살짝 늦춰 램프가 잘리지 않게 한다. */
const STOP_MARGIN = 0.02;
const SAMPLE_GAIN = 0.8;

/**
 * 샘플 재생 악기. 피아노·기타·베이스·드럼이 모두 이것이다 — 악기마다 다른
 * 것은 뱅크가 가진 샘플뿐이다.
 *
 * - 음이 있는 악기: 가장 가까운 샘플을 `playbackRate`로 음높이 보정해 틀고,
 *   음 길이가 끝나면 RELEASE 동안 줄인다.
 * - 드럼: 샘플이 스스로 끝날 때까지 울리는 원샷이다. 음 길이(격자 칸)가
 *   짧아도 샘플을 자르지 않는다. GM 번호마다 샘플 하나라 음높이 보정도
 *   하지 않는다 — 뱅크가 없는 번호에 가장 가까운 샘플과 1이 아닌 속도를
 *   돌려줘도 속도는 1로 둔다.
 *
 * `AudioBufferSourceNode`는 일회용이다. 음마다 새로 만들고 `onended`에서
 * 끊는다. 준비되지 않은 음은 조용히 건너뛴다 — 엔진이 재생 전에 모든
 * 악기의 준비를 보장하므로 정상 경로에서는 일어나지 않는다.
 */
export function createSampler(
  instrument: InstrumentId,
  ctx: AudioContext,
  pool: VoicePool,
  bank: SamplePort,
): Instrument {
  const oneShot = instrument === "drums";

  return {
    play(pitch, when, dur, vel) {
      const hit = bank.zoneFor(instrument, pitch);
      if (!hit) return;

      const level = vel * SAMPLE_GAIN;
      const endsAt = oneShot ? when + hit.buffer.duration : when + dur + RELEASE;
      const gain = pool.acquire(when, endsAt);
      gain.gain.setValueAtTime(level, when);
      if (!oneShot) {
        gain.gain.setValueAtTime(level, when + dur);
        gain.gain.linearRampToValueAtTime(0, when + dur + RELEASE);
      }

      const source = ctx.createBufferSource();
      source.buffer = hit.buffer;
      source.playbackRate.setValueAtTime(oneShot ? 1 : hit.rate, when);
      source.connect(gain);
      source.start(when);
      source.stop(endsAt + STOP_MARGIN);
      source.onended = () => source.disconnect();
    },
  };
}
