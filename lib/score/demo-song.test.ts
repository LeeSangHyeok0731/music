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

  it("v3, 8마디, 120BPM, 4/4다", () => {
    const song = buildDemoSong();
    expect(song.v).toBe(3);
    expect(DEMO_BARS).toBe(8);
    expect(song.bars).toBe(8);
    expect(song.tempo).toBe(120);
    expect(song.timeSignature).toEqual([4, 4]);
  });

  it("코드 진행은 C–Am–F–G7 각 2마디다", () => {
    expect(buildDemoSong().progression).toEqual([
      { start: 0, length: 3840, chord: { root: 0, quality: "maj" } },
      { start: 3840, length: 3840, chord: { root: 9, quality: "min" } },
      { start: 7680, length: 3840, chord: { root: 5, quality: "maj" } },
      { start: 11520, length: 3840, chord: { root: 7, quality: "dom7" } },
    ]);
  });

  it("악기 4종을 모두 쓰고 클립은 전부 패턴 클립이다", () => {
    const song = buildDemoSong();
    expect(instrumentsOf(song).sort()).toEqual(
      ["bass", "drums", "guitar", "piano"].sort(),
    );
    const bodies = song.tracks.flatMap((t) => t.clips.map((c) => c.body.type));
    expect(new Set(bodies)).toEqual(new Set(["pattern"]));
  });

  it("모든 트랙이 소리를 낸다", () => {
    for (const track of expandSong(buildDemoSong())) {
      expect(track.events.length).toBeGreaterThan(0);
    }
  });

  it("트랙 4개가 정해진 순서로 있다", () => {
    expect(buildDemoSong().tracks.map((t) => t.id)).toEqual([
      "track-piano",
      "track-guitar",
      "track-bass",
      "track-drums",
    ]);
  });

  it("모든 트랙(피아노·기타·베이스·드럼)은 곡 끝까지 이어진다", () => {
    const song = buildDemoSong();
    const songEnd = DEMO_BARS * 1920;
    for (const id of ["track-piano", "track-guitar", "track-bass", "track-drums"]) {
      const track = song.tracks.find((t) => t.id === id);
      const last = track?.clips.at(-1);
      expect(last && last.start + last.length, id).toBe(songEnd);
    }
  });

  it("진행에 따라 같은 패턴의 음높이가 달라진다", () => {
    const piano = expandSong(buildDemoSong()).find(
      (t) => t.trackId === "track-piano",
    );
    // 1마디(C 구간)의 첫 음은 C4 = 60, 3마디(Am 구간 시작, 3840틱)의 첫 음은 A4 = 12*5+9 = 69.
    expect(piano?.events.find((e) => e.tick === 0)?.pitch).toBe(60);
    expect(piano?.events.find((e) => e.tick === 3840)?.pitch).toBe(69);
  });
});
