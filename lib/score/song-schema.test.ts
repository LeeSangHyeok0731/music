/* eslint-disable @typescript-eslint/no-explicit-any -- 파일에서 읽은 값을 흉내내는 테스트 입력 */
import { describe, expect, it } from "vitest";

import type { Song } from "@/lib/score/model";
import { parseSong } from "@/lib/score/song-schema";
import { songWithNotes } from "@/lib/score/testing/builders";
import { ticksPerBar } from "@/lib/score/time";

const note = (start: number, length: number, pitch = 60, velocity = 0.5) => ({
  start,
  length,
  pitch,
  velocity,
});

/** 매 테스트마다 새 객체를 준다. JSON을 거치므로 파일에서 읽은 것과 같은 모양이다. */
function raw(song: Song = songWithNotes({ notes: [note(0, 480)] })): any {
  return JSON.parse(JSON.stringify(song));
}

describe("parseSong — 통과", () => {
  it("올바른 곡은 그대로 통과하고 복구 기록이 없다", () => {
    const result = parseSong(raw());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repairs).toEqual([]);
      expect(result.song.tracks[0].clips[0].body.type).toBe("notes");
    }
  });

  it("meta의 작업자·편집자·서명 필드를 받는다", () => {
    const input = raw();
    input.meta = {
      title: "내 곡",
      author: { name: "민수", publicKey: "pk-1" },
      editors: [{ name: "지연", publicKey: "pk-2" }],
      signature: "sig",
    };
    const result = parseSong(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.song.meta.author?.name).toBe("민수");
  });

  it("코드 클립을 받는다", () => {
    const input = raw();
    input.tracks[0].clips[0].body = {
      type: "chord",
      chord: { root: 0, quality: "maj" },
      pattern: "piano-block",
    };
    expect(parseSong(input).ok).toBe(true);
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
  ])("박자표 %i/%i를 받는다", (beats, unit) => {
    const input = raw();
    input.timeSignature = [beats, unit];
    input.tracks[0].clips[0].length = ticksPerBar([beats, unit]);
    const result = parseSong(input);
    expect(result).toMatchObject({ ok: true, repairs: [] });
  });
});

describe("parseSong — 거부", () => {
  function expectRejected(input: unknown, fragment: string) {
    const result = parseSong(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain(fragment);
    }
  }

  it("객체가 아니면 거부한다", () => {
    expectRejected(null, "(루트): ");
    expectRejected("song", "(루트): ");
  });

  it("알 수 없는 버전은 거부한다", () => {
    const input = raw();
    input.v = 3;
    expectRejected(input, "v: ");
  });

  it("알 수 없는 악기는 거부한다", () => {
    const input = raw();
    input.tracks[0].instrument = "violin";
    expectRejected(input, "tracks.0.instrument: ");
  });

  it("알 수 없는 코드 종류는 조용히 바꾸지 않고 거부한다", () => {
    const input = raw();
    input.tracks[0].clips[0].body = {
      type: "chord",
      chord: { root: 0, quality: "aug" },
      pattern: "piano-block",
    };
    expectRejected(input, "tracks.0.clips.0.body.chord.quality: ");
  });

  it("알 수 없는 패턴 id는 거부한다", () => {
    const input = raw();
    input.tracks[0].clips[0].body = {
      type: "chord",
      chord: { root: 0, quality: "maj" },
      pattern: "no-such-pattern",
    };
    expectRejected(input, "패턴");
  });

  it("같은 트랙의 클립 겹침은 복구하지 않고 거부한다", () => {
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.tracks[0].clips = [
      { id: "a", start: 0, length: 1920, body: { type: "notes", notes: [] } },
      { id: "b", start: 960, length: 1920, body: { type: "notes", notes: [] } },
    ];
    expectRejected(input, "겹칩니다");
  });

  it("끝점을 반올림한 뒤에도 겹치는 클립은 거부한다", () => {
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.tracks[0].clips = [
      // [0, 480.6) → [0, 481), [480.4, …) → [480, …): 1틱 겹친다.
      { id: "a", start: 0, length: 480.6, body: { type: "notes", notes: [] } },
      { id: "b", start: 480.4, length: 480, body: { type: "notes", notes: [] } },
    ];
    expectRejected(input, "겹칩니다");
  });

  it("곡 밖으로 나간 클립은 거부한다", () => {
    const input = raw();
    input.tracks[0].clips[0].length = 99999;
    expectRejected(input, "곡 길이");
  });

  it("트랙이 하나도 없으면 거부한다", () => {
    const input = raw();
    input.tracks = [];
    expectRejected(input, "tracks: ");
  });

  it("Infinity 템포는 거부한다", () => {
    // 템포 클램프가 Infinity를 240으로 받아들일 것이므로, 이 거부는 zod의
    // 유한성 검사만으로 일어난다.
    const a = raw();
    a.tempo = Infinity;
    expectRejected(a, "tempo: ");
  });

  it("NaN 음은 거부한다", () => {
    // validateSong도 NaN을 거부하므로 이 경우만으로는 zod의 검사를 따로
    // 증명하지 못한다. zod의 유한성 보장은 위 Infinity 템포 테스트가 맡는다.
    const b = raw();
    b.tracks[0].clips[0].body.notes[0].start = Number.NaN;
    expectRejected(b, "tracks.0.clips.0.body.notes.0.start");
  });

  it("bars가 소수거나 상한을 넘으면 거부한다", () => {
    const a = raw();
    a.bars = 1.5;
    expectRejected(a, "bars: 마디 수");
    const b = raw();
    b.bars = 501;
    expectRejected(b, "bars: 마디 수");
  });

  it("트랙 id가 중복되면 거부한다", () => {
    const input = raw();
    input.tracks.push({ ...input.tracks[0] });
    expectRejected(input, "트랙 id가 중복");
  });

  it("한 트랙 안에서 클립 id가 중복되면 거부한다", () => {
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.tracks[0].clips = [
      { id: "a", start: 0, length: 480, body: { type: "notes", notes: [] } },
      { id: "a", start: 480, length: 480, body: { type: "notes", notes: [] } },
    ];
    expectRejected(input, "클립 id가 중복");
  });

  it("길이 0이나 음수인 클립은 거부한다", () => {
    const a = raw();
    a.tracks[0].clips[0].length = 0;
    expectRejected(a, "클립 길이는 1틱 이상");
    const b = raw();
    b.tracks[0].clips[0].length = -480;
    expectRejected(b, "클립 길이는 1틱 이상");
  });

  it("범위를 벗어나거나 정수가 아닌 pitch는 거부한다", () => {
    const a = raw(songWithNotes({ notes: [note(0, 480, 128)] }));
    expectRejected(a, "pitch는 0~127");
    const b = raw(songWithNotes({ notes: [note(0, 480, 60.5)] }));
    expectRejected(b, "pitch는 0~127");
  });

  it("너무 긴 작업자 이름은 거부한다", () => {
    const input = raw();
    input.meta.author = { name: "가".repeat(51), publicKey: "pk" };
    expectRejected(input, "meta.author.name: ");
  });

  it("너무 긴 제목은 거부한다", () => {
    const input = raw();
    input.meta.title = "가".repeat(101);
    expectRejected(input, "meta.title: ");
  });

  it("너무 긴 공개키는 거부한다", () => {
    const input = raw();
    input.meta.author = { name: "민수", publicKey: "k".repeat(201) };
    expectRejected(input, "meta.author.publicKey: ");
  });

  it("너무 긴 서명은 거부한다", () => {
    const input = raw();
    input.meta.signature = "s".repeat(501);
    expectRejected(input, "meta.signature: ");
  });

  it("편집자가 20명을 넘으면 거부한다", () => {
    const input = raw();
    input.meta.editors = Array.from({ length: 21 }, (_, i) => ({
      name: `편집자${i}`,
      publicKey: `pk-${i}`,
    }));
    expectRejected(input, "meta.editors: ");
  });

  it.each([
    [1000000, 4],
    [33, 4],
    [0, 4],
    [4, 7],
    [4, 3],
    [4, 64],
    [4.5, 4],
  ])("박자표 %s/%s는 거부한다", (beats, unit) => {
    const input = raw();
    input.timeSignature = [beats, unit];
    expectRejected(input, "timeSignature");
  });

  it("거대한 박자표로 마디 상한을 우회한 곡은 거부한다", () => {
    // 박자표가 무제한이면 bars ≤ 500이어도 곡 길이가 무한정 커지고,
    // 드럼 패턴을 펼치는 expandSong이 수억 번 돈다.
    const ts: [number, number] = [1000000, 4];
    const input = {
      v: 2,
      tempo: 120,
      timeSignature: ts,
      bars: 500,
      tracks: [
        {
          id: "drums",
          instrument: "drums",
          clips: [
            {
              id: "beat",
              start: 0,
              length: 500 * ticksPerBar(ts),
              body: {
                type: "chord",
                chord: { root: 0, quality: "maj" },
                pattern: "drum-basic-rock",
              },
            },
          ],
        },
      ],
      meta: { title: "big", editors: [] },
    };
    expectRejected(input, "timeSignature");
  });
});

describe("parseSong — 복구", () => {
  function expectRepaired(input: unknown, fragment: string): Song {
    const result = parseSong(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.repairs.join("\n")).toContain(fragment);
    return result.song;
  }

  function repairsOf(input: unknown): string {
    const result = parseSong(input);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    return result.repairs.join("\n");
  }

  it("범위를 벗어난 템포는 클램프한다", () => {
    const a = raw();
    a.tempo = 500;
    expect(expectRepaired(a, "템포를 40~240 범위로").tempo).toBe(240);
    const b = raw();
    b.tempo = 10;
    expect(expectRepaired(b, "템포를 40~240 범위로").tempo).toBe(40);
  });

  it("범위 안의 소수 템포는 반올림만 했다고 알린다", () => {
    const a = raw();
    a.tempo = 120.4;
    expect(expectRepaired(a, "템포를 정수로 반올림했습니다 (120.4 → 120)").tempo).toBe(120);
    expect(repairsOf(a)).not.toContain("범위");

    const b = raw();
    b.tempo = 239.6;
    expect(expectRepaired(b, "템포를 정수로 반올림했습니다 (239.6 → 240)").tempo).toBe(240);
    expect(repairsOf(b)).not.toContain("범위");
  });

  it("소수 틱은 반올림한다", () => {
    const input = raw(songWithNotes({ notes: [note(0, 480)], bars: 2 }));
    input.tracks[0].clips[0] = {
      id: "a",
      start: 480.4,
      length: 960.6,
      body: { type: "notes", notes: [{ start: 0.4, length: 100.6, pitch: 60, velocity: 0.5 }] },
    };
    const song = expectRepaired(input, "소수 틱 4개를 정수로 반올림했습니다");
    const clip = song.tracks[0].clips[0];
    expect(clip.start).toBe(480);
    expect(clip.length).toBe(961);
    if (clip.body.type === "notes") {
      expect(clip.body.notes[0]).toMatchObject({ start: 0, length: 101 });
    }
  });

  it("맞닿은 클립은 끝점을 반올림해도 맞닿은 채로 남는다", () => {
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.tracks[0].clips = [
      { id: "a", start: 0.5, length: 479.5, body: { type: "notes", notes: [] } },
      { id: "b", start: 480, length: 480, body: { type: "notes", notes: [] } },
    ];
    const song = expectRepaired(input, "반올림");
    expect(song.tracks[0].clips.map((c) => [c.start, c.length])).toEqual([
      [1, 479],
      [480, 480],
    ]);
  });

  it("곡 끝에 닿은 클립은 끝점을 반올림해도 곡 안에 남는다", () => {
    const input = raw();
    input.tracks[0].clips[0] = {
      id: "a",
      start: 0.5,
      length: 1919.5,
      body: { type: "notes", notes: [] },
    };
    const song = expectRepaired(input, "반올림");
    const clip = song.tracks[0].clips[0];
    expect(clip.start + clip.length).toBe(1920);
  });

  it("범위를 넘은 velocity는 클램프한다", () => {
    const input = raw(songWithNotes({ notes: [note(0, 480, 60, 1.5), note(480, 480, 60, -0.2)] }));
    const song = expectRepaired(input, "velocity 2개");
    const body = song.tracks[0].clips[0].body;
    if (body.type === "notes") {
      expect(body.notes.map((n) => n.velocity)).toEqual([1, 0]);
    }
  });

  it("어긋난 클립 순서를 정렬한다", () => {
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.tracks[0].clips = [
      { id: "b", start: 1920, length: 480, body: { type: "notes", notes: [] } },
      { id: "a", start: 0, length: 480, body: { type: "notes", notes: [] } },
    ];
    const song = expectRepaired(input, "정렬");
    expect(song.tracks[0].clips.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("어긋난 음 순서를 안정 정렬한다", () => {
    const input = raw(
      songWithNotes({
        notes: [note(480, 240, 62), note(0, 240, 60), note(0, 240, 64)],
      }),
    );
    const song = expectRepaired(input, "정렬");
    const body = song.tracks[0].clips[0].body;
    if (body.type === "notes") {
      expect(body.notes.map((n) => n.pitch)).toEqual([60, 64, 62]);
    }
  });

  it("클립 끝을 넘은 음은 끝에서 자른다", () => {
    const input = raw(songWithNotes({ notes: [note(1800, 480)] }));
    const song = expectRepaired(input, "음 1개를 클립 끝에서 잘랐습니다");
    const body = song.tracks[0].clips[0].body;
    if (body.type === "notes") {
      expect(body.notes).toHaveLength(1);
      expect(body.notes[0]).toMatchObject({ start: 1800, length: 120 });
    }
  });

  it("클립 끝 이후에 시작하는 음은 버린다", () => {
    const input = raw(songWithNotes({ notes: [note(0, 480, 60), note(1920, 480, 62)] }));
    const song = expectRepaired(input, "음 1개를 버렸습니다");
    const body = song.tracks[0].clips[0].body;
    if (body.type === "notes") {
      expect(body.notes).toHaveLength(1);
      expect(body.notes[0]).toMatchObject({ start: 0, pitch: 60 });
    }
  });

  it("start가 음수인 음은 거부하지 않고 버린다", () => {
    const input = raw(songWithNotes({ notes: [note(-10, 100, 62), note(0, 480, 60)] }));
    const song = expectRepaired(input, "음 1개를 버렸습니다");
    const body = song.tracks[0].clips[0].body;
    if (body.type === "notes") {
      expect(body.notes).toHaveLength(1);
      expect(body.notes[0]).toMatchObject({ start: 0, pitch: 60 });
    }
  });
});
