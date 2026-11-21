/**
 * 피아노롤 좌표·격자 순수 함수. DOM·React를 import하지 않는다.
 *
 * 가로: 한 박(`PPQ`=480틱) = `ROLL_PX_PER_BEAT`(96)px, 즉 1틱 = 0.2px. 편집 화면의 타임라인
 * (`../geometry.ts`, 1px = 12틱)과 다른 비율이다. 세로: 한 행 = 반음 하나 = `ROW_HEIGHT`px이고
 * 맨 위 행이 표시 범위의 `hi`다. 음 데이터에는 px을 저장하지 않는다 — 렌더 직전에만 환산한다.
 *
 * 비유한 입력(NaN·±Infinity)은 호출자가 `Number.isFinite`로 먼저 거르는 게 규칙이고, 여기서는
 * 틱↔x가 0, y→음높이가 `hi`(맨 위 행)로 안전하게 떨어진다.
 */

import { ROOT_NAMES, chordPitchClasses } from "@/lib/score/chords";
import {
  GRID_UNITS,
  MIN_VELOCITY,
  type GridUnit,
} from "@/lib/score/notes";
import { PPQ, type Chord, type Clip, type Note, type Song } from "@/lib/score/model";

export const ROLL_PX_PER_BEAT = 96;
export const ROW_HEIGHT = 20;
export const KEY_COLUMN_WIDTH = 56;
/** 격자 위 코드 띠 높이(px). */
export const ROLL_CHORD_STRIP_HEIGHT = 24;
/** 아래 세기 레인 높이(px). 막대 높이 = 세기 × 이 값. */
export const VELOCITY_LANE_HEIGHT = 80;
/** 세기 막대 하나의 폭(px). 음의 시작 x에 놓인다. */
export const VELOCITY_BAR_WIDTH = 8;

/** 틱 → 격자 안의 x(px). 곱셈을 먼저 해서 부동소수 오차를 피한다. */
export function rollTickToX(tick: number): number {
  if (!Number.isFinite(tick)) return 0;
  return (tick * ROLL_PX_PER_BEAT) / PPQ + 0;
}

/** x(px) → 가장 가까운 정수 틱. `-0`은 `+0`으로 정리한다. */
export function rollXToTick(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.round((x * PPQ) / ROLL_PX_PER_BEAT) + 0;
}

/** 음높이 → 행의 위쪽 y(px). `hi`는 표시 범위의 최고 음높이(맨 위 행). */
export function pitchToY(pitch: number, hi: number): number {
  return (hi - pitch) * ROW_HEIGHT;
}

/** y(px) → 그 y가 든 행의 음높이. */
export function yToPitch(y: number, hi: number): number {
  if (!Number.isFinite(y)) return hi;
  return hi - Math.floor(y / ROW_HEIGHT);
}

const BLACK_KEY_CLASSES = new Set([1, 3, 6, 8, 10]);

/** 음 이름. 60 → "C4"(옥타브 `floor(p/12) - 1`), 샤프 표기. */
export function noteName(pitch: number): string {
  return `${ROOT_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

export function isBlackKey(pitch: number): boolean {
  return BLACK_KEY_CLASSES.has(((pitch % 12) + 12) % 12);
}

/**
 * 세기 레인 안의 y(px, 레인 위 = 0) → 세기. `1 − y/높이`를 `[MIN_VELOCITY, 1]`로 클램프하고
 * 반올림하지 않는다. 레인 밖 y는 그대로 클램프된다. 비유한 값이나 높이가 0 이하면 null.
 */
export function velocityFromY(y: number, laneHeight: number): number | null {
  if (!Number.isFinite(y) || !Number.isFinite(laneHeight) || laneHeight <= 0) {
    return null;
  }
  return Math.min(Math.max(1 - y / laneHeight, MIN_VELOCITY), 1);
}

/** 음 하나의 격자 안 사각형(px). */
export function noteRect(
  note: Pick<Note, "start" | "length" | "pitch">,
  hi: number,
): { left: number; top: number; width: number; height: number } {
  return {
    left: rollTickToX(note.start),
    top: pitchToY(note.pitch, hi),
    width: rollTickToX(note.length),
    height: ROW_HEIGHT,
  };
}

/**
 * 클립 구간과 겹치는 코드 구간을 클립 기준 상대 틱으로 자른다. 진행은 곡을 빈틈없이 덮으므로
 * 결과는 클립 전체를 빈틈없이 덮는다.
 */
export function chordSegmentsInClip(
  song: Pick<Song, "progression">,
  clip: Pick<Clip, "start" | "length">,
): Array<{ start: number; length: number; chord: Chord }> {
  const clipEnd = clip.start + clip.length;
  const out: Array<{ start: number; length: number; chord: Chord }> = [];
  for (const seg of song.progression) {
    const from = Math.max(seg.start, clip.start);
    const to = Math.min(seg.start + seg.length, clipEnd);
    if (to > from) {
      out.push({ start: from - clip.start, length: to - from, chord: seg.chord });
    }
  }
  return out;
}

/** 코드 구성음의 피치 클래스 — 이 행들을 칠한다. */
export function chordToneRows(chord: Chord): number[] {
  return chordPitchClasses(chord);
}

const BAR_LINE = 0.11;
const BEAT_LINE = 0.035;
const UNIT_LINE = 0.02;

function verticalLines(alpha: number, periodPx: number): string {
  const color = `rgb(255 255 255 / ${alpha})`;
  return `linear-gradient(to right, ${color} 0, ${color} 1px, transparent 1px) 0 0 / ${periodPx}px 100%`;
}

/**
 * 세로 격자선(마디·박·선택한 격자 단위)의 CSS `background` 값. 레이어 순서는 위에서부터
 * 마디, 박, 단위이고 같은 간격의 레이어는 한 번만 쓴다. DOM 요소 없이 선을 긋는다.
 */
export function gridBackground(
  unit: GridUnit,
  ticksPerBeat: number,
  beatsPerBar: number,
): string {
  const bar = rollTickToX(ticksPerBeat * beatsPerBar);
  const beat = rollTickToX(ticksPerBeat);
  const step = rollTickToX(GRID_UNITS[unit]);
  const layers: string[] = [];
  const seen = new Set<number>();
  for (const [alpha, px] of [
    [BAR_LINE, bar],
    [BEAT_LINE, beat],
    [UNIT_LINE, step],
  ] as const) {
    if (!(px > 0) || seen.has(px)) continue;
    seen.add(px);
    layers.push(verticalLines(alpha, px));
  }
  return layers.join(", ");
}

/** 행 구분선 레이어(가로선, 행 아래쪽 1px). `gridBackground` 뒤에 붙인다. */
export const ROW_LINES_BACKGROUND = `linear-gradient(to bottom, transparent ${ROW_HEIGHT - 1}px, rgb(255 255 255 / 0.07) ${ROW_HEIGHT - 1}px) 0 0 / 100% ${ROW_HEIGHT}px`;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * 음 길이 표기: 온음(`PPQ * 4`틱) 대비 기약분수. 240 → "1/8", 360 → "3/16", 1920 → "1/1".
 * 격자에 안 맞는 길이(굽기로 생긴 음 등)도 정확히 보인다(7틱 → "7/1920").
 */
export function lengthLabel(ticks: number): string {
  const whole = PPQ * 4;
  const d = gcd(ticks, whole);
  return `${ticks / d}/${whole / d}`;
}

/**
 * 처음 열 때의 세로 스크롤 위치. 음이 있으면 음높이 범위의 가운데, 없으면 C4(60) 행이
 * 코드 띠 아래 보이는 영역의 가운데에 오게 한다. 0 아래로는 내리지 않는다.
 */
export function initialScrollTop(
  notes: readonly Pick<Note, "pitch">[],
  hi: number,
  viewportHeight: number,
): number {
  let center = 60;
  if (notes.length > 0) {
    let lo = Infinity;
    let top = -Infinity;
    for (const n of notes) {
      lo = Math.min(lo, n.pitch);
      top = Math.max(top, n.pitch);
    }
    center = (lo + top) / 2;
  }
  const visible = Math.max(
    0,
    (Number.isFinite(viewportHeight) ? viewportHeight : 0) - ROLL_CHORD_STRIP_HEIGHT,
  );
  const y = pitchToY(center, hi) + ROW_HEIGHT / 2 - visible / 2;
  return Math.max(0, y);
}
