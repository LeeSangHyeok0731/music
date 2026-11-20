import { describe, expect, it } from "vitest";

import type { Clip, Song } from "@/lib/score/model";
import { songWithNotes } from "@/lib/score/testing/builders";
import { ticksPerBar } from "@/lib/score/time";
import { validateSong, type ScoreIssueCode } from "@/lib/score/validate";

const note = (start: number, length: number, pitch = 60, velocity = 0.5) => ({
  start,
  length,
  pitch,
  velocity,
});

const emptyClip = (id: string, start: number, length: number): Clip => ({
  id,
  start,
  length,
  body: { type: "notes", notes: [] },
});

/** 2마디(3840틱) 곡에 주어진 클립들을 넣는다. */
function withClips(clips: Clip[]): Song {
  const song = songWithNotes({ notes: [], bars: 2 });
  song.tracks[0].clips = clips;
  return song;
}

function codes(song: Song): ScoreIssueCode[] {
  return validateSong(song).map((i) => i.code);
}

describe("validateSong — 통과", () => {
  it("올바른 곡은 이슈가 없다", () => {
    expect(
      validateSong(songWithNotes({ notes: [note(0, 480), note(0, 480, 64)] })),
    ).toEqual([]);
  });

  it("같은 시각의 음(화음)은 허용한다", () => {
    const song = songWithNotes({
      notes: [note(0, 480, 60), note(0, 480, 64), note(0, 480, 67)],
    });
    expect(validateSong(song)).toEqual([]);
  });

  it("맞닿은 클립은 겹침이 아니다", () => {
    expect(
      validateSong(withClips([emptyClip("a", 0, 1920), emptyClip("b", 1920, 1920)])),
    ).toEqual([]);
  });

  it("클립 사이에 빈 구간이 있어도 된다", () => {
    expect(
      validateSong(withClips([emptyClip("a", 0, 480), emptyClip("b", 1920, 480)])),
    ).toEqual([]);
  });
});

describe("validateSong — 클립 불변식", () => {
  it("같은 트랙의 클립이 겹치면 clip-overlap", () => {
    expect(
      codes(withClips([emptyClip("a", 0, 1920), emptyClip("b", 960, 1920)])),
    ).toContain("clip-overlap");
  });

  it("start 순서가 어긋나면 clip-unsorted", () => {
    expect(
      codes(withClips([emptyClip("a", 1920, 480), emptyClip("b", 0, 480)])),
    ).toContain("clip-unsorted");
  });

  it("곡 끝을 넘는 클립은 clip-out-of-range", () => {
    expect(codes(withClips([emptyClip("a", 3000, 1000)]))).toContain(
      "clip-out-of-range",
    );
  });

  it("start가 음수인 클립은 clip-out-of-range", () => {
    expect(codes(withClips([emptyClip("a", -1, 480)]))).toContain(
      "clip-out-of-range",
    );
  });

  it("클립 id가 트랙 안에서 겹치면 duplicate-id", () => {
    expect(
      codes(withClips([emptyClip("a", 0, 480), emptyClip("a", 480, 480)])),
    ).toContain("duplicate-id");
  });

  it("트랙 id가 곡 안에서 겹치면 duplicate-id", () => {
    const song = withClips([]);
    song.tracks.push({ ...song.tracks[0] });
    expect(codes(song)).toContain("duplicate-id");
  });

  it("소수 틱은 non-integer-tick", () => {
    expect(codes(withClips([emptyClip("a", 0.5, 480)]))).toContain(
      "non-integer-tick",
    );
  });

  it("길이 0 클립은 non-positive-length", () => {
    expect(codes(withClips([emptyClip("a", 0, 0)]))).toContain(
      "non-positive-length",
    );
  });
});

describe("validateSong — 음 불변식", () => {
  it("클립 밖으로 나간 음은 note-out-of-clip", () => {
    expect(codes(songWithNotes({ notes: [note(1800, 480)] }))).toContain(
      "note-out-of-clip",
    );
  });

  it("start가 음수인 음은 note-out-of-clip", () => {
    expect(codes(songWithNotes({ notes: [note(-1, 480)] }))).toContain(
      "note-out-of-clip",
    );
  });

  it("start 순서가 어긋나면 note-unsorted", () => {
    expect(
      codes(songWithNotes({ notes: [note(480, 240), note(0, 240)] })),
    ).toContain("note-unsorted");
  });

  it("길이 0 음은 non-positive-length", () => {
    expect(codes(songWithNotes({ notes: [note(0, 0)] }))).toContain(
      "non-positive-length",
    );
  });

  it("소수 틱 음은 non-integer-tick", () => {
    expect(codes(songWithNotes({ notes: [note(0.5, 240)] }))).toContain(
      "non-integer-tick",
    );
  });

  it("MIDI 범위를 벗어난 pitch는 pitch-out-of-range", () => {
    expect(codes(songWithNotes({ notes: [note(0, 240, 128)] }))).toContain(
      "pitch-out-of-range",
    );
    expect(codes(songWithNotes({ notes: [note(0, 240, 60.5)] }))).toContain(
      "pitch-out-of-range",
    );
  });

  it("범위를 벗어난 velocity는 velocity-out-of-range", () => {
    expect(codes(songWithNotes({ notes: [note(0, 240, 60, 1.2)] }))).toContain(
      "velocity-out-of-range",
    );
    expect(
      codes(songWithNotes({ notes: [note(0, 240, 60, Number.NaN)] })),
    ).toContain("velocity-out-of-range");
  });
});

describe("validateSong — 곡과 패턴", () => {
  it("bars가 0이거나 상한을 넘으면 bars-out-of-range", () => {
    expect(codes(songWithNotes({ notes: [], bars: 0 }))).toContain(
      "bars-out-of-range",
    );
    expect(codes(songWithNotes({ notes: [], bars: 501 }))).toContain(
      "bars-out-of-range",
    );
  });

  it("알 수 없는 패턴 id는 unknown-pattern", () => {
    const song = withClips([
      {
        id: "a",
        start: 0,
        length: 1920,
        body: { type: "chord", chord: { root: 0, quality: "maj" }, pattern: "nope" },
      },
    ]);
    expect(codes(song)).toContain("unknown-pattern");
  });

  it("드럼 트랙에 화음 패턴을 쓰면 pattern-instrument-mismatch", () => {
    const song = withClips([
      {
        id: "a",
        start: 0,
        length: 1920,
        body: {
          type: "chord",
          chord: { root: 0, quality: "maj" },
          pattern: "piano-block",
        },
      },
    ]);
    song.tracks[0].instrument = "drums";
    expect(codes(song)).toContain("pattern-instrument-mismatch");
  });

  it("피아노 트랙에 드럼 패턴을 쓰면 pattern-instrument-mismatch", () => {
    const song = withClips([
      {
        id: "a",
        start: 0,
        length: 1920,
        body: {
          type: "chord",
          chord: { root: 0, quality: "maj" },
          pattern: "drum-basic-rock",
        },
      },
    ]);
    expect(codes(song)).toContain("pattern-instrument-mismatch");
  });

  it.each([
    [4, 4],
    [3, 4],
    [6, 8],
    [7, 8],
    [5, 4],
    [12, 8],
    [2, 2],
    [1, 1],
  ])("박자표 %i/%i는 통과한다", (beats, unit) => {
    const ts: [number, number] = [beats, unit];
    const song = songWithNotes({ notes: [note(0, 480)] });
    song.timeSignature = ts;
    song.tracks[0].clips[0].length = ticksPerBar(ts);
    expect(validateSong(song)).toEqual([]);
  });

  it.each([
    [1000000, 4],
    [33, 4],
    [0, 4],
    [4, 7],
    [4, 3],
    [4, 64],
    [4.5, 4],
  ])("박자표 %s/%s는 invalid-time-signature", (beats, unit) => {
    const song = songWithNotes({ notes: [] });
    song.timeSignature = [beats, unit];
    const issue = validateSong(song).find(
      (i) => i.code === "invalid-time-signature",
    );
    expect(issue?.path).toBe("timeSignature");
  });

  it("이슈에는 위치를 가리키는 path가 있다", () => {
    const issues = validateSong(
      withClips([emptyClip("a", 0, 1920), emptyClip("b", 960, 1920)]),
    );
    expect(issues[0].path).toBe("tracks[0].clips[1]");
  });
});
