import { MAX_BARS, type Clip, type Song, type Track } from "./model";
import { getPattern } from "./patterns";
import { songLengthTicks } from "./time";

export type ScoreIssueCode =
  | "bars-out-of-range"
  | "duplicate-id"
  | "non-integer-tick"
  | "non-positive-length"
  | "clip-out-of-range"
  | "clip-unsorted"
  | "clip-overlap"
  | "unknown-pattern"
  | "pattern-instrument-mismatch"
  | "note-unsorted"
  | "note-out-of-clip"
  | "pitch-out-of-range"
  | "velocity-out-of-range";

export type ScoreIssue = {
  code: ScoreIssueCode;
  /** `tracks[0].clips[2]` 같은 위치 표기. */
  path: string;
  message: string;
};

/**
 * 곡의 불변식을 전부 검사한다. 빈 배열이면 통과다.
 *
 * 순서나 범위처럼 복구할 수 있는 문제도 여기서는 이슈로 센다 — 복구는
 * 스키마 계층(`song-schema.ts`)이 이 함수를 부르기 전에 한다. 편집 함수가
 * 만든 곡은 항상 이 함수를 통과해야 한다.
 */
export function validateSong(song: Song): ScoreIssue[] {
  const issues: ScoreIssue[] = [];
  const add = (code: ScoreIssueCode, path: string, message: string) =>
    issues.push({ code, path, message });

  if (!Number.isInteger(song.bars) || song.bars < 1 || song.bars > MAX_BARS) {
    add("bars-out-of-range", "bars", `마디 수는 1~${MAX_BARS}의 정수여야 합니다`);
  }

  const songLength = songLengthTicks(song);
  const trackIds = new Set<string>();

  song.tracks.forEach((track, ti) => {
    const trackPath = `tracks[${ti}]`;
    if (trackIds.has(track.id)) {
      add("duplicate-id", trackPath, `트랙 id가 중복됩니다: ${track.id}`);
    }
    trackIds.add(track.id);

    const clipIds = new Set<string>();
    track.clips.forEach((clip, ci) => {
      const path = `${trackPath}.clips[${ci}]`;
      if (clipIds.has(clip.id)) {
        add("duplicate-id", path, `클립 id가 중복됩니다: ${clip.id}`);
      }
      clipIds.add(clip.id);

      checkClipShape(clip, songLength, path, add);
      if (ci > 0) {
        const prev = track.clips[ci - 1];
        if (clip.start < prev.start) {
          add("clip-unsorted", path, "클립이 start 오름차순이 아닙니다");
        } else if (clip.start < prev.start + prev.length) {
          add("clip-overlap", path, "같은 트랙의 클립이 시간상 겹칩니다");
        }
      }
      checkBody(track, clip, path, add);
    });
  });

  return issues;
}

type Add = (code: ScoreIssueCode, path: string, message: string) => void;

function checkClipShape(
  clip: Clip,
  songLength: number,
  path: string,
  add: Add,
): void {
  if (!Number.isInteger(clip.start) || !Number.isInteger(clip.length)) {
    add("non-integer-tick", path, "클립의 start와 length는 정수 틱이어야 합니다");
  }
  if (!(clip.length >= 1)) {
    add("non-positive-length", path, "클립 길이는 1틱 이상이어야 합니다");
  }
  if (clip.start < 0 || clip.start + clip.length > songLength) {
    add("clip-out-of-range", path, "클립이 곡 길이 안에 들어가지 않습니다");
  }
}

function checkBody(track: Track, clip: Clip, path: string, add: Add): void {
  const { body } = clip;

  if (body.type === "chord") {
    const pattern = getPattern(body.pattern);
    if (!pattern) {
      add("unknown-pattern", path, `알 수 없는 패턴입니다: ${body.pattern}`);
    } else if ((pattern.kind === "drum") !== (track.instrument === "drums")) {
      add(
        "pattern-instrument-mismatch",
        path,
        `${track.instrument} 트랙에 쓸 수 없는 패턴입니다: ${body.pattern}`,
      );
    }
    return;
  }

  body.notes.forEach((n, ni) => {
    const notePath = `${path}.notes[${ni}]`;
    if (!Number.isInteger(n.start) || !Number.isInteger(n.length)) {
      add("non-integer-tick", notePath, "음의 start와 length는 정수 틱이어야 합니다");
    }
    if (!(n.length >= 1)) {
      add("non-positive-length", notePath, "음 길이는 1틱 이상이어야 합니다");
    }
    if (n.start < 0 || n.start + n.length > clip.length) {
      add("note-out-of-clip", notePath, "음이 클립 안에 들어가지 않습니다");
    }
    if (ni > 0 && n.start < body.notes[ni - 1].start) {
      add("note-unsorted", notePath, "음이 start 오름차순이 아닙니다");
    }
    if (!Number.isInteger(n.pitch) || n.pitch < 0 || n.pitch > 127) {
      add("pitch-out-of-range", notePath, "pitch는 0~127의 정수여야 합니다");
    }
    if (!(n.velocity >= 0 && n.velocity <= 1)) {
      add("velocity-out-of-range", notePath, "velocity는 0~1이어야 합니다");
    }
  });
}
