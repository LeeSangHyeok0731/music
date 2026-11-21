import { addClip } from "@/lib/score/edit";
import { bakeClipInSong } from "@/lib/score/expand";
import type {
  Clip,
  InstrumentId,
  Note,
  Song,
  Track,
} from "@/lib/score/model";

/**
 * 음 클립(피아노롤)의 순수 편집 규칙. `edit.ts`와 같은 약속을 지킨다.
 *
 * - 입력 `song`은 변형하지 않고 새 `Song`을 돌려준다. 건드리지 않은 트랙·클립·음은
 *   입력과 구조를 공유한다.
 * - 아무것도 바뀌지 않으면 **같은 참조**를 돌려준다(실행취소가 빈 칸을 쌓지 않는다).
 * - 결과는 항상 `validateSong(result) === []`이다.
 * - 편집 함수가 추가로 지키는 규칙(`validateSong`의 검사가 아니다): 같은 음높이끼리
 *   구간 `[start, start+length)`이 겹치지 않는다(맞닿음은 허용), 음은 클립 안에 있다,
 *   세기는 `[MIN_VELOCITY, 1]`이다. 손으로 고친 곡은 이 규칙을 어길 수 있고, 그런
 *   곡에서도 편집 결과는 `validateSong`을 통과한다.
 *
 * 계획 함수(`plan*`)는 `{ song, keys }`를 돌려준다. `keys`는 결과의 선택 키다 —
 * UI가 미리보기와 선택 갱신에 같은 계산을 쓴다. 입력 키는 먼저 클립에 실제로 있는
 * 음으로 거른다(낡은 키·중복 키 무시, 같은 `(start,pitch)`가 둘이면 첫 음).
 */

/** 격자 단위(틱). 위치 스냅과 길이 최소·기본값의 단위다. */
export const GRID_UNITS = { "1/4": 480, "1/8": 240, "1/16": 120 } as const;
export type GridUnit = keyof typeof GRID_UNITS;

export const DEFAULT_VELOCITY = 0.8;
/** 편집 함수가 만드는 세기의 하한. 무음 음을 만들지 않는다. */
export const MIN_VELOCITY = 0.05;

/** 클립 안에서 음을 가리키는 키: `${start}:${pitch}`. 음에 id는 없다. */
export type NoteKey = string;

export function noteKey(n: Pick<Note, "start" | "pitch">): NoteKey {
  return `${n.start}:${n.pitch}`;
}

export type ChordalInstrument = Exclude<InstrumentId, "drums">;

/** 악기별 음높이 UI 범위(샘플 팩 존 기준). 모델은 0..127을 허용한다. */
export const PITCH_RANGE: Record<ChordalInstrument, { lo: number; hi: number }> = {
  piano: { lo: 36, hi: 96 },
  guitar: { lo: 40, hi: 84 },
  bass: { lo: 28, hi: 60 },
};

/**
 * 표시 범위 = 표의 범위 ∪ (클립에 있는 음의 음높이 ± 2), 0..127로 클램프.
 * 범위 밖 음이 있는 클립도 화면에서 잘리지 않게 한다. 새 음·이동 결과도 이 범위로 제한한다.
 */
export function displayRange(
  instrument: ChordalInstrument,
  notes: readonly Note[],
): { lo: number; hi: number } {
  let { lo, hi } = PITCH_RANGE[instrument];
  for (const n of notes) {
    lo = Math.min(lo, n.pitch - 2);
    hi = Math.max(hi, n.pitch + 2);
  }
  return { lo: Math.max(lo, 0), hi: Math.min(hi, 127) };
}

export type NotePlan = { song: Song; keys: NoteKey[] };
export type NoteBox = {
  startTick: number;
  endTick: number;
  loPitch: number;
  hiPitch: number;
};

// ---------------------------------------------------------------------------
// 내부 도우미
// ---------------------------------------------------------------------------

type Target = {
  trackIndex: number;
  clipIndex: number;
  track: Track;
  clip: Clip;
};

function findTarget(song: Song, trackId: string, clipId: string): Target {
  const trackIndex = song.tracks.findIndex((t) => t.id === trackId);
  if (trackIndex < 0) throw new Error(`없는 트랙입니다: ${trackId}`);
  const track = song.tracks[trackIndex];
  const clipIndex = track.clips.findIndex((c) => c.id === clipId);
  if (clipIndex < 0) throw new Error(`없는 클립입니다: ${clipId}`);
  return { trackIndex, clipIndex, track, clip: track.clips[clipIndex] };
}

type NotesTarget = Target & {
  instrument: ChordalInstrument;
  notes: readonly Note[];
};

/** 편집할 음 클립. 드럼 트랙·`pattern` 클립은 `Error`. */
function findNotesTarget(song: Song, trackId: string, clipId: string): NotesTarget {
  const target = findTarget(song, trackId, clipId);
  const { instrument } = target.track;
  if (instrument === "drums") {
    throw new Error("화음 악기의 음 클립만 편집합니다");
  }
  const { body } = target.clip;
  if (body.type !== "notes") throw new Error("notes 클립이 아닙니다");
  return { ...target, instrument, notes: body.notes };
}

/** 대상 클립 하나만 갈아 끼운 새 곡. 나머지 트랙·클립은 같은 객체를 공유한다. */
function withClip(song: Song, target: Target, clip: Clip): Song {
  const tracks = song.tracks.map((t, ti) =>
    ti !== target.trackIndex
      ? t
      : { ...t, clips: t.clips.map((c, ci) => (ci === target.clipIndex ? clip : c)) },
  );
  return { ...song, tracks };
}

function withNotes(song: Song, target: NotesTarget, notes: Note[]): Song {
  return withClip(song, target, {
    ...target.clip,
    body: { type: "notes", notes },
  });
}

/** 입력 키를 클립에 실제로 있는 음의 인덱스로 거른다. 키 순서를 유지하고 중복은 한 번. */
function resolveKeys(
  notes: readonly Note[],
  keys: readonly NoteKey[],
): { indices: number[]; keys: NoteKey[] } {
  const first = new Map<NoteKey, number>();
  notes.forEach((n, i) => {
    const k = noteKey(n);
    if (!first.has(k)) first.set(k, i);
  });
  const indices: number[] = [];
  const kept: NoteKey[] = [];
  const seen = new Set<NoteKey>();
  for (const k of keys) {
    const i = first.get(k);
    if (i === undefined || seen.has(k)) continue;
    seen.add(k);
    indices.push(i);
    kept.push(k);
  }
  return { indices, keys: kept };
}

/** start 오름차순 안정 정렬한 사본. 입력 배열은 건드리지 않는다. */
function sortedByStart(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => a.start - b.start);
}

function clampVelocity(v: number): number {
  return Math.min(Math.max(v, MIN_VELOCITY), 1);
}

function overlaps(a: Note, b: Note): boolean {
  return a.start < b.start + b.length && b.start < a.start + a.length;
}

// ---------------------------------------------------------------------------
// 클립 본문 바꾸기
// ---------------------------------------------------------------------------

/**
 * `pattern` 클립을 그 시점의 코드 진행으로 펼친 `notes` 클립으로 바꾼다(한 방향).
 * 굽기 전후의 `expandSong` 결과는 같다. `notes` 클립이면 no-op. 드럼을 포함한
 * 모든 악기에서 동작한다. 없는 트랙·클립은 `Error`.
 */
export function bakeClipToNotes(song: Song, trackId: string, clipId: string): Song {
  const { clip } = findTarget(song, trackId, clipId);
  if (clip.body.type === "notes") return song;
  return bakeClipInSong(song, trackId, clipId);
}

/**
 * `pattern` 클립을 같은 id·start·length의 빈 `notes` 클립으로 바꾼다.
 * `notes` 클립이면 no-op. 없는 트랙·클립은 `Error`.
 */
export function emptyNotesClip(song: Song, trackId: string, clipId: string): Song {
  const target = findTarget(song, trackId, clipId);
  if (target.clip.body.type === "notes") return song;
  return withClip(song, target, {
    ...target.clip,
    body: { type: "notes", notes: [] },
  });
}

/**
 * 빈 칸에 빈 `notes` 클립을 한 번에 만든다: `addClip`이 정하는 자리·길이·id를 그대로 쓰되 본문이
 * 패턴이 아니라 빈 음 목록이다(UI의 Shift+클릭 한 동작 = 실행취소 한 칸). 자리가 없으면 no-op
 * (같은 참조). 드럼 트랙·없는 트랙은 `Error`(자리가 있든 없든).
 */
export function addEmptyNotesClip(
  song: Song,
  trackId: string,
  startTick: number,
): Song {
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`없는 트랙입니다: ${trackId}`);
  if (track.instrument === "drums") {
    throw new Error("화음 악기의 음 클립만 편집합니다");
  }
  const added = addClip(song, trackId, startTick);
  if (added === song) return song;
  const before = new Set(track.clips.map((c) => c.id));
  const created = added.tracks
    .find((t) => t.id === trackId)
    ?.clips.find((c) => !before.has(c.id));
  if (!created) return song;
  return emptyNotesClip(added, trackId, created.id);
}

// ---------------------------------------------------------------------------
// 음 편집 계획
// ---------------------------------------------------------------------------

/**
 * `spec.start`가 든 칸의 시작(내림)에 음을 추가한다. 길이는 생략하면 한 칸, 주면
 * 칸 단위로 내림(최소 한 칸)하고, 클립 끝과 다음 같은 음높이 음의 시작에서 자른다.
 * 같은 음높이의 기존 음이 시작 위치를 품거나, 위치가 클립 밖이거나, 음높이가 정수가
 * 아니거나 표시 범위 밖이거나, 인자가 NaN이면 no-op. 세기는 `[0.05, 1]`로 클램프
 * (생략 시 0.8). 새 음은 같은 start의 음들 뒤에 들어간다.
 */
export function planAddNote(
  song: Song,
  trackId: string,
  clipId: string,
  spec: { start: number; pitch: number; length?: number; velocity?: number },
  unit: GridUnit,
): NotePlan {
  const target = findNotesTarget(song, trackId, clipId);
  const { notes, clip } = target;
  const noop: NotePlan = { song, keys: [] };
  const u = GRID_UNITS[unit];

  const start = Math.floor(spec.start / u) * u;
  if (!Number.isFinite(start) || start < 0 || start >= clip.length) return noop;

  const { pitch } = spec;
  const range = displayRange(target.instrument, notes);
  if (!Number.isInteger(pitch) || pitch < range.lo || pitch > range.hi) return noop;

  let length =
    spec.length === undefined ? u : Math.max(Math.floor(spec.length / u) * u, u);
  if (Number.isNaN(length)) return noop;

  const velocity =
    spec.velocity === undefined ? DEFAULT_VELOCITY : clampVelocity(spec.velocity);
  if (Number.isNaN(velocity)) return noop;

  length = Math.min(length, clip.length - start);
  for (const n of notes) {
    if (n.pitch !== pitch) continue;
    if (n.start <= start && start < n.start + n.length) return noop;
    if (n.start > start) length = Math.min(length, n.start - start);
  }

  const note: Note = { start, length, pitch, velocity };
  const at = notes.findIndex((n) => n.start > start);
  const next =
    at < 0 ? [...notes, note] : [...notes.slice(0, at), note, ...notes.slice(at)];
  return { song: withNotes(song, target, next), keys: [noteKey(note)] };
}

/**
 * 선택한 음들을 한 덩어리로 옮긴다. `dTicks`는 칸 단위로 반올림, `dPitch`는 정수로
 * 반올림한다. 결과 중 하나라도 클립 밖, 표시 범위(원래 클립의 음 기준) 밖이거나,
 * 옮긴 음이 같은 음높이의 다른 음(옮긴 것끼리 포함)과 겹치면 **전체 거부**(no-op).
 * 옮기지 않은 음끼리의 기존 겹침은 보지 않는다. 결과는 start 오름차순(안정 정렬).
 */
export function planMoveNotes(
  song: Song,
  trackId: string,
  clipId: string,
  keys: readonly NoteKey[],
  dTicks: number,
  dPitch: number,
  unit: GridUnit,
): NotePlan {
  const target = findNotesTarget(song, trackId, clipId);
  const { notes, clip } = target;
  const resolved = resolveKeys(notes, keys);
  const noop: NotePlan = { song, keys: resolved.keys };
  if (resolved.indices.length === 0) return noop;

  const u = GRID_UNITS[unit];
  const dt = Math.round(dTicks / u) * u;
  const dp = Math.round(dPitch);
  if (Number.isNaN(dt) || Number.isNaN(dp)) return noop;
  if (dt === 0 && dp === 0) return noop;

  const range = displayRange(target.instrument, notes);
  const movedSet = new Set(resolved.indices);
  const moved: Note[] = [];
  for (const i of resolved.indices) {
    const n = notes[i];
    const m: Note = { ...n, start: n.start + dt, pitch: n.pitch + dp };
    if (m.start < 0 || m.start + m.length > clip.length) return noop;
    if (m.pitch < range.lo || m.pitch > range.hi) return noop;
    moved.push(m);
  }

  // 옮긴 음 각각을, 옮긴 다른 음과 옮기지 않은 음 모두와 비교한다.
  const stayed = notes.filter((_, i) => !movedSet.has(i));
  for (let a = 0; a < moved.length; a++) {
    const m = moved[a];
    for (const s of stayed) {
      if (s.pitch === m.pitch && overlaps(s, m)) return noop;
    }
    for (let b = a + 1; b < moved.length; b++) {
      if (moved[b].pitch === m.pitch && overlaps(moved[b], m)) return noop;
    }
  }

  const replacement = new Map<number, Note>();
  resolved.indices.forEach((i, j) => replacement.set(i, moved[j]));
  const next = sortedByStart(notes.map((n, i) => replacement.get(i) ?? n));
  return { song: withNotes(song, target, next), keys: moved.map(noteKey) };
}

/**
 * 선택한 음들의 길이에 같은 변화량을 준다. 변화량은 칸 단위로 반올림하고, 모든 음이
 * 만족하는 범위로 **덩어리째** 클램프한다: 음마다 최소 한 칸(남은 공간이 더 좁으면
 * 그만큼), 최대 클립 끝·다음 같은 음높이 음의 시작까지. 범위가 비었거나, 변화량이
 * 0이거나, 클램프 결과가 요청과 반대 방향이면 no-op(격자보다 짧은 음을 줄이려다
 * 늘이지 않는다). 시작·음높이는 그대로라 `keys`는 걸러진 입력 키다.
 */
export function planResizeNotes(
  song: Song,
  trackId: string,
  clipId: string,
  keys: readonly NoteKey[],
  dLength: number,
  unit: GridUnit,
): NotePlan {
  const target = findNotesTarget(song, trackId, clipId);
  const { notes, clip } = target;
  const resolved = resolveKeys(notes, keys);
  const noop: NotePlan = { song, keys: resolved.keys };
  if (resolved.indices.length === 0) return noop;

  const u = GRID_UNITS[unit];
  const d = Math.round(dLength / u) * u;
  if (Number.isNaN(d) || d === 0) return noop;

  let lower = Number.NEGATIVE_INFINITY;
  let upper = Number.POSITIVE_INFINITY;
  for (const i of resolved.indices) {
    const n = notes[i];
    let maxLen = clip.length - n.start;
    for (const o of notes) {
      if (o.pitch === n.pitch && o.start > n.start) {
        maxLen = Math.min(maxLen, o.start - n.start);
      }
    }
    const minLen = Math.min(u, maxLen);
    lower = Math.max(lower, minLen - n.length);
    upper = Math.min(upper, maxLen - n.length);
  }
  if (upper < lower) return noop;

  const dEff = Math.min(Math.max(d, lower), upper);
  if (dEff === 0 || Math.sign(dEff) !== Math.sign(d)) return noop;

  const selected = new Set(resolved.indices);
  const next = notes.map((n, i) =>
    selected.has(i) ? { ...n, length: n.length + dEff } : n,
  );
  return { song: withNotes(song, target, next), keys: resolved.keys };
}

/** 키에 해당하는 음을 지운다. 지울 게 없으면 no-op. `keys`는 항상 `[]`. */
export function planRemoveNotes(
  song: Song,
  trackId: string,
  clipId: string,
  keys: readonly NoteKey[],
): NotePlan {
  const target = findNotesTarget(song, trackId, clipId);
  const resolved = resolveKeys(target.notes, keys);
  if (resolved.indices.length === 0) return { song, keys: [] };
  const removed = new Set(resolved.indices);
  const next = target.notes.filter((_, i) => !removed.has(i));
  return { song: withNotes(song, target, next), keys: [] };
}

/**
 * 선택한 음의 세기를 `[0.05, 1]`로 클램프한 같은 값으로 바꾼다. NaN이거나 모두 이미
 * 그 값이면 no-op. `keys`는 걸러진 입력 키.
 */
export function planSetVelocities(
  song: Song,
  trackId: string,
  clipId: string,
  keys: readonly NoteKey[],
  velocity: number,
): NotePlan {
  const target = findNotesTarget(song, trackId, clipId);
  const resolved = resolveKeys(target.notes, keys);
  const noop: NotePlan = { song, keys: resolved.keys };
  const v = clampVelocity(velocity);
  if (Number.isNaN(v)) return noop;

  const selected = new Set(resolved.indices);
  let changed = false;
  const next = target.notes.map((n, i) => {
    if (!selected.has(i) || n.velocity === v) return n;
    changed = true;
    return { ...n, velocity: v };
  });
  if (!changed) return noop;
  return { song: withNotes(song, target, next), keys: resolved.keys };
}

/**
 * 박스(틱 구간 `[startTick, endTick)`·음높이 구간 `[loPitch, hiPitch]`)와 겹치는 음의
 * 키(음 배열 순서). 박스 값이 NaN이면 `[]`.
 */
export function selectNotesInBox(
  song: Song,
  trackId: string,
  clipId: string,
  box: NoteBox,
): NoteKey[] {
  const { notes } = findNotesTarget(song, trackId, clipId);
  const { startTick, endTick, loPitch, hiPitch } = box;
  if ([startTick, endTick, loPitch, hiPitch].some(Number.isNaN)) return [];
  return notes
    .filter(
      (n) =>
        n.start < endTick &&
        n.start + n.length > startTick &&
        loPitch <= n.pitch &&
        n.pitch <= hiPitch,
    )
    .map(noteKey);
}

// ---------------------------------------------------------------------------
// 곡만 돌려주는 얇은 편집 함수
// ---------------------------------------------------------------------------

export function addNote(...args: Parameters<typeof planAddNote>): Song {
  return planAddNote(...args).song;
}

export function moveNotes(...args: Parameters<typeof planMoveNotes>): Song {
  return planMoveNotes(...args).song;
}

export function resizeNotes(...args: Parameters<typeof planResizeNotes>): Song {
  return planResizeNotes(...args).song;
}

export function removeNotes(...args: Parameters<typeof planRemoveNotes>): Song {
  return planRemoveNotes(...args).song;
}

export function setVelocities(...args: Parameters<typeof planSetVelocities>): Song {
  return planSetVelocities(...args).song;
}
