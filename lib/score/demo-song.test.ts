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

  it("트랙 5개가 정해진 순서로 있다", () => {
    expect(buildDemoSong().tracks.map((t) => t.id)).toEqual([
      "track-piano",
      "track-guitar",
      "track-bass",
      "track-drums",
      "track-melody",
    ]);
  });

  it("반주 트랙(피아노·기타·베이스·드럼)은 곡 끝까지 이어진다", () => {
    const song = buildDemoSong();
    const songEnd = DEMO_BARS * 1920;
    for (const id of ["track-piano", "track-guitar", "track-bass", "track-drums"]) {
      const track = song.tracks.find((t) => t.id === id);
      const last = track?.clips.at(-1);
      expect(last && last.start + last.length, id).toBe(songEnd);
    }
  });

  it("멜로디 클립의 음 6개가 그대로 재생 이벤트 6개가 된다", () => {
    const melody = expandSong(buildDemoSong()).find(
      (t) => t.trackId === "track-melody",
    );
    // 멜로디 클립은 4마디 뒤(5마디째 첫 박, 7680틱)에서 시작한다.
    expect(melody?.events.map((e) => [e.tick, e.pitch])).toEqual([
      [7680, 72],
      [8160, 76],
      [8640, 79],
      [9120, 76],
      [9600, 77],
      [10560, 74],
    ]);
  });
});
