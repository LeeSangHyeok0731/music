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
    expect(track.events.map((e) => e.tick)).toEqual([
      0, 480, 960, 1440, 1920, 2400, 2880, 3360,
    ]);
    expect(track.events.every((e) => e.pitch === 43 && e.length === 420)).toBe(
      true,
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

  it("같은 시각의 음은 패턴에 적힌 순서를 유지한다(안정 정렬)", () => {
    const [track] = expandSong(
      songWith("piano", [chordClip("a", 0, 1920, C_MAJ, "piano-block")]),
    );
    expect(track.events.map((e) => e.pitch)).toEqual([60, 64, 67]);
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
    const ticks = expandSong(song)[0].events.map((e) => e.tick);
    expect(ticks).toEqual([...ticks].sort((x, y) => x - y));
    expect(ticks).toHaveLength(16);
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
    const baked = bakeClip(clip, "piano");
    expect(baked.id).toBe("a");
    expect(baked.start).toBe(1920);
    expect(baked.length).toBe(1920);
    expect(baked.body.type).toBe("notes");
    if (baked.body.type === "notes") {
      expect(baked.body.notes.map((n) => [n.start, n.pitch])).toEqual([
        [0, 60],
        [0, 64],
        [0, 67],
      ]);
    }
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
    expect(() => bakeClipInSong(song, "nope", "a")).toThrow();
    expect(() => bakeClipInSong(song, "track-1", "nope")).toThrow();
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
