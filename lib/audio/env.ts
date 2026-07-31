"use client";

/** A4(69) = 440Hz 기준 평균율. */
export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * attack까지 peak로 올렸다가 decay 동안 떨어뜨린다.
 *
 * exponentialRampToValueAtTime의 목표값은 0이 될 수 없다(예외가 난다).
 * 0.0001까지 내린 뒤 setValueAtTime(0)으로 마무리한다.
 */
export function applyEnvelope(
  param: AudioParam,
  when: number,
  peak: number,
  attack: number,
  decay: number,
): void {
  const floor = 0.0001;
  param.setValueAtTime(floor, when);
  param.linearRampToValueAtTime(Math.max(peak, floor), when + attack);
  param.exponentialRampToValueAtTime(floor, when + attack + decay);
  param.setValueAtTime(0, when + attack + decay);
}

/**
 * 지금 값에서 짧게 페이드아웃시킨다. 뚝 자르면 클릭 노이즈가 난다.
 * voice stealing과 정지에서 쓴다.
 */
export function fadeOutAndStop(
  param: AudioParam,
  when: number,
  seconds = 0.005,
): void {
  const floor = 0.0001;
  param.cancelScheduledValues(when);
  param.setValueAtTime(Math.max(param.value, floor), when);
  param.exponentialRampToValueAtTime(floor, when + seconds);
  param.setValueAtTime(0, when + seconds);
}
