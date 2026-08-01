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
 * `when` 시점의 값에서 짧게 페이드아웃시킨다. 뚝 자르면 클릭 노이즈가 난다.
 * voice stealing과 정지에서 쓴다.
 *
 * `when`은 미래일 수 있다 — voice stealing은 새 노트가 시작할 시각(최대
 * lookahead만큼 앞)에 옛 보이스를 끈다. 그래서 시작값을 `param.value`(지금
 * 값)로 잡으면 안 된다. 감쇠 중인 보이스는 `when`에 이미 더 낮아져 있어서,
 * 지금 값으로 되돌려 놓는 순간 값이 위로 튀어 막으려던 클릭이 거기서 난다.
 * `cancelAndHoldAtTime`은 `when` 시점의 자동화 값을 그대로 붙잡고 그 이후
 * 예약만 취소하므로 점프가 생기지 않는다.
 *
 * 페이드를 지수가 아니라 선형으로 내리는 이유: 붙잡은 값이 0일 수 있는데
 * (이미 감쇠가 끝난 보이스를 정지시키는 경우) 지수 램프는 시작값이 0이면
 * 성립하지 않는다. 5ms 선형 테이퍼는 어차피 귀에 클릭으로 들리지 않는다.
 */
export function fadeOutAndStop(
  param: AudioParam,
  when: number,
  seconds = 0.005,
): void {
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(when);
  } else {
    // 구형 브라우저 대비. 여기서는 시작값을 알 수 없어 지금 값으로 잡는다.
    const floor = 0.0001;
    param.cancelScheduledValues(when);
    param.setValueAtTime(Math.max(param.value, floor), when);
  }
  param.linearRampToValueAtTime(0, when + seconds);
}
