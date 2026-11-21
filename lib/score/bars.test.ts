import { describe, expect, it } from "vitest";

import { shrinkDiscardsClips } from "@/lib/score/bars";
import { buildDemoSong } from "@/lib/score/demo-song";
import { setBars } from "@/lib/score/edit";
import type { Note, Song } from "@/lib/score/model";
import { songWithNotes, songWithPatterns } from "@/lib/score/testing/builders";

const BAR = 1920;

function note(start: number, length: number): Note {
  return { start, length, pitch: 60, velocity: 0.8 };
}

/** 4마디. 피아노 클립은 1~2마디에만 있다(3·4마디는 비었다). */
function sparse(): Song {
  return songWithPatterns({
    bars: 4,
    tracks: [
      {
        id: "t-piano",
        instrument: "piano",
        clips: [{ id: "clip-1", start: 0, length: 2 * BAR, pattern: "piano-block" }],
      },
    ],
  });
}

describe("shrinkDiscardsClips", () => {
  it("빈 마디만 줄이면 거짓이다", () => {
    const before = sparse();
    expect(shrinkDiscardsClips(before, setBars(before, 3))).toBe(false);
    expect(shrinkDiscardsClips(before, setBars(before, 2))).toBe(false);
  });

  it("setBars가 0을 1로 올려 잘라도 클립이 짧아지면 참이다", () => {
    const before = sparse();
    expect(shrinkDiscardsClips(before, setBars(before, 0))).toBe(true);
    const after = setBars(before, 1);
    expect(after.tracks[0].clips[0].length).toBe(BAR);
    expect(shrinkDiscardsClips(before, after)).toBe(true);
  });

  it("클립이 새 끝에서 잘려 짧아지면 참이다", () => {
    const before = buildDemoSong();
    expect(shrinkDiscardsClips(before, setBars(before, 7))).toBe(true);
  });

  it("클립이 통째로 사라지면 참이다", () => {
    const before = songWithPatterns({
      bars: 4,
      tracks: [
        {
          id: "t-piano",
          instrument: "piano",
          clips: [
            { id: "clip-1", start: 0, length: BAR, pattern: "piano-block" },
            { id: "clip-2", start: 3 * BAR, length: BAR, pattern: "piano-block" },
          ],
        },
      ],
    });
    const after = setBars(before, 3);
    expect(after.tracks[0].clips).toHaveLength(1);
    expect(shrinkDiscardsClips(before, after)).toBe(true);
  });

  it("같은 클립 id를 다른 트랙이 써도 트랙별로 짝지어 사라진 클립을 놓치지 않는다", () => {
    const before = songWithPatterns({
      bars: 4,
      tracks: [
        {
          id: "t-piano",
          instrument: "piano",
          clips: [{ id: "clip-1", start: 3 * BAR, length: BAR, pattern: "piano-block" }],
        },
        {
          id: "t-bass",
          instrument: "bass",
          clips: [{ id: "clip-1", start: 0, length: BAR, pattern: "bass-root-quarter" }],
        },
      ],
    });
    const after = setBars(before, 3);
    expect(after.tracks[0].clips).toHaveLength(0); // 피아노의 clip-1은 사라졌고
    expect(after.tracks[1].clips).toHaveLength(1); // 베이스의 clip-1은 남았다
    expect(shrinkDiscardsClips(before, after)).toBe(true);
  });

  it("줄인 곡에서 트랙이 없어지면 그 트랙의 클립은 사라진 것으로 친다", () => {
    const before = sparse();
    const after: Song = { ...before, bars: 3, tracks: [] };
    expect(shrinkDiscardsClips(before, after)).toBe(true);
  });

  it("notes 클립이 음을 잃으면 참이다(길이가 그대로여도)", () => {
    const before = songWithNotes({ bars: 2, notes: [note(0, 480), note(960, 480)] });
    const after: Song = {
      ...before,
      bars: 1,
      tracks: [
        {
          ...before.tracks[0],
          clips: [
            {
              ...before.tracks[0].clips[0],
              body: { type: "notes", notes: [note(0, 480)] },
            },
          ],
        },
      ],
    };
    expect(shrinkDiscardsClips(before, after)).toBe(true);
  });

  it("notes 클립의 음은 그대로여도 클립이 줄면 참이다", () => {
    const before = songWithNotes({ bars: 4, notes: [note(0, 480)] });
    expect(shrinkDiscardsClips(before, setBars(before, 2))).toBe(true);
  });

  it("늘리거나 그대로면 거짓이다", () => {
    const before = buildDemoSong();
    expect(shrinkDiscardsClips(before, setBars(before, 9))).toBe(false);
    expect(shrinkDiscardsClips(before, before)).toBe(false);
  });

  it("트랙이 하나도 없으면 거짓이다", () => {
    const before = songWithPatterns({ bars: 4, tracks: [] });
    expect(shrinkDiscardsClips(before, setBars(before, 1))).toBe(false);
  });
});
