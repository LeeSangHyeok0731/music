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
    // when이 아니라 지금 시각으로 회수한다. when은 최대 lookahead(100ms)만큼
    // 미래라, when 기준으로 회수하면 아직 울리고 있는 보이스를 페이드 없이
    // 끊는다. 하이햇(감쇠 50ms)처럼 엔벨로프 전체가 lookahead보다 짧은 소리는
    // 한창 울리는 도중에 잘려 클릭이 난다.
    this.reap(this.ctx.currentTime);

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

  /**
   * 살아있는 보이스 중 가장 늦게 끝나는 시각. 비어 있으면 0을 돌려줘
   * "지금 아무것도 안 울린다"를 명확히 나타낸다. 순수 조회이며 reap이나
   * disconnect 등 풀 상태를 건드리지 않는다 — 호출 시점에 따라 결과가
   * 달라지는 부작용이 있으면 auto-stop 판단에 쓰기 위험해진다.
   */
  latestEndsAt(): number {
    let latest = 0;
    for (const voice of this.active) {
      if (voice.endsAt > latest) {
        latest = voice.endsAt;
      }
    }
    return latest;
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
    // window.setTimeout이 아니라 전역 setTimeout으로 부른다. 브라우저에서는
    // 같은 함수이고, 테스트가 도는 node 환경에는 window가 없다.
    setTimeout(() => {
      gain.disconnect();
    }, delayMs);
  }

  /**
   * 이미 끝난 보이스를 회수한다. 여기서는 페이드 없이 바로 끊어도 되는데,
   * 엔벨로프가 endsAt에 정확히 0으로 내려가 있어 이미 무음이기 때문이다.
   * 그래서 `now`는 반드시 실제 현재 시각이어야 한다 — 미래 시각을 넘기면
   * 아직 소리가 남은 보이스를 무음으로 착각해 잘라낸다.
   */
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
