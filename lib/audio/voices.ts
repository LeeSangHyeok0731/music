"use client";

import { fadeOutAndStop } from "./env";

type ActiveVoice = {
  gain: GainNode;
  endsAt: number;
};

/**
 * 동시 발음 수에 상한을 둔다. 드럼 연타나 코드 스트로크에서 보이스가
 * 무제한으로 늘면 클리핑과 CPU 스파이크가 난다. 상한을 넘으면 가장 오래된
 * 보이스를 페이드아웃시켜 훔친다.
 */
export class VoicePool {
  private active: ActiveVoice[] = [];
  private readonly FADE_DURATION = 0.005; // 페이드 시간: 5ms

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly max = 32,
  ) {}

  /**
   * 이 보이스의 게인 노드를 돌려준다. 호출자는 여기에 소스를 연결하고
   * 엔벨로프를 예약한다.
   */
  acquire(when: number, endsAt: number): GainNode {
    this.reap(when);

    if (this.active.length >= this.max) {
      const oldest = this.active.shift();
      if (oldest) {
        this.stopAndRetireVoice(oldest.gain, when);
      }
    }

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.out);

    // 노드는 일회용이다. 회수하지 않으면 긴 곡에서 수천 개가 쌓인다.
    const entry: ActiveVoice = { gain, endsAt };
    this.active.push(entry);

    return gain;
  }

  /** 정지할 때 울리고 있는 것을 전부 끊는다. */
  releaseAll(when: number): void {
    const releasing = this.active;
    this.active = [];

    for (const voice of releasing) {
      this.stopAndRetireVoice(voice.gain, when);
    }
  }

  /**
   * 보이스를 페이드아웃시키고 회수한다. voice stealing과 정지에서 쓴다.
   *
   * 페이드 시간과 현재 오디오 시간의 거리를 고려해서 disconnect 시점을 정해야
   * 한다. `when`이 미래일 수 있기 때문이다 (look-ahead 스케줄러에서 최대 ~100ms
   * 앞). 고정 50ms으로는 때때로 페이드가 시작하기 전에 노드를 끊어 클릭 노이즈가
   * 난다. 지연을 오디오 시간의 거리에서 계산해 두 시계의 괴리를 없앤다.
   */
  private stopAndRetireVoice(gain: GainNode, when: number): void {
    fadeOutAndStop(gain.gain, when, this.FADE_DURATION);
    // 페이드가 시작할 때까지의 거리 + 페이드 기간 + 안전 마진
    const delayMs =
      Math.max(0, (when - this.ctx.currentTime) * 1000) +
      this.FADE_DURATION * 1000 +
      20;
    window.setTimeout(() => {
      gain.disconnect();
    }, delayMs);
  }

  private reap(now: number): void {
    const still: ActiveVoice[] = [];
    for (const voice of this.active) {
      if (voice.endsAt > now) {
        still.push(voice);
      } else {
        voice.gain.disconnect();
      }
    }
    this.active = still;
  }
}
