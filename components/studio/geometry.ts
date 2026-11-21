/**
 * 격자 좌표 변환 순수 함수. DOM·React를 import하지 않는다.
 *
 * 한 마디 = `BAR_TICKS`(1920)틱 = `PX_PER_BAR`(160)px, 즉 1px = 12틱. UI는 4/4만
 * 다룬다(모델은 다른 박자표를 허용하지만 편집 화면은 이 비율 하나만 쓴다).
 */

export const PX_PER_BAR = 160;
export const BAR_TICKS = 1920;

/** 틱 → 격자 안의 x(px). */
export function tickToX(tick: number): number {
  return (tick / BAR_TICKS) * PX_PER_BAR;
}

/** x(px) → 가장 가까운 정수 틱. 음수 입력은 음수 틱이 된다. */
export function xToTick(x: number): number {
  // `+ 0`: Math.round(-0.48)이 만드는 -0을 +0으로 바꾼다(toEqual·Object.is가 구분한다).
  return Math.round((x / PX_PER_BAR) * BAR_TICKS) + 0;
}

/**
 * 포인터의 화면 x를 곡 시작 기준 틱으로 바꾼다. `laneLeft`는 레인 요소의 화면상 왼쪽
 * 가장자리, `scrollLeft`는 레인 컨테이너가 스크롤된 양이다. 곡 시작보다 왼쪽은 0으로
 * 자른다(`Math.max(0, -0)`은 +0이다).
 */
export function pointerToTick(
  clientX: number,
  laneLeft: number,
  scrollLeft = 0,
): number {
  return Math.max(0, xToTick(clientX - laneLeft + scrollLeft));
}

/** 클립(시작 틱, 길이 틱)의 격자 위 왼쪽 위치와 너비(px). */
export function clipRect(
  start: number,
  length: number,
): { left: number; width: number } {
  return { left: tickToX(start), width: tickToX(length) };
}

/** 두 화면 x 사이의 틱 차이. 오른쪽으로 끌면 양수, 왼쪽이면 음수. */
export function deltaTicks(fromClientX: number, toClientX: number): number {
  return xToTick(toClientX - fromClientX);
}

/** 눈금자의 마디 번호 `[1..bars]`. `bars ≤ 0`이면 빈 배열. */
export function barLabels(bars: number): number[] {
  return Array.from({ length: Math.max(0, Math.floor(bars)) }, (_, i) => i + 1);
}
