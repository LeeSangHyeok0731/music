import { chordPitch } from "./chords";
import type {
  Clip,
  ChordSegment,
  InstrumentId,
  Note,
  Song,
} from "./model";
import { getPattern } from "./patterns";
import { chordAt } from "./progression";

/** 스케줄러가 읽는 음 하나. `tick`은 곡 시작 기준 절대 틱이다. */
export type ScheduledNote = {
  tick: number;
  length: number;
  pitch: number;
  velocity: number;
};

export type TrackEvents = {
  trackId: string;
  instrument: InstrumentId;
  /** tick 오름차순. 같은 tick은 입력 순서를 유지한다. */
  events: ScheduledNote[];
};

/**
 * 클립 하나를 음 목록으로 편다. 반환은 **클립 상대 틱**이고 start 오름차순이다.
 *
 * - `notes` 클립은 이미 음이므로 그대로 돌려준다.
 * - `pattern` 클립은 패턴을 클립 길이만큼 반복해 만든다. 클립 끝을 넘는 음은
 *   끝에서 자르고, 끝 이후에 시작하는 스텝은 버린다.
 * - 화음 악기의 음높이는 **그 스텝의 절대 시각**(`clip.start + 상대 start`)의
 *   코드를 진행에서 찾아 정한다. 이미 시작한 음은 코드 경계를 넘어도 높이를
 *   유지한다. 드럼은 진행을 읽지 않는다.
 */
export function clipNotes(
  clip: Clip,
  instrument: InstrumentId,
  progression: readonly ChordSegment[],
): Note[] {
  const { body } = clip;
  if (body.type === "notes") return body.notes;

  const pattern = getPattern(body.pattern);
  if (!pattern) throw new Error(`알 수 없는 패턴: ${body.pattern}`);
  if ((pattern.kind === "drum") !== (instrument === "drums")) {
    throw new Error(`${instrument} 트랙에 맞지 않는 패턴: ${body.pattern}`);
  }

  const notes: Note[] = [];
  for (let base = 0; base < clip.length; base += pattern.length) {
    const emit = (
      at: number,
      length: number,
      pitchAt: (absoluteTick: number) => number,
      velocity: number,
    ) => {
      const start = base + at;
      if (start >= clip.length) return;
      notes.push({
        start,
        length: Math.min(length, clip.length - start),
        pitch: pitchAt(clip.start + start),
        velocity,
      });
    };

    if (pattern.kind === "drum") {
      for (const step of pattern.steps) {
        emit(step.at, step.length, () => step.pitch, step.velocity);
      }
    } else {
      for (const step of pattern.steps) {
        emit(
          step.at,
          step.length,
          (tick) => chordPitch(chordAt(progression, tick), step.degree, step.octave),
          step.velocity,
        );
      }
    }
  }

  // Array.prototype.sort는 안정 정렬이다 — 같은 start는 패턴에 적힌 순서를 유지한다.
  return notes.sort((a, b) => a.start - b.start);
}

/**
 * 곡 전체를 트랙별 시간순 이벤트로 편다. **재생과 내보내기가 같은 함수를 쓴다.**
 * 들은 것과 내보낸 것이 다를 수 없게 하는 구조다.
 */
export function expandSong(song: Song): TrackEvents[] {
  return song.tracks.map((track) => {
    const events: ScheduledNote[] = [];
    for (const clip of track.clips) {
      for (const note of clipNotes(clip, track.instrument, song.progression)) {
        events.push({
          tick: clip.start + note.start,
          length: note.length,
          pitch: note.pitch,
          velocity: note.velocity,
        });
      }
    }
    events.sort((a, b) => a.tick - b.tick);
    return { trackId: track.id, instrument: track.instrument, events };
  });
}

/**
 * `pattern` 클립을 같은 id·start·length의 `notes` 클립으로 바꾼다. 한 방향이다.
 * **그 시점의 진행**으로 펼친 음을 굳히므로, 그 뒤에 진행을 바꿔도 따라오지 않는다.
 * 음 단위 편집을 시작할 때 쓰고, 실행취소 스택에서는 이 변환이 한 칸이다.
 */
export function bakeClip(
  clip: Clip,
  instrument: InstrumentId,
  progression: readonly ChordSegment[],
): Clip {
  if (clip.body.type === "notes") return clip;
  return {
    ...clip,
    body: { type: "notes", notes: clipNotes(clip, instrument, progression) },
  };
}

export function bakeClipInSong(
  song: Song,
  trackId: string,
  clipId: string,
): Song {
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`트랙을 찾을 수 없습니다: ${trackId}`);
  if (!track.clips.some((c) => c.id === clipId)) {
    throw new Error(`클립을 찾을 수 없습니다: ${clipId}`);
  }
  return {
    ...song,
    tracks: song.tracks.map((t) =>
      t.id !== trackId
        ? t
        : {
            ...t,
            clips: t.clips.map((c) =>
              c.id === clipId ? bakeClip(c, t.instrument, song.progression) : c,
            ),
          },
    ),
  };
}

/** 곡에 쓰인 악기. 중복 없이 처음 등장한 순서다. 샘플 로딩 대상을 정할 때 쓴다. */
export function instrumentsOf(song: Song): InstrumentId[] {
  return [...new Set(song.tracks.map((t) => t.instrument))];
}
