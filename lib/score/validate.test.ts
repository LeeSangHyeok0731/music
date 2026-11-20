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

// 실패 케이스는 이슈 코드 목록 전체를 `toEqual`로 단언한다. `toContain`은 엉뚱한
// 이슈가 함께 나와도 통과하므로, 다른 검사가 잘못 걸리는 회귀를 숨긴다.

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

  it("0이 아닌 곳에서 시작한 클립에 맞닿은 클립도 겹침이 아니다", () => {
    // a = [480, 1440). 끝은 start + length이지 length가 아니다.
    expect(
      validateSong(withClips([emptyClip("a", 480, 960), emptyClip("b", 1440, 480)])),
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
    ).toEqual(["clip-overlap"]);
  });

  it("0이 아닌 곳에서 시작한 클립과의 겹침도 clip-overlap", () => {
    // a = [480, 1440), b는 1000에서 시작한다. prev.length(960)만 보면 놓친다.
    expect(
      codes(withClips([emptyClip("a", 480, 960), emptyClip("b", 1000, 480)])),
    ).toEqual(["clip-overlap"]);
  });

  it("start 순서가 어긋나면 clip-unsorted", () => {
    expect(
      codes(withClips([emptyClip("a", 1920, 480), emptyClip("b", 0, 480)])),
    ).toEqual(["clip-unsorted"]);
  });

  it("어긋난 순서가 겹침도 품고 있으면 clip-unsorted 하나만 낸다", () => {
    // b = [0, 3000)은 a = [1920, 2400)을 덮지만 겹침은 보고하지 않는다(else-if).
    // 정렬은 복구 대상이라 스키마(`song-schema.ts`)가 먼저 정렬하고 다시 검증한다.
    // 그때 진짜 겹침이 clip-overlap으로 드러난다. 정렬 전 순서로 계산한 겹침은
    // 잘못된 인접 쌍을 비교한 것이라 의미가 없다.
    expect(
      codes(withClips([emptyClip("a", 1920, 480), emptyClip("b", 0, 3000)])),
    ).toEqual(["clip-unsorted"]);
  });

  it("곡 끝을 넘는 클립은 clip-out-of-range", () => {
    expect(codes(withClips([emptyClip("a", 3000, 1000)]))).toEqual([
      "clip-out-of-range",
    ]);
  });

  it("start가 음수인 클립은 clip-out-of-range", () => {
    expect(codes(withClips([emptyClip("a", -1, 480)]))).toEqual([
      "clip-out-of-range",
    ]);
  });

  it("클립 id가 트랙 안에서 겹치면 duplicate-id", () => {
    expect(
      codes(withClips([emptyClip("a", 0, 480), emptyClip("a", 480, 480)])),
    ).toEqual(["duplicate-id"]);
  });

  it("트랙 id가 곡 안에서 겹치면 duplicate-id", () => {
    const song = withClips([]);
    song.tracks.push({ ...song.tracks[0] });
    expect(codes(song)).toEqual(["duplicate-id"]);
  });

  it("소수 start 클립은 non-integer-tick", () => {
    expect(codes(withClips([emptyClip("a", 0.5, 480)]))).toEqual([
      "non-integer-tick",
    ]);
  });

  it("소수 length 클립은 non-integer-tick", () => {
    expect(codes(withClips([emptyClip("a", 0, 480.5)]))).toEqual([
      "non-integer-tick",
    ]);
  });

  it("길이 0 클립은 non-positive-length", () => {
    expect(codes(withClips([emptyClip("a", 0, 0)]))).toEqual([
      "non-positive-length",
    ]);
  });

  it("길이가 음수인 클립은 non-positive-length", () => {
    expect(codes(withClips([emptyClip("a", 480, -480)]))).toEqual([
      "non-positive-length",
    ]);
  });
});

describe("validateSong — 음 불변식", () => {
  it("클립 밖으로 나간 음은 note-out-of-clip", () => {
    expect(codes(songWithNotes({ notes: [note(1800, 480)] }))).toEqual([
      "note-out-of-clip",
    ]);
  });

  it("클립 끝에 정확히 닿는 음은 통과한다", () => {
    // 1440 + 480 === 1920 === clip.length
    expect(validateSong(songWithNotes({ notes: [note(1440, 480)] }))).toEqual([]);
  });

  it("start가 음수인 음은 note-out-of-clip", () => {
    expect(codes(songWithNotes({ notes: [note(-1, 480)] }))).toEqual([
      "note-out-of-clip",
    ]);
  });

  it("start 순서가 어긋나면 note-unsorted", () => {
    expect(
      codes(songWithNotes({ notes: [note(480, 240), note(0, 240)] })),
    ).toEqual(["note-unsorted"]);
  });

  it("길이 0 음은 non-positive-length", () => {
    expect(codes(songWithNotes({ notes: [note(0, 0)] }))).toEqual([
      "non-positive-length",
    ]);
  });

  it("소수 틱 음은 non-integer-tick", () => {
    expect(codes(songWithNotes({ notes: [note(0.5, 240)] }))).toEqual([
      "non-integer-tick",
    ]);
  });

  it("MIDI 범위를 벗어난 pitch는 pitch-out-of-range", () => {
    expect(codes(songWithNotes({ notes: [note(0, 240, 128)] }))).toEqual([
      "pitch-out-of-range",
    ]);
    expect(codes(songWithNotes({ notes: [note(0, 240, -1)] }))).toEqual([
      "pitch-out-of-range",
    ]);
    expect(codes(songWithNotes({ notes: [note(0, 240, 60.5)] }))).toEqual([
      "pitch-out-of-range",
    ]);
  });

  it("pitch 0과 127은 통과한다", () => {
    expect(
      validateSong(songWithNotes({ notes: [note(0, 240, 0), note(0, 240, 127)] })),
    ).toEqual([]);
  });

  it("범위를 벗어난 velocity는 velocity-out-of-range", () => {
    expect(codes(songWithNotes({ notes: [note(0, 240, 60, 1.2)] }))).toEqual([
      "velocity-out-of-range",
    ]);
    expect(
      codes(songWithNotes({ notes: [note(0, 240, 60, Number.NaN)] })),
    ).toEqual(["velocity-out-of-range"]);
  });

  it("velocity 정확히 0과 1은 통과한다", () => {
    expect(
      validateSong(
        songWithNotes({ notes: [note(0, 240, 60, 0), note(0, 240, 64, 1)] }),
      ),
    ).toEqual([]);
  });
});

describe("validateSong — 곡과 패턴", () => {
  it("bars 1과 상한 500은 통과한다", () => {
    expect(validateSong(songWithNotes({ notes: [], bars: 1 }))).toEqual([]);
    expect(validateSong(songWithNotes({ notes: [], bars: 500 }))).toEqual([]);
  });

  it("bars가 0이거나 상한을 넘거나 소수면 bars-out-of-range", () => {
    // 클립 없는 곡에서 bars만 바꿔 다른 이슈가 끼지 않게 한다.
    for (const bars of [0, 501, 1.5]) {
      const song = withClips([]);
      song.bars = bars;
      expect(codes(song)).toEqual(["bars-out-of-range"]);
    }
  });

  it("bars 0인 곡은 곡을 덮는 클립도 길이 0이 되어 함께 걸린다", () => {
    // 연쇄 이슈: 빌더의 클립 길이가 bars × 1920 = 0이 되어 non-positive-length도 난다.
    // 정확한 목록은 빌더 구현에 묶이므로 bars 이슈가 있는지만 본다.
    expect(codes(songWithNotes({ notes: [], bars: 0 }))).toContain(
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
    expect(codes(song)).toEqual(["unknown-pattern"]);
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
    expect(codes(song)).toEqual(["pattern-instrument-mismatch"]);
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
    expect(codes(song)).toEqual(["pattern-instrument-mismatch"]);
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
    [4, 3],
    [4.5, 4],
  ])("박자표 %s/%s는 invalid-time-signature 하나만 낸다", (beats, unit) => {
    // 이 박자표들은 한 마디가 1920틱 이상이라 1920틱 클립이 곡 안에 남는다.
    const song = songWithNotes({ notes: [] });
    song.timeSignature = [beats, unit];
    expect(validateSong(song).map((i) => [i.code, i.path])).toEqual([
      ["invalid-time-signature", "timeSignature"],
    ]);
  });

  it.each([
    [0, 4],
    [4, 7],
    [4, 64],
  ])("박자표 %s/%s는 invalid-time-signature", (beats, unit) => {
    // 연쇄 이슈: 곡 길이가 bars × ticksPerBar(박자표)로 파생되므로 이 박자표에서는
    // 한 마디가 1920틱보다 짧아져 클립에 clip-out-of-range도 함께 난다.
    // 박자표 이슈와 그 위치만 단언한다.
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
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["clip-overlap", "tracks[0].clips[1]"],
    ]);
  });

  it("음 이슈의 path는 클립 안의 음 순번까지 가리킨다", () => {
    const issues = validateSong(
      songWithNotes({ notes: [note(0, 240), note(0, 240, 128)] }),
    );
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["pitch-out-of-range", "tracks[0].clips[0].notes[1]"],
    ]);
  });
});
