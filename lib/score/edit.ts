import {
  CHORD_QUALITIES,
  MAX_TEMPO,
  MIN_TEMPO,
  type Chord,
  type ChordSegment,
  type Clip,
  type ClipBody,
  type Song,
  type Track,
} from "@/lib/score/model";
import { patternsFor } from "@/lib/score/patterns";
import { songLengthTicks, ticksPerBar } from "@/lib/score/time";

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

// ---------------------------------------------------------------------------
// 클립·곡 전체 편집
// ---------------------------------------------------------------------------

/** 트랙 인덱스. 없으면 `Error`(호출자의 버그다 — UI는 존재하는 id만 넘긴다). */
function trackIndexOf(song: Song, trackId: string): number {
  const index = song.tracks.findIndex((t) => t.id === trackId);
  if (index < 0) throw new Error(`없는 트랙입니다: ${trackId}`);
  return index;
}

/** 트랙 안의 클립 인덱스. 없으면 `Error`. */
function clipIndexOf(track: Track, clipId: string): number {
  const index = track.clips.findIndex((c) => c.id === clipId);
  if (index < 0) throw new Error(`없는 클립입니다: ${clipId}`);
  return index;
}

/** 트랙 하나의 클립 목록만 갈아 끼운 새 곡. 나머지 트랙은 같은 객체를 공유한다. */
function withClips(song: Song, trackIndex: number, clips: Clip[]): Song {
  const tracks = song.tracks.map((t, i) =>
    i === trackIndex ? { ...t, clips } : t,
  );
  return { ...song, tracks };
}

/**
 * 클립 길이가 `length`로 줄었을 때의 본문. `notes`는 `start >= length`인 음을
 * 버리고 끝이 넘치는 음을 자른다. 바뀐 게 없으면 같은 본문 객체를 돌려준다.
 */
function fitBody(body: ClipBody, length: number): ClipBody {
  if (body.type !== "notes") return body;
  const kept = body.notes.filter((n) => n.start < length);
  const needsTrim = kept.some((n) => n.start + n.length > length);
  if (kept.length === body.notes.length && !needsTrim) return body;
  return {
    type: "notes",
    notes: kept.map((n) =>
      n.start + n.length > length ? { ...n, length: length - n.start } : n,
    ),
  };
}

/** 클립을 `length`로 맞춘다(줄이는 방향만). 줄일 필요가 없으면 같은 클립 객체. */
function fitClip(clip: Clip, length: number): Clip {
  if (length >= clip.length) return clip;
  return { ...clip, length, body: fitBody(clip.body, length) };
}

/** 이 번호 이상의 `clip-<n>`은 새 id 계산에서 무시한다(번호 올림이 멈추지 않는 일을 막는다). */
const MAX_CLIP_ID_NUMBER = 1e9;

function nextClipId(clips: readonly Clip[]): string {
  const taken = new Set(clips.map((c) => c.id));
  let max = 0;
  for (const c of clips) {
    const m = /^clip-(\d+)$/.exec(c.id);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < MAX_CLIP_ID_NUMBER && n > max) max = n;
  }
  let n = max + 1;
  while (taken.has(`clip-${n}`)) n++;
  return `clip-${n}`;
}

/**
 * 트랙의 `startTick`이 든 칸(스냅 격자의 바닥)에 새 패턴 클립을 놓는다. 길이는
 * 기본 한 마디이고 다음 클립·곡 끝까지의 빈 공간이 모자라면 반마디 단위로 줄인다.
 * 곡 밖이거나, 이미 클립이 있는 칸이거나, 반마디도 안 남았으면 no-op.
 * 없는 `trackId`는 `Error`.
 */
export function addClip(song: Song, trackId: string, startTick: number): Song {
  const ti = trackIndexOf(song, trackId);
  const track = song.tracks[ti];
  const songLength = songLengthTicks(song);

  const s = Math.floor(startTick / SNAP_TICKS) * SNAP_TICKS;
  if (!Number.isFinite(s) || s < 0 || s + SNAP_TICKS > songLength) return song;
  if (track.clips.some((c) => c.start <= s && s < c.start + c.length)) {
    return song;
  }

  const following = track.clips.find((c) => c.start > s);
  const free = (following ? following.start : songLength) - s;
  const length =
    Math.floor(Math.min(DEFAULT_CLIP_TICKS, free) / SNAP_TICKS) * SNAP_TICKS;
  if (length < SNAP_TICKS) return song;

  const clip: Clip = {
    id: nextClipId(track.clips),
    start: s,
    length,
    body: { type: "pattern", pattern: patternsFor(track.instrument)[0].id },
  };
  const at = track.clips.filter((c) => c.start < s).length;
  return withClips(song, ti, [
    ...track.clips.slice(0, at),
    clip,
    ...track.clips.slice(at),
  ]);
}

/**
 * 클립을 `startTick`(스냅)으로 옮긴다. 앞 클립의 끝과 뒤 클립의 시작(없으면 곡
 * 끝) 사이로 클램프하고, 결과가 지금 위치와 같으면 no-op. 없는 id는 `Error`.
 */
export function moveClip(
  song: Song,
  trackId: string,
  clipId: string,
  startTick: number,
): Song {
  const ti = trackIndexOf(song, trackId);
  const track = song.tracks[ti];
  const ci = clipIndexOf(track, clipId);
  const clip = track.clips[ci];
  const previous = track.clips[ci - 1];
  const following = track.clips[ci + 1];

  const lower = previous ? previous.start + previous.length : 0;
  const upper =
    (following ? following.start : songLengthTicks(song)) - clip.length;
  if (upper < lower) return song;

  const snapped = snapTick(startTick);
  if (Number.isNaN(snapped)) return song;
  const t = Math.min(Math.max(snapped, lower), upper);
  if (t === clip.start) return song;

  return withClips(
    song,
    ti,
    track.clips.map((c, i) => (i === ci ? { ...c, start: t } : c)),
  );
}

/**
 * 클립 길이를 `lengthTicks`(스냅)로 바꾼다. 최소 반마디이고 뒤 클립의 시작(없으면
 * 곡 끝)을 넘지 못한다. `notes` 본문은 줄어든 길이를 넘는 음을 정리한다. 길이가
 * 그대로면 no-op. 없는 id는 `Error`.
 */
export function resizeClip(
  song: Song,
  trackId: string,
  clipId: string,
  lengthTicks: number,
): Song {
  const ti = trackIndexOf(song, trackId);
  const track = song.tracks[ti];
  const ci = clipIndexOf(track, clipId);
  const clip = track.clips[ci];
  const following = track.clips[ci + 1];

  const upper =
    (following ? following.start : songLengthTicks(song)) - clip.start;
  const snapped = snapTick(lengthTicks);
  if (Number.isNaN(snapped)) return song;
  // 빈 공간이 반마디보다 좁으면 `upper`가 이긴다.
  const length = Math.min(Math.max(snapped, SNAP_TICKS), upper);
  if (length === clip.length) return song;

  const resized: Clip =
    length < clip.length ? fitClip(clip, length) : { ...clip, length };
  return withClips(
    song,
    ti,
    track.clips.map((c, i) => (i === ci ? resized : c)),
  );
}

/** 클립을 지운다. 없는 id는 `Error`. */
export function removeClip(
  song: Song,
  trackId: string,
  clipId: string,
): Song {
  const ti = trackIndexOf(song, trackId);
  const track = song.tracks[ti];
  const ci = clipIndexOf(track, clipId);
  return withClips(
    song,
    ti,
    track.clips.filter((_, i) => i !== ci),
  );
}

function assertPatternFits(track: Track, patternId: string): void {
  if (!patternsFor(track.instrument).some((p) => p.id === patternId)) {
    throw new Error(
      `${track.instrument} 트랙에 쓸 수 없는 패턴입니다: ${patternId}`,
    );
  }
}

/**
 * 패턴 클립의 패턴을 바꾼다. 같은 패턴이면 no-op. 없는 id, `notes` 본문,
 * 악기에 쓸 수 없는 패턴은 `Error`.
 */
export function setClipPattern(
  song: Song,
  trackId: string,
  clipId: string,
  patternId: string,
): Song {
  const ti = trackIndexOf(song, trackId);
  const track = song.tracks[ti];
  const ci = clipIndexOf(track, clipId);
  const clip = track.clips[ci];
  if (clip.body.type !== "pattern") {
    throw new Error("notes 클립에는 패턴이 없습니다");
  }
  assertPatternFits(track, patternId);
  if (clip.body.pattern === patternId) return song;

  return withClips(
    song,
    ti,
    track.clips.map((c, i) =>
      i === ci
        ? { ...c, body: { type: "pattern" as const, pattern: patternId } }
        : c,
    ),
  );
}

/**
 * 트랙의 모든 패턴 클립에 같은 패턴을 쓴다. `notes` 클립은 건드리지 않는다.
 * 바뀐 클립이 없으면 no-op. 없는 트랙이나 악기에 쓸 수 없는 패턴은 `Error`.
 */
export function setTrackPattern(
  song: Song,
  trackId: string,
  patternId: string,
): Song {
  const ti = trackIndexOf(song, trackId);
  const track = song.tracks[ti];
  assertPatternFits(track, patternId);

  let changed = false;
  const clips = track.clips.map((c) => {
    if (c.body.type !== "pattern" || c.body.pattern === patternId) return c;
    changed = true;
    return { ...c, body: { type: "pattern" as const, pattern: patternId } };
  });
  return changed ? withClips(song, ti, clips) : song;
}

/**
 * 곡 길이를 `bars`마디로 바꾼다(반올림 후 `MIN_BARS`~`MAX_BARS_UI`로 클램프, NaN은
 * no-op). 늘리면 진행의 마지막 구간이 늘어나 곡 끝까지 덮고, 줄이면 새 끝 뒤의
 * 진행 구간·클립은 지우고 걸친 것은 새 끝까지 자른다(`notes` 음도 같은 규칙).
 */
export function setBars(song: Song, bars: number): Song {
  const rounded = Math.round(bars);
  if (Number.isNaN(rounded)) return song;
  const b = Math.min(Math.max(rounded, MIN_BARS), MAX_BARS_UI);
  if (b === song.bars) return song;

  const oldLength = songLengthTicks(song);
  const newLength = b * ticksPerBar(song.timeSignature);

  if (newLength > oldLength) {
    const last = song.progression.length - 1;
    const progression = song.progression.map((seg, i) =>
      i === last
        ? { ...seg, length: seg.length + (newLength - oldLength) }
        : seg,
    );
    return { ...song, bars: b, progression };
  }

  const progression = song.progression
    .filter((seg) => seg.start < newLength)
    .map((seg) =>
      seg.start + seg.length > newLength
        ? { ...seg, length: newLength - seg.start }
        : seg,
    );
  const tracks = song.tracks.map((track) => {
    const clips = track.clips
      .filter((c) => c.start < newLength)
      .map((c) => fitClip(c, newLength - c.start));
    const same =
      clips.length === track.clips.length &&
      clips.every((c, i) => c === track.clips[i]);
    return same ? track : { ...track, clips };
  });
  return { ...song, bars: b, progression, tracks };
}

/** 템포(bpm)를 반올림해 `MIN_TEMPO`~`MAX_TEMPO`로 클램프한다. 같거나 NaN이면 no-op. */
export function setTempo(song: Song, bpm: number): Song {
  const rounded = Math.round(bpm);
  if (Number.isNaN(rounded)) return song;
  const tempo = Math.min(Math.max(rounded, MIN_TEMPO), MAX_TEMPO);
  if (tempo === song.tempo) return song;
  return { ...song, tempo };
}
