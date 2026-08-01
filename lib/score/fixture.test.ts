import { describe, expect, it } from "vitest";

import { DEMO_BARS, DRUM_TILE_LENGTH, buildDemoSong } from "@/lib/score/fixture";
import { ticksPerBar } from "@/lib/score/time";
import { DRUM_HIHAT, DRUM_KICK, DRUM_SNARE } from "@/lib/score/types";

describe("buildDemoSong", () => {
  const song = buildDemoSong();

  it("120BPM 4/4 16마디다", () => {
    expect(song.tempo).toBe(120);
    expect(song.timeSignature).toEqual([4, 4]);
    expect(song.lengthTicks).toBe(ticksPerBar([4, 4]) * DEMO_BARS);
  });

  it("30초보다 길다 — 드리프트를 귀로 확인할 수 있어야 한다", () => {
    const seconds = (song.lengthTicks / 480) * (60 / song.tempo);
    expect(seconds).toBeGreaterThan(30);
  });

  it("라인이 4개다", () => {
    expect(song.lines.map((l) => l.instrument)).toEqual([
      "piano",
      "guitar",
      "bass",
      "drums",
    ]);
  });

  it("드럼 라인만 kind가 drum이다", () => {
    const drum = song.lines.filter((l) => l.kind === "drum");
    expect(drum).toHaveLength(1);
    expect(drum[0].instrument).toBe("drums");
  });

  it("모든 라인의 tiles가 start 오름차순이다 — 스케줄러 커서의 전제", () => {
    for (const line of song.lines) {
      for (let i = 1; i < line.tiles.length; i++) {
        expect(line.tiles[i].start).toBeGreaterThanOrEqual(
          line.tiles[i - 1].start,
        );
      }
    }
  });

  it("타일 id가 곡 전체에서 유일하다", () => {
    const ids = song.lines.flatMap((l) => l.tiles.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 타일이 곡 길이 안에 있고 음을 하나 이상 가진다", () => {
    for (const line of song.lines) {
      for (const tile of line.tiles) {
        expect(tile.notes.length).toBeGreaterThan(0);
        expect(tile.start).toBeGreaterThanOrEqual(0);
        expect(tile.start + tile.length).toBeLessThanOrEqual(song.lengthTicks);
        expect(tile.velocity).toBeGreaterThan(0);
        expect(tile.velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("피아노는 마디마다 3화음 하나다", () => {
    const piano = song.lines.find((l) => l.instrument === "piano")!;
    expect(piano.tiles).toHaveLength(DEMO_BARS);
    for (const tile of piano.tiles) {
      expect(tile.notes).toHaveLength(3);
    }
  });

  it("드럼 타일은 길이가 고정이고 킥·스네어·하이햇만 쓴다", () => {
    const drums = song.lines.find((l) => l.kind === "drum")!;
    for (const tile of drums.tiles) {
      expect(tile.length).toBe(DRUM_TILE_LENGTH);
      expect(tile.notes).toHaveLength(1);
      expect([DRUM_KICK, DRUM_SNARE, DRUM_HIHAT]).toContain(tile.notes[0]);
    }
  });
});
