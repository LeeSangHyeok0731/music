import { describe, expect, it } from "vitest";

import {
  bakeClip,
  bakeClipInSong,
  clipNotes,
  expandSong,
  instrumentsOf,
} from "@/lib/score/expand";
import type { Chord, Clip, Song } from "@/lib/score/model";
import { songWithNotes } from "@/lib/score/testing/builders";
import { validateSong } from "@/lib/score/validate";

const C_MAJ: Chord = { root: 0, quality: "maj" };
const G_MAJ: Chord = { root: 7, quality: "maj" };

function chordClip(
  id: string,
  start: number,
  length: number,
  chord: Chord,
  pattern: string,
): Clip {
  return { id, start, length, body: { type: "chord", chord, pattern } };
}

function songWith(
  instrument: "piano" | "bass" | "drums",
  clips: Clip[],
  bars = 4,
): Song {
  const song = songWithNotes({ notes: [], bars, instrument });
  song.tracks[0].clips = clips;
  return song;
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

describe("expandSong — 코드 클립", () => {
  it("piano-block은 C장조 3화음을 한 마디 길이로 낸다", () => {
    const song = songWith("piano", [
      chordClip("a", 1920, 1920, C_MAJ, "piano-block"),
    ]);
    const [track] = expandSong(song);
    expect(track.events).toEqual([
      { tick: 1920, length: 1920, pitch: 60, velocity: 0.7 },
      { tick: 1920, length: 1920, pitch: 64, velocity: 0.7 },
      { tick: 1920, length: 1920, pitch: 67, velocity: 0.7 },
    ]);
  });

  it("패턴은 클립 길이만큼 반복된다", () => {
    // bass-root-quarter(한 마디, 4박) × 2마디, G장조 근음 옥타브 2 = 43
    const song = songWith("bass", [
      chordClip("a", 0, 3840, G_MAJ, "bass-root-quarter"),
    ]);
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
    const song = songWith("piano", [
      chordClip("a", 0, 600, C_MAJ, "piano-arpeggio-8th"),
    ]);
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

  it("드럼 패턴은 코드를 읽지 않고 GM 번호를 그대로 쓴다", () => {
    const [track] = expandSong(
      songWith("drums", [chordClip("a", 0, 1920, C_MAJ, "drum-basic-rock")]),
    );
    // 킥 2 + 스네어 2 + 하이햇 8
    expect(track.events).toHaveLength(12);
    // 같은 틱 0에서는 카탈로그에 먼저 적힌 킥(36)이 하이햇(42)보다 앞선다
    expect(track.events.slice(0, 2).map((e) => e.pitch)).toEqual([36, 42]);
  });

  it("events는 여러 클립에 걸쳐서도 tick 오름차순이다", () => {
    const song = songWith("piano", [
      chordClip("a", 0, 1920, C_MAJ, "piano-arpeggio-8th"),
      chordClip("b", 1920, 1920, G_MAJ, "piano-arpeggio-8th"),
    ]);
    // 오름차순인지만 보면 clip.start를 빠뜨린 구현(0, 0, 240, 240, …)도 통과한다.
    const ticks = expandSong(song)[0].events.map((e) => e.tick);
    expect(ticks).toEqual([
      0, 240, 480, 720, 960, 1200, 1440, 1680,
      1920, 2160, 2400, 2640, 2880, 3120, 3360, 3600,
    ]);
  });
});

describe("clipNotes — 오류", () => {
  it("알 수 없는 패턴은 던진다", () => {
    expect(() =>
      clipNotes({ type: "chord", chord: C_MAJ, pattern: "nope" }, "piano", 1920),
    ).toThrow("알 수 없는 패턴");
  });

  it("악기와 맞지 않는 패턴은 던진다", () => {
    expect(() =>
      clipNotes(
        { type: "chord", chord: C_MAJ, pattern: "drum-basic-rock" },
        "piano",
        1920,
      ),
    ).toThrow("맞지 않는 패턴");
  });
});

describe("bake", () => {
  it("chord 클립을 같은 id·start·length의 notes 클립으로 바꾼다", () => {
    const clip = chordClip("a", 1920, 1920, C_MAJ, "piano-block");
    expect(bakeClip(clip, "piano")).toEqual({
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
    const song = songWith("drums", [
      chordClip("a", 0, 1920, C_MAJ, "drum-basic-rock"),
    ]);
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
    const clip: Clip = {
      id: "a",
      start: 0,
      length: 480,
      body: { type: "notes", notes: [] },
    };
    expect(bakeClip(clip, "piano")).toBe(clip);
  });

  it("베이크해도 재생되는 소리는 같다", () => {
    const song = songWith("piano", [
      chordClip("a", 0, 1920, C_MAJ, "piano-arpeggio-8th"),
      chordClip("b", 1920, 1920, G_MAJ, "piano-block"),
    ]);
    const baked = bakeClipInSong(song, "track-1", "a");
    expect(expandSong(baked)).toEqual(expandSong(song));
    expect(validateSong(baked)).toEqual([]);
  });

  it("0이 아닌 곳에서 시작하고 패턴 길이로 나누어지지 않는 클립도 베이크 전후 소리가 같다", () => {
    const song = songWith("piano", [
      chordClip("a", 0, 1920, C_MAJ, "piano-arpeggio-8th"),
      chordClip("b", 1920, 600, G_MAJ, "piano-arpeggio-8th"),
    ]);
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

  it("bakeClipInSong은 그 클립만 바꾸고 원본을 변형하지 않는다", () => {
    const song = songWith("piano", [
      chordClip("a", 0, 1920, C_MAJ, "piano-block"),
      chordClip("b", 1920, 1920, G_MAJ, "piano-block"),
    ]);
    const baked = bakeClipInSong(song, "track-1", "a");
    expect(baked.tracks[0].clips[0].body.type).toBe("notes");
    expect(baked.tracks[0].clips[1]).toBe(song.tracks[0].clips[1]);
    expect(song.tracks[0].clips[0].body.type).toBe("chord");
  });

  it("없는 트랙·클립은 던진다", () => {
    const song = songWith("piano", [chordClip("a", 0, 1920, C_MAJ, "piano-block")]);
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
