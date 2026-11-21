import type { Clip, Song } from "@/lib/score/model";

function noteCount(clip: Clip): number {
  return clip.body.type === "notes" ? clip.body.notes.length : 0;
}

/**
 * `before`에서 `after`로 곡을 줄이면서 클립 내용이 사라졌는가: 클립이 지워졌거나,
 * 길이가 줄었거나(잘림), `notes` 클립이 음을 잃었다. 늘리거나 그대로면 거짓이다.
 * 빈 마디만 줄이면 거짓이다(진행 구간만 잘리는 경우는 클립이 아니라서 센다고 치지 않는다).
 * UI가 "되돌리기로 복구할 수 있다"는 안내를 띄울지 정하는 순수 규칙이다.
 */
export function shrinkDiscardsClips(before: Song, after: Song): boolean {
  if (after.bars >= before.bars) return false;
  return before.tracks.some((track) => {
    const kept = new Map(
      after.tracks
        .find((t) => t.id === track.id)
        ?.clips.map((c) => [c.id, c] as const),
    );
    return track.clips.some((clip) => {
      const next = kept.get(clip.id);
      return (
        next === undefined ||
        next.length < clip.length ||
        noteCount(next) < noteCount(clip)
      );
    });
  });
}
