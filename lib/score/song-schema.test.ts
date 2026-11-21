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

  it("패턴 클립을 받는다", () => {
    const input = raw();
    input.tracks[0].clips[0].body = { type: "pattern", pattern: "piano-block" };
    expect(parseSong(input)).toMatchObject({ ok: true, repairs: [] });
  });

  it("여러 구간으로 된 코드 진행을 그대로 받는다", () => {
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.progression = [
      { start: 0, length: 960, chord: { root: 0, quality: "maj" } },
      { start: 960, length: 960, chord: { root: 9, quality: "min7" } },
      { start: 1920, length: 1920, chord: { root: 7, quality: "dom7" } },
    ];
    const result = parseSong(input);
    expect(result).toMatchObject({ ok: true, repairs: [] });
    if (result.ok) expect(result.song.progression).toEqual(input.progression);
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
    // 진행은 곡 끝에 닿아야 한다.
    input.progression[0].length = ticksPerBar([beats, unit]);
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
    input.v = 4;
    expectRejected(input, "v: ");
  });

  it("v2 곡은 마이그레이션하지 않고 거부한다", () => {
    const input = raw();
    input.v = 2;
    expectRejected(input, "v: ");
  });

  it("옛 v2 모양의 곡(코드를 품은 클립, 진행 없음)은 거부한다", () => {
    const input = raw();
    input.v = 2;
    delete input.progression;
    input.tracks[0].clips[0].body = {
      type: "chord",
      chord: { root: 0, quality: "maj" },
      pattern: "piano-block",
    };
    const result = parseSong(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const errors = result.errors.join("\n");
      expect(errors).toContain("v: ");
      expect(errors).toContain("progression: ");
      expect(errors).toContain("tracks.0.clips.0.body");
    }
  });

  it("v3라도 옛 chord 본문은 거부한다", () => {
    const input = raw();
    input.tracks[0].clips[0].body = {
      type: "chord",
      chord: { root: 0, quality: "maj" },
      pattern: "piano-block",
    };
    expectRejected(input, "tracks.0.clips.0.body");
  });

  it("코드 진행이 없거나 비어 있으면 거부한다", () => {
    const a = raw();
    delete a.progression;
    expectRejected(a, "progression: ");
    const b = raw();
    b.progression = [];
    expectRejected(b, "progression: ");
  });

  it.each([
    ["빈틈", [[0, 960], [1920, 1920]]],
    ["겹침", [[0, 2000], [1920, 1920]]],
    ["0이 아닌 시작", [[480, 3360]]],
    ["곡 끝에 못 미침", [[0, 1920]]],
    ["곡 끝을 넘음", [[0, 5000]]],
  ])("코드 진행의 %s은 복구하지 않고 거부한다", (_, spans) => {
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.progression = spans.map(([start, length]) => ({
      start,
      length,
      chord: { root: 0, quality: "maj" },
    }));
    expectRejected(input, "progression: 코드 진행");
  });

  it("코드 진행의 근음이 범위를 벗어나면 zod가 거부한다", () => {
    const input = raw();
    input.progression[0].chord.root = 12;
    expectRejected(input, "progression.0.chord.root: ");
  });

  it("알 수 없는 악기는 거부한다", () => {
    const input = raw();
    input.tracks[0].instrument = "violin";
    expectRejected(input, "tracks.0.instrument: ");
  });

  it("알 수 없는 코드 종류는 조용히 바꾸지 않고 거부한다", () => {
    const input = raw();
    input.progression[0].chord.quality = "aug";
    expectRejected(input, "progression.0.chord.quality: ");
  });

  it("알 수 없는 패턴 id는 거부한다", () => {
    const input = raw();
    input.tracks[0].clips[0].body = { type: "pattern", pattern: "no-such-pattern" };
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

  it("끝점을 반올림한 뒤에도 1틱 이상 겹치는 클립은 거부한다", () => {
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

  it("NaN 음은 zod가 거부한다", () => {
    // 경로 조각이 zod 형식(`tracks.0.clips.0.body.notes.0.start`, 점 구분·`body` 포함)이다.
    // validateSong이 거부했다면 `tracks[0].clips[0].notes[0]` 형식이 나오므로, 이 단언은
    // 거부가 구조 단계(zod의 유한성 검사)에서 일어났음을 고정한다.
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
      v: 3,
      tempo: 120,
      timeSignature: ts,
      bars: 500,
      progression: [
        { start: 0, length: 500 * ticksPerBar(ts), chord: { root: 0, quality: "maj" } },
      ],
      tracks: [
        {
          id: "drums",
          instrument: "drums",
          clips: [
            {
              id: "beat",
              start: 0,
              length: 500 * ticksPerBar(ts),
              body: { type: "pattern", pattern: "drum-basic-rock" },
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

  /** parseSong을 부를 때마다 새 입력을 만든다 — 앞선 호출이 입력을 바꿨어도 영향이 없게. */
  function withTempo(tempo: number): any {
    const input = raw();
    input.tempo = tempo;
    return input;
  }

  it("범위를 벗어난 템포는 클램프한다", () => {
    expect(expectRepaired(withTempo(500), "템포를 40~240 범위로").tempo).toBe(240);
    expect(expectRepaired(withTempo(10), "템포를 40~240 범위로").tempo).toBe(40);
  });

  it("범위 안의 소수 템포는 반올림만 했다고 알린다", () => {
    expect(
      expectRepaired(withTempo(120.4), "템포를 정수로 반올림했습니다 (120.4 → 120)").tempo,
    ).toBe(120);
    expect(repairsOf(withTempo(120.4))).not.toContain("범위");

    expect(
      expectRepaired(withTempo(239.6), "템포를 정수로 반올림했습니다 (239.6 → 240)").tempo,
    ).toBe(240);
    expect(repairsOf(withTempo(239.6))).not.toContain("범위");
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

  it("1틱 미만의 겹침은 끝점 반올림이 흡수한다", () => {
    // a의 실제 끝은 0.5 + 479.6 = 480.1이라 b(480~)와 0.1틱 겹치지만, 판정은
    // 반올림한 정수 끝점(480)으로 하므로 맞닿은 클립이 된다. start·length를 따로
    // 반올림하면 a = [1, 481)이 되어 1틱 겹친다.
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.tracks[0].clips = [
      { id: "a", start: 0.5, length: 479.6, body: { type: "notes", notes: [] } },
      { id: "b", start: 480, length: 480, body: { type: "notes", notes: [] } },
    ];
    const song = expectRepaired(input, "반올림");
    expect(song.tracks[0].clips.map((c) => [c.start, c.length])).toEqual([
      [1, 479],
      [480, 480],
    ]);
  });

  it("1틱 미만의 곡 끝 초과도 끝점 반올림이 흡수한다", () => {
    // 실제 끝 0.5 + 1919.6 = 1920.1은 곡 끝(1920)을 0.1틱 넘지만 반올림한 끝점은 1920이다.
    // start·length를 따로 반올림하면 [1, 1921)이 되어 곡 밖으로 나가 거부된다.
    const input = raw();
    input.tracks[0].clips[0] = {
      id: "a",
      start: 0.5,
      length: 1919.6,
      body: { type: "notes", notes: [] },
    };
    const clip = expectRepaired(input, "반올림").tracks[0].clips[0];
    expect([clip.start, clip.length]).toEqual([1, 1919]);
  });

  it("음도 끝점을 반올림하므로 클립 끝에 닿은 음은 잘리지 않는다", () => {
    // [0.5, 1920) → [1, 1920). start·length를 따로 반올림하면 [1, 1921)이 되어
    // '클립 끝에서 잘랐습니다'가 붙는다.
    const input = raw(songWithNotes({ notes: [note(0.5, 1919.5)] }));
    const result = parseSong(input);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.repairs).toEqual(["소수 틱 2개를 정수로 반올림했습니다"]);
    const body = result.song.tracks[0].clips[0].body;
    if (body.type !== "notes") throw new Error("notes 클립이 아니다");
    expect(body.notes).toEqual([{ start: 1, length: 1919, pitch: 60, velocity: 0.5 }]);
  });

  it("1틱 미만의 클립 끝 초과는 음에서도 끝점 반올림이 흡수해 잘리지 않는다", () => {
    // 실제 끝 0.5 + 1919.6 = 1920.1은 클립 끝(1920)을 0.1틱 넘지만 반올림한 끝점은
    // 1920이라 [1, 1920)이 된다. '클립 끝에서 잘랐습니다'가 붙지 않는다.
    const input = raw(songWithNotes({ notes: [note(0.5, 1919.6)] }));
    const result = parseSong(input);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.repairs).toEqual(["소수 틱 2개를 정수로 반올림했습니다"]);
    const body = result.song.tracks[0].clips[0].body;
    if (body.type !== "notes") throw new Error("notes 클립이 아니다");
    expect(body.notes).toEqual([{ start: 1, length: 1919, pitch: 60, velocity: 0.5 }]);
  });

  it("퇴화한 소수 음: 끝점이 다른 정수로 반올림되면 1틱 음으로 받는다", () => {
    // [0.4, 0.6) → start round(0.4)=0, end round(0.6)=1 → [0, 1). 현재 동작을 고정한다.
    const input = raw(songWithNotes({ notes: [note(0.4, 0.2)] }));
    const result = parseSong(input);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.repairs).toEqual(["소수 틱 2개를 정수로 반올림했습니다"]);
    const body = result.song.tracks[0].clips[0].body;
    if (body.type !== "notes") throw new Error("notes 클립이 아니다");
    expect(body.notes).toEqual([{ start: 0, length: 1, pitch: 60, velocity: 0.5 }]);
  });

  it("퇴화한 소수 음: 두 끝점이 같은 정수로 반올림되면 길이 0이라 거부한다", () => {
    // [0.6, 0.8) → start round(0.6)=1, end round(0.8)=1 → 길이 0. 복구가 버리거나
    // 늘리지 않고 그대로 두어 validateSong이 non-positive-length로 거부한다.
    const input = raw(songWithNotes({ notes: [note(0.6, 0.2)] }));
    const result = parseSong(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // '클립 길이는 1틱 이상'과 구분되도록 '음 길이'까지 본다.
    expect(result.errors.join("\n")).toContain("음 길이는 1틱 이상");
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

  it("코드 진행 구간의 소수 틱은 끝점을 반올림한다", () => {
    // [0.4, 960) → [0, 960): start와 length 두 값이 바뀐다.
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.progression = [
      { start: 0.4, length: 959.6, chord: { root: 0, quality: "maj" } },
      { start: 960, length: 2880, chord: { root: 5, quality: "maj" } },
    ];
    const result = parseSong(input);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.repairs).toEqual(["소수 틱 2개를 정수로 반올림했습니다"]);
    expect(result.song.progression.map((p) => [p.start, p.length])).toEqual([
      [0, 960],
      [960, 2880],
    ]);
  });

  it("코드 진행의 소수 틱은 클립·음과 함께 센다", () => {
    // 음 [0.4, 101) → [0, 101): 2개, 구간 길이 1919.6 → 1920: 1개.
    const input = raw(songWithNotes({ notes: [note(0.4, 100.6)] }));
    input.progression[0] = { start: 0, length: 1919.6, chord: { root: 0, quality: "maj" } };
    const result = parseSong(input);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.repairs).toEqual(["소수 틱 3개를 정수로 반올림했습니다"]);
  });

  it("코드 진행 구간 사이의 1틱 미만 겹침은 끝점 반올림이 흡수한다", () => {
    // 첫 구간의 실제 끝 960.4는 다음 시작(960)과 0.4틱 겹치지만 반올림한 끝점은 960이다.
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.progression = [
      { start: 0, length: 960.4, chord: { root: 0, quality: "maj" } },
      { start: 960, length: 2880, chord: { root: 5, quality: "maj" } },
    ];
    const song = expectRepaired(input, "소수 틱 1개를 정수로 반올림했습니다");
    expect(song.progression.map((p) => [p.start, p.length])).toEqual([
      [0, 960],
      [960, 2880],
    ]);
  });

  it("반올림한 뒤에도 남는 코드 진행의 빈틈은 거부한다", () => {
    // 첫 구간의 끝 959.4 → 959. 다음 구간은 960에서 시작해 1틱 빈틈이 남는다.
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.progression = [
      { start: 0, length: 959.4, chord: { root: 0, quality: "maj" } },
      { start: 960, length: 2880, chord: { root: 5, quality: "maj" } },
    ];
    const result = parseSong(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("progression: 코드 진행");
  });

  it("어긋난 코드 진행 순서를 정렬한다", () => {
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.progression = [
      { start: 1920, length: 1920, chord: { root: 5, quality: "maj" } },
      { start: 0, length: 1920, chord: { root: 0, quality: "maj" } },
    ];
    const result = parseSong(input);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.repairs).toEqual(["코드 진행 구간의 순서를 start 순으로 정렬했습니다"]);
    expect(result.song.progression.map((p) => [p.start, p.chord.root])).toEqual([
      [0, 0],
      [1920, 5],
    ]);
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
