import type { InstrumentId, Note, Song } from "@/lib/score/model";
import { ticksPerBar } from "@/lib/score/time";

/**
 * 테스트 전용 곡 조립 도구. 4/4, 트랙 하나, 곡 전체를 덮는 `notes` 클립 하나.
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
    v: 2,
    tempo: opts.tempo ?? 120,
    timeSignature: [4, 4],
    bars,
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
