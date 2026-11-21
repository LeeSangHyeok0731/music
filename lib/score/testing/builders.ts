import type { ChordSegment, InstrumentId, Note, Song } from "@/lib/score/model";
import { defaultProgression } from "@/lib/score/progression";
import { ticksPerBar } from "@/lib/score/time";

/**
 * 테스트 전용 곡 조립 도구. 4/4, 트랙 하나, 곡 전체를 덮는 `notes` 클립 하나.
 * 진행은 곡 전체를 덮는 C maj 한 구간이다(`defaultProgression`).
 * 편집 로직이 아니라 "이런 곡이 있다"를 한 줄로 말하기 위한 것이다.
 */
export function songWithNotes(opts: {
  trackId?: string;
  instrument?: InstrumentId;
  notes: Note[];
  bars?: number;
  tempo?: number;
}): Song {
  const bars = opts.bars ?? 1;
  return {
    v: 3,
    tempo: opts.tempo ?? 120,
    timeSignature: [4, 4],
    bars,
    progression: defaultProgression(bars, [4, 4]),
    tracks: [
      {
        id: opts.trackId ?? "track-1",
        instrument: opts.instrument ?? "piano",
        clips: [
          {
            id: "clip-1",
            start: 0,
            length: bars * ticksPerBar([4, 4]),
            body: { type: "notes", notes: opts.notes },
          },
        ],
      },
    ],
    meta: { title: "test", editors: [] },
  };
}

/**
 * 테스트 전용 곡 조립 도구. 4/4, 패턴 클립으로 된 트랙들.
 *
 * - `bars`를 주지 않으면 모든 클립을 담는 가장 작은 마디 수(최소 1)다.
 * - `progression`을 주지 않으면 곡 전체를 덮는 C maj 한 구간이다.
 */
export function songWithPatterns(opts: {
  tracks: Array<{
    id: string;
    instrument: InstrumentId;
    clips: Array<{ id: string; start: number; length: number; pattern: string }>;
  }>;
  bars?: number;
  progression?: ChordSegment[];
  tempo?: number;
}): Song {
  const bar = ticksPerBar([4, 4]);
  const end = Math.max(
    0,
    ...opts.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length)),
  );
  const bars = opts.bars ?? Math.max(1, Math.ceil(end / bar));
  return {
    v: 3,
    tempo: opts.tempo ?? 120,
    timeSignature: [4, 4],
    bars,
    progression: opts.progression ?? defaultProgression(bars, [4, 4]),
    tracks: opts.tracks.map((t) => ({
      id: t.id,
      instrument: t.instrument,
      clips: t.clips.map((c) => ({
        id: c.id,
        start: c.start,
        length: c.length,
        body: { type: "pattern", pattern: c.pattern },
      })),
    })),
    meta: { title: "test", editors: [] },
  };
}
