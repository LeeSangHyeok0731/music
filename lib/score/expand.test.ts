import { describe, expect, it } from "vitest";

import {
  bakeClip,
  bakeClipInSong,
  clipNotes,
  expandSong,
  instrumentsOf,
} from "@/lib/score/expand";
import type {
  Chord,
  ChordSegment,
  Clip,
  InstrumentId,
  Song,
} from "@/lib/score/model";
import { songWithNotes, songWithPatterns } from "@/lib/score/testing/builders";
import { validateSong } from "@/lib/score/validate";

const C_MAJ: Chord = { root: 0, quality: "maj" };
const F_MAJ: Chord = { root: 5, quality: "maj" };
const G_MAJ: Chord = { root: 7, quality: "maj" };
const A_MIN: Chord = { root: 9, quality: "min" };
const G_DOM7: Chord = { root: 7, quality: "dom7" };

const seg = (start: number, length: number, chord: Chord): ChordSegment => ({
  start,
  length,
  chord,
});

type ClipSpec = { id: string; start: number; length: number; pattern: string };
const clip = (
  id: string,
  start: number,
  length: number,
  pattern: string,
): ClipSpec => ({ id, start, length, pattern });

function patternClip(
  id: string,
  start: number,
  length: number,
  pattern: string,
): Clip {
  return { id, start, length, body: { type: "pattern", pattern } };
}

/** 트랙 하나(`track-1`)짜리 곡. 진행을 주지 않으면 곡 전체가 C maj다. */
function songWith(
  instrument: InstrumentId,
  clips: ClipSpec[],
  progression?: ChordSegment[],
  bars = 4,
): Song {
  return songWithPatterns({
    tracks: [{ id: "track-1", instrument, clips }],
    bars,
    progression,
  });
}

describe("expandSong — notes 클립", () => {
  it("클립 상대 틱을 곡 절대 틱으로 바꾼다", () => {
    const song = songWithNotes({ notes: [], bars: 2 });
    song.tracks[0].clips = [
      {
        id: "a",
        start: 1920,
        length: 1920,
        body: {
          type: "notes",
          notes: [
            { start: 0, length: 480, pitch: 60, velocity: 0.5 },
            { start: 480, length: 480, pitch: 64, velocity: 0.5 },
          ],
        },
      },
    ];
    const [track] = expandSong(song);
    expect(track.events.map((e) => e.tick)).toEqual([1920, 2400]);
    expect(track.events.map((e) => e.pitch)).toEqual([60, 64]);
  });

  it("트랙 id와 악기를 그대로 싣는다", () => {
    const [track] = expandSong(
      songWithNotes({ trackId: "t-9", instrument: "bass", notes: [] }),
    );
    expect(track.trackId).toBe("t-9");
    expect(track.instrument).toBe("bass");
    expect(track.events).toEqual([]);
  });
});

describe("expandSong — 패턴 클립", () => {
  it("piano-block은 C장조 3화음을 한 마디 길이로 낸다", () => {
    const song = songWith("piano", [clip("a", 1920, 1920, "piano-block")]);
    const [track] = expandSong(song);
    expect(track.events).toEqual([
      { tick: 1920, length: 1920, pitch: 60, velocity: 0.7 },
      { tick: 1920, length: 1920, pitch: 64, velocity: 0.7 },
      { tick: 1920, length: 1920, pitch: 67, velocity: 0.7 },
    ]);
  });

  it("패턴은 클립 길이만큼 반복된다", () => {
    // bass-root-quarter(한 마디, 4박) × 2마디, G장조 근음 옥타브 2 = 43
    const song = songWith(
      "bass",
      [clip("a", 0, 3840, "bass-root-quarter")],
      [seg(0, 7680, G_MAJ)],
    );
    const [track] = expandSong(song);
    expect(track.events).toEqual(
      [0, 480, 960, 1440, 1920, 2400, 2880, 3360].map((tick) => ({
        tick,
        length: 420,
        pitch: 43,
        velocity: 0.8,
      })),
    );
  });

  it("클립 끝을 넘는 음은 끝에서 잘리고 그 뒤 스텝은 버린다", () => {
    // piano-arpeggio-8th 스텝은 240틱 간격. 클립 길이 600이면 0, 240, 480만 남고
    // 480에서 시작하는 음은 120틱(600-480)으로 잘린다.
    const song = songWith("piano", [clip("a", 0, 600, "piano-arpeggio-8th")]);
    const [track] = expandSong(song);
    expect(track.events.map((e) => [e.tick, e.length])).toEqual([
      [0, 240],
      [240, 240],
      [480, 120],
    ]);
  });

  it("같은 tick의 음은 입력 순서를 유지한다(안정 정렬)", () => {
    // pitch 순서가 아닌 입력 순서(67, 60, 64)여야 한다. 카탈로그 패턴의 동시음은
    // 모두 pitch 오름차순으로 적혀 있어 'pitch로 정렬'과 구분되지 않으므로 음 클립을 쓴다.
    const song = songWithNotes({
      notes: [
        { start: 0, length: 480, pitch: 67, velocity: 0.5 },
        { start: 0, length: 480, pitch: 60, velocity: 0.5 },
        { start: 0, length: 480, pitch: 64, velocity: 0.5 },
      ],
    });
    const [track] = expandSong(song);
    expect(track.events.map((e) => e.pitch)).toEqual([67, 60, 64]);
  });

  it("드럼 패턴은 GM 번호를 그대로 쓴다", () => {
    const [track] = expandSong(
      songWith("drums", [clip("a", 0, 1920, "drum-basic-rock")]),
    );
    // 킥 2 + 스네어 2 + 하이햇 8
    expect(track.events).toHaveLength(12);
    // 같은 틱 0에서는 카탈로그에 먼저 적힌 킥(36)이 하이햇(42)보다 앞선다
    expect(track.events.slice(0, 2).map((e) => e.pitch)).toEqual([36, 42]);
  });

  it("events는 여러 클립에 걸쳐서도 tick 오름차순이다", () => {
    const song = songWith(
      "piano",
      [
        clip("a", 0, 1920, "piano-arpeggio-8th"),
        clip("b", 1920, 1920, "piano-arpeggio-8th"),
      ],
      [seg(0, 1920, C_MAJ), seg(1920, 5760, G_MAJ)],
    );
    // 오름차순인지만 보면 clip.start를 빠뜨린 구현(0, 0, 240, 240, …)도 통과한다.
    const ticks = expandSong(song)[0].events.map((e) => e.tick);
    expect(ticks).toEqual([
      0, 240, 480, 720, 960, 1200, 1440, 1680,
      1920, 2160, 2400, 2640, 2880, 3120, 3360, 3600,
    ]);
  });
});

describe("expandSong — 코드 진행", () => {
  it("진행에 따라 같은 패턴의 음높이가 달라진다", () => {
    // C4 = 60, E4 = 64, G4 = 67 / F4 = 65, A4 = 69, C5 = 72
    const song = songWith(
      "piano",
      [clip("a", 0, 1920, "piano-block"), clip("b", 1920, 1920, "piano-block")],
      [seg(0, 1920, C_MAJ), seg(1920, 1920, F_MAJ)],
      2,
    );
    const [track] = expandSong(song);
    expect(track.events.map((e) => [e.tick, e.pitch])).toEqual([
      [0, 60],
      [0, 64],
      [0, 67],
      [1920, 65],
      [1920, 69],
      [1920, 72],
    ]);
  });

  it("마디 중간 코드 변경은 그 시각부터 이어진다", () => {
    // piano-arpeggio-8th: degree [0,1,2,1,0,1,2,1], 240틱 간격, 옥타브 4.
    // 0~720은 C(60,64,67,64), 960~1680은 G(67,71,74,71).
    const song = songWith(
      "piano",
      [clip("a", 0, 1920, "piano-arpeggio-8th")],
      [seg(0, 960, C_MAJ), seg(960, 960, G_MAJ)],
      1,
    );
    const [track] = expandSong(song);
    expect(track.events.map((e) => [e.tick, e.pitch])).toEqual([
      [0, 60],
      [240, 64],
      [480, 67],
      [720, 64],
      [960, 67],
      [1200, 71],
      [1440, 74],
      [1680, 71],
    ]);
  });

  it("클립이 곡 중간에서 시작해도 절대 시각으로 조회한다", () => {
    // 클립 상대 틱(0, 480, …)으로 조회하면 C 구간이 걸려 36(C2)이 나온다. F2 = 12*3+5 = 41.
    const song = songWith(
      "bass",
      [clip("a", 1920, 1920, "bass-root-quarter")],
      [seg(0, 1920, C_MAJ), seg(1920, 1920, F_MAJ)],
      2,
    );
    const [track] = expandSong(song);
    expect(track.events.map((e) => [e.tick, e.pitch])).toEqual([
      [1920, 41],
      [2400, 41],
      [2880, 41],
      [3360, 41],
    ]);
  });

  it("코드 경계를 넘는 음은 시작 시점 코드의 높이를 유지한다", () => {
    // piano-block의 세 음은 0에서 시작해 1920까지 울린다. 960에서 F로 바뀌어도
    // 음을 쪼개거나 바꾸지 않는다.
    const song = songWith(
      "piano",
      [clip("a", 0, 1920, "piano-block")],
      [seg(0, 960, C_MAJ), seg(960, 960, F_MAJ)],
      1,
    );
    const [track] = expandSong(song);
    expect(track.events).toEqual([
      { tick: 0, length: 1920, pitch: 60, velocity: 0.7 },
      { tick: 0, length: 1920, pitch: 64, velocity: 0.7 },
      { tick: 0, length: 1920, pitch: 67, velocity: 0.7 },
    ]);
  });

  it("드럼 패턴은 진행과 무관하다", () => {
    const clips = [clip("a", 0, 1920, "drum-basic-rock")];
    const a = expandSong(songWith("drums", clips, [seg(0, 1920, C_MAJ)], 1));
    const b = expandSong(
      songWith("drums", clips, [seg(0, 960, A_MIN), seg(960, 960, G_DOM7)], 1),
    );
    expect(a[0].events).toHaveLength(12);
    expect(b).toEqual(a);
  });

  it("진행이 곡을 덮지 않으면 던진다", () => {
    // 브리프의 표는 piano-block을 썼지만 그 패턴은 모든 스텝이 at=0이라 틱 0만
    // 조회하고 던지지 않는다. 960 이후에도 스텝이 있는 아르페지오로 바꿨다.
    const song = songWith(
      "piano",
      [clip("a", 0, 1920, "piano-arpeggio-8th")],
      [seg(0, 960, C_MAJ)],
      1,
    );
    expect(() => expandSong(song)).toThrow(RangeError);
  });
});

describe("clipNotes — 오류", () => {
  const PROG = [seg(0, 1920, C_MAJ)];

  it("알 수 없는 패턴은 던진다", () => {
    expect(() =>
      clipNotes(patternClip("a", 0, 1920, "nope"), "piano", PROG),
    ).toThrow("알 수 없는 패턴: nope");
  });

  it("악기와 맞지 않는 패턴은 던진다", () => {
    expect(() =>
      clipNotes(patternClip("a", 0, 1920, "drum-basic-rock"), "piano", PROG),
    ).toThrow("맞지 않는 패턴");
    expect(() =>
      clipNotes(patternClip("a", 0, 1920, "piano-block"), "drums", PROG),
    ).toThrow("맞지 않는 패턴");
  });
});

describe("bake", () => {
  it("pattern 클립을 같은 id·start·length의 notes 클립으로 바꾼다", () => {
    const c = patternClip("a", 1920, 1920, "piano-block");
    expect(bakeClip(c, "piano", [seg(0, 3840, C_MAJ)])).toEqual({
      id: "a",
      start: 1920,
      length: 1920,
      body: {
        type: "notes",
        notes: [
          { start: 0, length: 1920, pitch: 60, velocity: 0.7 },
          { start: 0, length: 1920, pitch: 64, velocity: 0.7 },
          { start: 0, length: 1920, pitch: 67, velocity: 0.7 },
        ],
      },
    });
  });

  it("베이크한 드럼 클립은 음이 start 오름차순이고 곡 불변식을 지킨다", () => {
    // drum-basic-rock은 킥·스네어·하이햇 순으로 적혀 있어 start가 섞여 있다(0, 960, 480, …).
    // expandSong은 트랙 단위로 다시 정렬하므로 clipNotes의 정렬이 빠져도 재생은 멀쩡하다 —
    // 베이크한 notes 클립에 그대로 저장되는 순서만이 그 정렬에 기댄다.
    const song = songWith("drums", [clip("a", 0, 1920, "drum-basic-rock")]);
    const baked = bakeClipInSong(song, "track-1", "a");
    const body = baked.tracks[0].clips[0].body;
    if (body.type !== "notes") throw new Error("베이크되지 않았다");
    const starts = body.notes.map((n) => n.start);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
    // 같은 start는 카탈로그에 적힌 순서(킥·스네어가 하이햇보다 먼저)를 유지한다.
    expect(body.notes.map((n) => [n.start, n.pitch])).toEqual([
      [0, 36],
      [0, 42],
      [240, 42],
      [480, 38],
      [480, 42],
      [720, 42],
      [960, 36],
      [960, 42],
      [1200, 42],
      [1440, 38],
      [1440, 42],
      [1680, 42],
    ]);
    expect(validateSong(baked)).toEqual([]);
  });

  it("notes 클립은 같은 참조를 돌려준다(멱등)", () => {
    const c: Clip = {
      id: "a",
      start: 0,
      length: 480,
      body: { type: "notes", notes: [] },
    };
    expect(bakeClip(c, "piano", [seg(0, 1920, C_MAJ)])).toBe(c);
  });

  it("베이크해도 재생되는 소리는 같다", () => {
    const song = songWith(
      "piano",
      [
        clip("a", 0, 1920, "piano-arpeggio-8th"),
        clip("b", 1920, 1920, "piano-block"),
      ],
      [seg(0, 1920, C_MAJ), seg(1920, 5760, G_MAJ)],
    );
    const baked = bakeClipInSong(song, "track-1", "a");
    expect(expandSong(baked)).toEqual(expandSong(song));
    expect(validateSong(baked)).toEqual([]);
  });

  it("0이 아닌 곳에서 시작하고 패턴 길이로 나누어지지 않는 클립도 베이크 전후 소리가 같다", () => {
    const song = songWith(
      "piano",
      [
        clip("a", 0, 1920, "piano-arpeggio-8th"),
        clip("b", 1920, 600, "piano-arpeggio-8th"),
      ],
      [seg(0, 1920, C_MAJ), seg(1920, 5760, G_MAJ)],
    );
    const baked = bakeClipInSong(song, "track-1", "b");
    expect(expandSong(baked)).toEqual(expandSong(song));
    expect(validateSong(baked)).toEqual([]);
    // 양쪽 모두 clipNotes를 거치므로 동치만으로는 clipNotes의 잘못을 못 잡는다.
    // 베이크 결과(클립 상대)와 재생 이벤트(곡 절대)를 직접 못박는다.
    // G장조 옥타브 4: 67, 71, 74. 480에서 시작한 음은 600에서 잘려 120틱이다.
    expect(baked.tracks[0].clips[1].body).toEqual({
      type: "notes",
      notes: [
        { start: 0, length: 240, pitch: 67, velocity: 0.6 },
        { start: 240, length: 240, pitch: 71, velocity: 0.6 },
        { start: 480, length: 120, pitch: 74, velocity: 0.6 },
      ],
    });
    expect(
      expandSong(baked)[0]
        .events.filter((e) => e.tick >= 1920)
        .map((e) => [e.tick, e.length]),
    ).toEqual([
      [1920, 240],
      [2160, 240],
      [2400, 120],
    ]);
  });

  it("베이크는 그 시점의 진행으로 굳는다", () => {
    const song = songWith(
      "piano",
      [clip("a", 0, 1920, "piano-arpeggio-8th")],
      [seg(0, 960, C_MAJ), seg(960, 960, G_MAJ)],
      1,
    );
    const bakedClip = bakeClip(song.tracks[0].clips[0], "piano", song.progression);
    if (bakedClip.body.type !== "notes") throw new Error("베이크되지 않았다");
    expect(bakedClip.body.notes.map((n) => [n.start, n.pitch])).toEqual([
      [0, 60],
      [240, 64],
      [480, 67],
      [720, 64],
      [960, 67],
      [1200, 71],
      [1440, 74],
      [1680, 71],
    ]);

    const baked = bakeClipInSong(song, "track-1", "a");
    const before = expandSong(baked);
    const rechorded = { ...baked, progression: [seg(0, 1920, F_MAJ)] };
    expect(validateSong(rechorded)).toEqual([]);
    expect(expandSong(rechorded)).toEqual(before);
    // 대조군: 베이크하지 않은 곡은 같은 진행 변경에 따라온다.
    expect(expandSong({ ...song, progression: rechorded.progression })).not.toEqual(
      before,
    );
  });

  it("여러 클립·진행 변경이 있는 곡도 클립을 하나씩 베이크해도 소리가 같다", () => {
    // 진행: C 0~960, Am 960~2880, F 2880~4800, G7 4800~7680 — 클립 경계와 어긋난다.
    const song = songWithPatterns({
      bars: 4,
      progression: [
        seg(0, 960, C_MAJ),
        seg(960, 1920, A_MIN),
        seg(2880, 1920, F_MAJ),
        seg(4800, 2880, G_DOM7),
      ],
      tracks: [
        {
          id: "track-piano",
          instrument: "piano",
          clips: [
            clip("p0", 0, 1920, "piano-arpeggio-8th"),
            clip("p1", 1920, 1920, "piano-block"),
            clip("p2", 3840, 600, "piano-arpeggio-8th"),
            clip("p3", 5760, 1920, "piano-arpeggio-8th"),
          ],
        },
        {
          id: "track-bass",
          instrument: "bass",
          clips: [clip("b0", 960, 5760, "bass-root-fifth")],
        },
        {
          id: "track-drums",
          instrument: "drums",
          clips: [clip("d0", 0, 7680, "drum-basic-rock")],
        },
      ],
    });
    expect(validateSong(song)).toEqual([]);
    const expected = expandSong(song);

    let baked = song;
    for (const [trackId, clipId] of [
      ["track-piano", "p0"],
      ["track-piano", "p1"],
      ["track-piano", "p2"],
      ["track-piano", "p3"],
      ["track-bass", "b0"],
      ["track-drums", "d0"],
    ] as const) {
      baked = bakeClipInSong(baked, trackId, clipId);
      expect(expandSong(baked)).toEqual(expected);
      expect(validateSong(baked)).toEqual([]);
    }
    expect(
      baked.tracks.flatMap((t) => t.clips.map((c) => c.body.type)),
    ).toEqual(Array(6).fill("notes"));
  });

  it("bakeClipInSong은 그 클립만 바꾸고 원본을 변형하지 않는다", () => {
    const song = songWith("piano", [
      clip("a", 0, 1920, "piano-block"),
      clip("b", 1920, 1920, "piano-block"),
    ]);
    const baked = bakeClipInSong(song, "track-1", "a");
    expect(baked.tracks[0].clips[0].body.type).toBe("notes");
    expect(baked.tracks[0].clips[1]).toBe(song.tracks[0].clips[1]);
    expect(song.tracks[0].clips[0].body.type).toBe("pattern");
  });

  it("없는 트랙·클립은 던진다", () => {
    const song = songWith("piano", [clip("a", 0, 1920, "piano-block")]);
    expect(() => bakeClipInSong(song, "nope", "a")).toThrow(
      "트랙을 찾을 수 없습니다: nope",
    );
    expect(() => bakeClipInSong(song, "track-1", "nope")).toThrow(
      "클립을 찾을 수 없습니다: nope",
    );
  });
});

describe("instrumentsOf", () => {
  it("곡에 쓰인 악기를 중복 없이 처음 등장 순서로 돌려준다", () => {
    const song = songWithNotes({ notes: [], instrument: "piano" });
    song.tracks.push(
      { id: "t2", instrument: "drums", clips: [] },
      { id: "t3", instrument: "piano", clips: [] },
      { id: "t4", instrument: "bass", clips: [] },
    );
    expect(instrumentsOf(song)).toEqual(["piano", "drums", "bass"]);
  });
});
