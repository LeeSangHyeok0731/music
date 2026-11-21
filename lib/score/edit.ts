import {
  CHORD_QUALITIES,
  type Chord,
  type ChordSegment,
  type Song,
} from "@/lib/score/model";

/**
 * 순수 편집 함수. UI는 이 함수만 부르고 규칙은 전부 여기에 둔다.
 *
 * - 입력 `song`은 변형하지 않고 새 `Song`을 돌려준다. 건드리지 않은 구간·클립·
 *   코드 객체는 입력과 **구조를 공유**한다(불변 갱신의 표준 방식) — 호출자는 결과의
 *   코드 객체를 제자리에서 고치지 않는다. 새로 만드는 구간은 코드를 값으로 복사한다.
 * - 아무것도 바뀌지 않으면 **같은 참조**를 돌려준다. 실행취소가 빈 칸을 쌓지 않게 하기 위해서다.
 * - 결과는 항상 `validateSong(result) === []`이다.
 */

/** 4/4 반마디. 위치·길이 격자 단위(틱). */
export const SNAP_TICKS = 960;
/** 새 클립의 기본 길이: 한 마디(4/4). */
export const DEFAULT_CLIP_TICKS = 1920;
/** UI가 허용하는 마디 수 범위(모델 상한 `MAX_BARS`와 별개). */
export const MIN_BARS = 1;
export const MAX_BARS_UI = 64;

/**
 * 가장 가까운 격자로 반올림한다. 정확히 반 칸(.5)은 `Math.round`가 +무한대
 * 쪽으로 보내므로 위 격자가 된다(480 -> 960).
 */
export function snapTick(tick: number): number {
  return Math.round(tick / SNAP_TICKS) * SNAP_TICKS;
}

function sameChord(a: Chord, b: Chord): boolean {
  return a.root === b.root && a.quality === b.quality;
}

/** 곡 안에 같은 객체가 두 구간에 끼지 않도록 값만 복사한다. */
function copyChord(chord: Chord): Chord {
  return { root: chord.root, quality: chord.quality };
}

/** `index`가 정수이고 `0 <= index < limit`인지. NaN·소수는 거부한다. */
function isIndexBelow(index: number, limit: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < limit;
}

/**
 * 구간 `index`의 코드를 바꾼다. 같은 코드면 no-op. 범위 밖 `index`와 유효하지
 * 않은 `chord`(root가 0..11의 정수가 아니거나 알 수 없는 quality)는 RangeError —
 * no-op 검사보다 먼저 던져서 결과가 항상 `validateSong`을 통과하게 한다.
 */
export function setChord(song: Song, index: number, chord: Chord): Song {
  const segments = song.progression;
  if (!isIndexBelow(index, segments.length)) {
    throw new RangeError(`코드 진행에 없는 구간입니다: ${index}`);
  }
  if (
    !Number.isInteger(chord.root) ||
    chord.root < 0 ||
    chord.root > 11 ||
    !(CHORD_QUALITIES as readonly string[]).includes(chord.quality)
  ) {
    throw new RangeError(
      `유효하지 않은 코드입니다: ${chord.root} ${chord.quality}`,
    );
  }
  if (sameChord(segments[index].chord, chord)) return song;
  const progression = segments.map((seg, i) =>
    i === index ? { ...seg, chord: copyChord(chord) } : seg,
  );
  return { ...song, progression };
}

/**
 * 스냅한 `tick`에서 구간을 같은 코드의 둘로 쪼갠다. `tick`이 구간 안쪽이고
 * 양쪽이 모두 반마디(`SNAP_TICKS`) 이상일 때만. 아니면 no-op.
 */
export function splitSegment(song: Song, tick: number): Song {
  const t = snapTick(tick);
  const segments = song.progression;
  const index = segments.findIndex(
    (seg) => seg.start < t && t < seg.start + seg.length,
  );
  if (index < 0) return song; // 경계 위, 곡 밖, NaN
  const seg = segments[index];
  const end = seg.start + seg.length;
  if (t - seg.start < SNAP_TICKS || end - t < SNAP_TICKS) return song;

  const left: ChordSegment = {
    start: seg.start,
    length: t - seg.start,
    chord: copyChord(seg.chord),
  };
  const right: ChordSegment = {
    start: t,
    length: end - t,
    chord: copyChord(seg.chord),
  };
  const progression = [
    ...segments.slice(0, index),
    left,
    right,
    ...segments.slice(index + 1),
  ];
  return { ...song, progression };
}

/**
 * 구간 `index`와 `index + 1` 사이의 경계를 `tick`(스냅)으로 옮긴다. 양쪽이
 * 반마디 이상 남도록 클램프하고, 결과가 지금 경계와 같으면 no-op.
 * `index`가 `0 <= index < 구간 수 - 1`이 아니면 RangeError(마지막 구간 뒤에는 경계가 없다).
 */
export function moveBoundary(song: Song, index: number, tick: number): Song {
  const segments = song.progression;
  if (!isIndexBelow(index, segments.length - 1)) {
    throw new RangeError(`코드 진행에 없는 경계입니다: ${index}`);
  }
  const a = segments[index];
  const b = segments[index + 1];
  const bEnd = b.start + b.length;
  const lo = a.start + SNAP_TICKS;
  const hi = bEnd - SNAP_TICKS;
  if (lo > hi) return song;

  const snapped = snapTick(tick);
  if (Number.isNaN(snapped)) return song;
  const t = Math.min(Math.max(snapped, lo), hi);
  if (t === b.start) return song;

  const progression = segments.map((seg, i) => {
    if (i === index) return { ...seg, length: t - a.start };
    if (i === index + 1) return { ...seg, start: t, length: bEnd - t };
    return seg;
  });
  return { ...song, progression };
}

/**
 * 구간 `index`와 `index + 1`을 왼쪽 코드로 합친다. 구간이 하나뿐이면 `index`와
 * 무관하게 no-op(먼저 검사). 그 밖에 `index`가 `0 <= index < 구간 수 - 1`이
 * 아니면 RangeError.
 */
export function mergeSegments(song: Song, index: number): Song {
  const segments = song.progression;
  if (segments.length <= 1) return song;
  if (!isIndexBelow(index, segments.length - 1)) {
    throw new RangeError(`코드 진행에 없는 경계입니다: ${index}`);
  }
  const a = segments[index];
  const b = segments[index + 1];
  const merged: ChordSegment = {
    start: a.start,
    length: a.length + b.length,
    chord: copyChord(a.chord),
  };
  const progression = [
    ...segments.slice(0, index),
    merged,
    ...segments.slice(index + 2),
  ];
  return { ...song, progression };
}
