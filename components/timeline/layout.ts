import { DRUM_HIHAT, DRUM_KICK, DRUM_SNARE, type LineKind } from "@/lib/score/types";

export const PX_PER_BAR = 120;
export const PITCHED_LINE_HEIGHT = 32;
export const DRUM_ROW_HEIGHT = 20;
export const DRUM_ROWS = [DRUM_KICK, DRUM_SNARE, DRUM_HIHAT] as const;
export const DRUM_LINE_HEIGHT = DRUM_ROW_HEIGHT * DRUM_ROWS.length;
export const HEADER_WIDTH = 88;

/** @param perBar ticksPerBar(song.timeSignature) */
export function tickToPx(tick: number, perBar: number): number {
  return (tick / perBar) * PX_PER_BAR;
}

/** 라인 높이는 데이터에서 계산하지 않고 kind별 상수로 둔다. */
export function lineHeight(kind: LineKind): number {
  return kind === "drum" ? DRUM_LINE_HEIGHT : PITCHED_LINE_HEIGHT;
}
