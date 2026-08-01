import { DRUM_HIHAT, DRUM_KICK, DRUM_SNARE, type LineKind } from "@/lib/score/types";

export const PX_PER_BAR = 120;

/** 마디 번호 눈금자. 헤더 열에도 같은 높이의 빈 칸을 둬야 행이 맞는다. */
export const RULER_HEIGHT = 26;

export const PITCHED_LINE_HEIGHT = 60;
export const DRUM_ROW_HEIGHT = 26;
export const DRUM_ROWS = [DRUM_KICK, DRUM_SNARE, DRUM_HIHAT] as const;
export const DRUM_LINE_HEIGHT = DRUM_ROW_HEIGHT * DRUM_ROWS.length;
export const HEADER_WIDTH = 132;

/**
 * 행 구분선을 border가 아니라 inset shadow로 그린다.
 *
 * border는 박스 높이를 1px 먹는다. 드럼 라인처럼 안쪽 3행의 높이 합이
 * 컨테이너 높이와 정확히 같아야 하는 경우, border를 쓰면 마지막 행이 1px
 * 밀려 헤더 열과 스테이지가 아래로 갈수록 어긋난다. shadow는 레이아웃에
 * 영향을 주지 않으므로 양쪽 높이가 정확히 일치한다.
 */
export const ROW_DIVIDER = "inset 0 -1px 0 rgb(255 255 255 / 0.07)";

/** @param perBar ticksPerBar(song.timeSignature) */
export function tickToPx(tick: number, perBar: number): number {
  return (tick / perBar) * PX_PER_BAR;
}

/** tickToPx의 역함수. 드래그 거리를 음악적 시간으로 되돌린다. */
export function pxToTick(px: number, perBar: number): number {
  return (px / PX_PER_BAR) * perBar;
}

/** 라인 높이는 데이터에서 계산하지 않고 kind별 상수로 둔다. */
export function lineHeight(kind: LineKind): number {
  return kind === "drum" ? DRUM_LINE_HEIGHT : PITCHED_LINE_HEIGHT;
}
