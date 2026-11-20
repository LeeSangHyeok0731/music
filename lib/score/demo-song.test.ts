import { describe, expect, it } from "vitest";

import { DEMO_BARS, buildDemoSong } from "@/lib/score/demo-song";
import { expandSong, instrumentsOf } from "@/lib/score/expand";
import { parseSong } from "@/lib/score/song-schema";
import { validateSong } from "@/lib/score/validate";

describe("데모 곡", () => {
  it("불변식을 모두 만족한다", () => {
    expect(validateSong(buildDemoSong())).toEqual([]);
  });

  it("JSON을 거쳐도 그대로 열린다(복구 없이)", () => {
    const result = parseSong(JSON.parse(JSON.stringify(buildDemoSong())));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repairs).toEqual([]);
  });

  it("8마디, 120BPM, 4/4다", () => {
    const song = buildDemoSong();
    expect(DEMO_BARS).toBe(8);
    expect(song.bars).toBe(8);
    expect(song.tempo).toBe(120);
    expect(song.timeSignature).toEqual([4, 4]);
  });

  it("악기 4종을 모두 쓰고 코드 클립과 음 클립이 섞여 있다", () => {
    const song = buildDemoSong();
    expect(instrumentsOf(song).sort()).toEqual(
      ["bass", "drums", "guitar", "piano"].sort(),
    );
    const bodies = song.tracks.flatMap((t) => t.clips.map((c) => c.body.type));
    expect(bodies).toContain("chord");
    expect(bodies).toContain("notes");
  });

  it("모든 트랙이 소리를 낸다", () => {
    for (const track of expandSong(buildDemoSong())) {
      expect(track.events.length).toBeGreaterThan(0);
    }
  });
});
