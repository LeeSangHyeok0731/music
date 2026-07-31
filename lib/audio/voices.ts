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
        fadeOutAndStop(oldest.gain.gain, when);
        // 페이드가 끝난 뒤 노드를 회수한다. 여기서 바로 disconnect하면
        // 페이드가 잘려 클릭 노이즈가 난다.
        window.setTimeout(() => {
          oldest.gain.disconnect();
        }, 50);
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
      fadeOutAndStop(voice.gain.gain, when);
    }

    // 페이드가 끝난 뒤 노드를 회수한다. 여기서 바로 disconnect하면
    // 페이드가 잘려 클릭 노이즈가 난다. 오디오 예약이 아니라 정리용
    // 타이머이므로 setTimeout을 써도 된다.
    window.setTimeout(() => {
      for (const voice of releasing) {
        voice.gain.disconnect();
      }
    }, 50);
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
