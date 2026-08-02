import { describe, expect, it } from "vitest";

import { HISTORY_LIMIT, pushHistory } from "@/state/useSongHistory";
import { buildDemoSong } from "@/lib/score/fixture";
import type { Song } from "@/lib/score/types";

function songWithTempo(tempo: number): Song {
  return { ...buildDemoSong(), tempo };
}

describe("pushHistory", () => {
  it("뒤에 쌓는다", () => {
    const a = songWithTempo(100);
    const b = songWithTempo(101);
    const past = pushHistory(pushHistory([], a), b);

    expect(past.map((s) => s.tempo)).toEqual([100, 101]);
  });

  it("상한을 넘으면 오래된 것부터 버린다", () => {
    let past: Song[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      past = pushHistory(past, songWithTempo(i));
    }

    expect(past).toHaveLength(HISTORY_LIMIT);
    // 가장 오래된 10개가 밀려났으므로 첫 항목은 tempo 10이다
    expect(past[0].tempo).toBe(10);
    expect(past.at(-1)!.tempo).toBe(HISTORY_LIMIT + 9);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const past: Song[] = [];
    pushHistory(past, songWithTempo(1));
    expect(past).toHaveLength(0);
  });

  it("상한은 50이다", () => {
    expect(HISTORY_LIMIT).toBe(50);
  });
});
