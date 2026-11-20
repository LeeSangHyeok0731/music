/** 스케줄러가 시간을 읽는 통로. 실제 실행에서는 AudioContext가 이 모양을 만족한다. */
export interface AudioClock {
  readonly currentTime: number;
}

/** 스케줄러가 예약을 내보내는 통로. 실제 실행에서는 악기 디스패처가 받는다. */
export interface NoteSink {
  schedule(
    trackId: string,
    pitch: number,
    when: number,
    dur: number,
    vel: number,
  ): void;
}

/** 하나의 악기. when은 audioContext.currentTime 기준 절대 초. */
export interface Instrument {
  play(pitch: number, when: number, dur: number, vel: number): void;
}
