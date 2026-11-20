/* eslint-disable @typescript-eslint/no-explicit-any -- 파일에서 읽은 값을 흉내내는 테스트 입력 */
import { describe, expect, it } from "vitest";

import type { Song } from "@/lib/score/model";
import { parseSong } from "@/lib/score/song-schema";
import { songWithNotes } from "@/lib/score/testing/builders";

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
});

describe("parseSong — 거부", () => {
  function expectRejected(input: unknown, fragment?: string) {
    const result = parseSong(input);
    expect(result.ok).toBe(false);
    if (!result.ok && fragment) {
      expect(result.errors.join("\n")).toContain(fragment);
    }
  }

  it("객체가 아니면 거부한다", () => {
    expectRejected(null);
    expectRejected("song");
  });

  it("알 수 없는 버전은 거부한다", () => {
    const input = raw();
    input.v = 3;
    expectRejected(input);
  });

  it("알 수 없는 악기는 거부한다", () => {
    const input = raw();
    input.tracks[0].instrument = "violin";
    expectRejected(input);
  });

  it("알 수 없는 코드 종류는 조용히 바꾸지 않고 거부한다", () => {
    const input = raw();
    input.tracks[0].clips[0].body = {
      type: "chord",
      chord: { root: 0, quality: "aug" },
      pattern: "piano-block",
    };
    expectRejected(input);
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

  it("곡 밖으로 나간 클립은 거부한다", () => {
    const input = raw();
    input.tracks[0].clips[0].length = 99999;
    expectRejected(input, "곡 길이");
  });

  it("트랙이 하나도 없으면 거부한다", () => {
    const input = raw();
    input.tracks = [];
    expectRejected(input);
  });

  it("Infinity·NaN은 거부한다", () => {
    const a = raw();
    a.tempo = Infinity;
    expectRejected(a);
    const b = raw();
    b.tracks[0].clips[0].body.notes[0].start = Number.NaN;
    expectRejected(b);
  });

  it("bars가 소수거나 상한을 넘으면 거부한다", () => {
    const a = raw();
    a.bars = 1.5;
    expectRejected(a);
    const b = raw();
    b.bars = 501;
    expectRejected(b);
  });

  it("id가 중복되면 거부한다", () => {
    const input = raw();
    input.tracks.push({ ...input.tracks[0] });
    expectRejected(input, "중복");
  });

  it("너무 긴 작업자 이름은 거부한다", () => {
    const input = raw();
    input.meta.author = { name: "가".repeat(51), publicKey: "pk" };
    expectRejected(input);
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

  it("범위를 벗어난 템포는 클램프한다", () => {
    const a = raw();
    a.tempo = 500;
    expect(expectRepaired(a, "템포").tempo).toBe(240);
    const b = raw();
    b.tempo = 10;
    expect(expectRepaired(b, "템포").tempo).toBe(40);
  });

  it("소수 틱은 반올림한다", () => {
    const input = raw(songWithNotes({ notes: [note(0, 480)], bars: 2 }));
    input.tracks[0].clips[0] = {
      id: "a",
      start: 480.4,
      length: 960.6,
      body: { type: "notes", notes: [{ start: 0.4, length: 100.6, pitch: 60, velocity: 0.5 }] },
    };
    const song = expectRepaired(input, "반올림");
    const clip = song.tracks[0].clips[0];
    expect(clip.start).toBe(480);
    expect(clip.length).toBe(961);
    if (clip.body.type === "notes") {
      expect(clip.body.notes[0]).toMatchObject({ start: 0, length: 101 });
    }
  });

  it("범위를 넘은 velocity는 클램프한다", () => {
    const input = raw(songWithNotes({ notes: [note(0, 480, 60, 1.5), note(480, 480, 60, -0.2)] }));
    const song = expectRepaired(input, "velocity");
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
    const song = expectRepaired(input, "잘랐습니다");
    const body = song.tracks[0].clips[0].body;
    if (body.type === "notes") expect(body.notes[0].length).toBe(120);
  });

  it("클립 끝 이후에 시작하는 음은 버린다", () => {
    const input = raw(songWithNotes({ notes: [note(0, 480), note(1920, 480)] }));
    const song = expectRepaired(input, "버렸습니다");
    const body = song.tracks[0].clips[0].body;
    if (body.type === "notes") expect(body.notes).toHaveLength(1);
  });
});
