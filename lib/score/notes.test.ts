import { describe, expect, it } from "vitest";

import { addClip } from "@/lib/score/edit";
import { expandSong } from "@/lib/score/expand";
import type {
  ChordSegment,
  InstrumentId,
  Note,
  NotesBody,
  Song,
} from "@/lib/score/model";
import {
  DEFAULT_VELOCITY,
  GRID_UNITS,
  MIN_VELOCITY,
  PITCH_RANGE,
  addEmptyNotesClip,
  addNote,
  bakeClipToNotes,
  displayRange,
  emptyNotesClip,
  moveNotes,
  noteKey,
  planAddNote,
  planMoveNotes,
  planRemoveNotes,
  planResizeNotes,
  planSetVelocities,
  removeNotes,
  resizeNotes,
  selectNotesInBox,
  setVelocities,
  snapTickDelta,
  type GridUnit,
  type NoteKey,
  type NotePlan,
} from "@/lib/score/notes";
import {
  songWithNotes,
  songWithPatterns,
} from "@/lib/score/testing/builders";
import { mulberry32 } from "@/lib/score/testing/random";
import { validateSong } from "@/lib/score/validate";

const T = "track-1";
const K = "clip-1";

function n(start: number, length: number, pitch: number, velocity = 0.8): Note {
  return { start, length, pitch, velocity };
}

// 기본 음. 클립 `clip-1`(길이 7680, 4마디) 안에 있다.
const A = n(0, 480, 60);
const B = n(480, 480, 64);
const C = n(480, 480, 67);
const D = n(960, 960, 60);

/** 기본 곡: 피아노, 4마디, 음 클립 하나. 음은 값으로 복사해 테스트끼리 공유하지 않는다. */
function base(notes: Note[] = [A, B, C, D], instrument: InstrumentId = "piano"): Song {
  return songWithNotes({
    instrument,
    bars: 4,
    notes: notes.map((x) => ({ ...x })),
  });
}

function notesOf(song: Song, trackIndex = 0, clipIndex = 0): Note[] {
  const body = song.tracks[trackIndex].clips[clipIndex].body;
  if (body.type !== "notes") throw new Error("notes 클립이 아니다");
  return body.notes;
}

/** 편집 뒤의 공통 검사: 결과가 유효하고 입력은 변형되지 않았다. */
function expectValidAndInputUntouched(input: Song, snapshot: Song, result: Song) {
  expect(validateSong(result)).toEqual([]);
  expect(input).toEqual(snapshot);
}

/** 계획을 실행하고 공통 검사를 거친 뒤 결과를 돌려준다. */
function run(song: Song, plan: (s: Song) => NotePlan): NotePlan {
  const snapshot = structuredClone(song);
  const result = plan(song);
  expectValidAndInputUntouched(song, snapshot, result.song);
  return result;
}

describe("상수와 noteKey", () => {
  it("격자 단위·세기·음높이 표", () => {
    expect(GRID_UNITS).toEqual({ "1/4": 480, "1/8": 240, "1/16": 120 });
    expect(DEFAULT_VELOCITY).toBe(0.8);
    expect(MIN_VELOCITY).toBe(0.05);
    expect(PITCH_RANGE).toEqual({
      piano: { lo: 36, hi: 96 },
      guitar: { lo: 40, hi: 84 },
      bass: { lo: 28, hi: 60 },
    });
  });

  it("noteKey는 `start:pitch`", () => {
    expect(noteKey(A)).toBe("0:60");
    expect(noteKey({ start: 480, pitch: 67 })).toBe("480:67");
  });
});

describe("displayRange", () => {
  it("음이 없으면 표 그대로", () => {
    expect(displayRange("piano", [])).toEqual({ lo: 36, hi: 96 });
  });

  it("표 범위 ∪ (음 ± 2)", () => {
    expect(displayRange("piano", [n(0, 1, 30), n(0, 1, 100)])).toEqual({
      lo: 28,
      hi: 102,
    });
    expect(displayRange("piano", [A, B, C, D])).toEqual({ lo: 36, hi: 96 });
  });

  it("bass에 pitch 20 음 → {18, 60}, 0..127로 클램프", () => {
    expect(displayRange("bass", [n(0, 1, 20)])).toEqual({ lo: 18, hi: 60 });
    expect(displayRange("guitar", [n(0, 1, 0), n(0, 1, 127)])).toEqual({
      lo: 0,
      hi: 127,
    });
  });
});

describe("오류: 없는 트랙·클립, 패턴 클립, 드럼 트랙", () => {
  const patternSong = songWithPatterns({
    bars: 4,
    tracks: [
      {
        id: T,
        instrument: "piano",
        clips: [{ id: K, start: 0, length: 1920, pattern: "piano-block" }],
      },
    ],
  });
  const drumSong = base([n(0, 240, 36)], "drums");

  const calls: Array<[string, (s: Song, t: string, c: string) => unknown]> = [
    ["planAddNote", (s, t, c) => planAddNote(s, t, c, { start: 0, pitch: 62 }, "1/4")],
    ["planMoveNotes", (s, t, c) => planMoveNotes(s, t, c, ["0:60"], 480, 0, "1/4")],
    ["planResizeNotes", (s, t, c) => planResizeNotes(s, t, c, ["0:60"], 480, "1/4")],
    ["planRemoveNotes", (s, t, c) => planRemoveNotes(s, t, c, ["0:60"])],
    ["planSetVelocities", (s, t, c) => planSetVelocities(s, t, c, ["0:60"], 0.5)],
    [
      "selectNotesInBox",
      (s, t, c) =>
        selectNotesInBox(s, t, c, { startTick: 0, endTick: 480, loPitch: 0, hiPitch: 127 }),
    ],
  ];

  for (const [name, call] of calls) {
    it(`${name}: 각각 Error`, () => {
      expect(() => call(base(), "nope", K)).toThrow(Error);
      expect(() => call(base(), T, "nope")).toThrow(Error);
      expect(() => call(patternSong, T, K)).toThrow("notes 클립이 아닙니다");
      expect(() => call(drumSong, T, K)).toThrow("화음 악기의 음 클립만 편집합니다");
    });
  }

  it("bakeClipToNotes·emptyNotesClip: 없는 트랙·클립은 Error", () => {
    expect(() => bakeClipToNotes(patternSong, "nope", K)).toThrow(Error);
    expect(() => bakeClipToNotes(patternSong, T, "nope")).toThrow(Error);
    expect(() => emptyNotesClip(patternSong, "nope", K)).toThrow(Error);
    expect(() => emptyNotesClip(patternSong, T, "nope")).toThrow(Error);
  });
});

describe("planAddNote", () => {
  it("start 1000, pitch 62: 960 칸으로 내리고 start 960 그룹 뒤(D 뒤)에 삽입", () => {
    const song = base();
    const r = run(song, (s) => planAddNote(s, T, K, { start: 1000, pitch: 62 }, "1/4"));
    expect(notesOf(r.song)).toEqual([A, B, C, D, n(960, 480, 62)]);
    expect(r.keys).toEqual(["960:62"]);
  });

  it("start 800, pitch 62: 반올림이 아니라 칸의 시작으로 내림 → 480", () => {
    const song = base();
    const r = run(song, (s) => planAddNote(s, T, K, { start: 800, pitch: 62 }, "1/4"));
    expect(notesOf(r.song)).toEqual([A, B, C, n(480, 480, 62), D]);
    expect(r.keys).toEqual(["480:62"]);
  });

  it("start 1000, pitch 60: 같은 음높이 D가 960을 품음 → no-op(같은 참조)", () => {
    const song = base();
    const r = planAddNote(song, T, K, { start: 1000, pitch: 60 }, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual([]);
  });

  it("start 0, pitch 60: A가 품음 → no-op", () => {
    const song = base();
    const r = planAddNote(song, T, K, { start: 0, pitch: 60 }, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual([]);
  });

  it("start 480, pitch 60: A와 맞닿고 다음 D(960)까지 → {480,480,60}", () => {
    const song = base();
    const r = run(song, (s) => planAddNote(s, T, K, { start: 480, pitch: 60 }, "1/4"));
    expect(notesOf(r.song)).toEqual([A, B, C, n(480, 480, 60), D]);
    expect(r.keys).toEqual(["480:60"]);
  });

  it("start 600, pitch 60, length 960, 1/16: 다음 같은 음높이 D 직전까지 → {600,360,60}", () => {
    const song = base();
    const r = run(song, (s) =>
      planAddNote(s, T, K, { start: 600, pitch: 60, length: 960 }, "1/16"),
    );
    expect(notesOf(r.song)).toEqual([A, B, C, n(600, 360, 60), D]);
    expect(r.keys).toEqual(["600:60"]);
  });

  it("start 7500, pitch 62: start' 7200, 길이 480이 클립 끝에 딱 맞음 → 추가", () => {
    const song = base();
    const r = run(song, (s) => planAddNote(s, T, K, { start: 7500, pitch: 62 }, "1/4"));
    expect(notesOf(r.song).at(-1)).toEqual(n(7200, 480, 62));
  });

  it("start 7200, pitch 62, length 960: 클립 끝으로 클램프 → 길이 480", () => {
    const song = base();
    const r = run(song, (s) =>
      planAddNote(s, T, K, { start: 7200, pitch: 62, length: 960 }, "1/4"),
    );
    expect(notesOf(r.song).at(-1)).toEqual(n(7200, 480, 62));
  });

  it("길이는 격자 단위로 내림하고 최소 한 칸, NaN이면 no-op, ±Infinity는 클램프", () => {
    const song = base();
    const at = (length: number) =>
      planAddNote(song, T, K, { start: 2400, pitch: 62, length }, "1/4");
    expect(notesOf(at(1000).song).at(-1)).toEqual(n(2400, 960, 62));
    expect(notesOf(at(100).song).at(-1)).toEqual(n(2400, 480, 62));
    expect(notesOf(at(Number.POSITIVE_INFINITY).song).at(-1)).toEqual(
      n(2400, 7680 - 2400, 62),
    );
    expect(notesOf(at(Number.NEGATIVE_INFINITY).song).at(-1)).toEqual(
      n(2400, 480, 62),
    );
    const nan = at(Number.NaN);
    expect(nan.song).toBe(song);
    expect(nan.keys).toEqual([]);
  });

  it("start 7680 / -10 / NaN / Infinity: 전부 no-op", () => {
    const song = base();
    for (const start of [7680, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = planAddNote(song, T, K, { start, pitch: 62 }, "1/4");
      expect(r.song, String(start)).toBe(song);
      expect(r.keys).toEqual([]);
    }
  });

  it("pitch 20 / 97 / 60.5 / NaN: 표시 범위 밖·비정수 → no-op, pitch 96·36은 추가", () => {
    const song = base();
    for (const pitch of [20, 35, 97, 60.5, Number.NaN]) {
      const r = planAddNote(song, T, K, { start: 2400, pitch }, "1/4");
      expect(r.song, String(pitch)).toBe(song);
      expect(r.keys).toEqual([]);
    }
    for (const pitch of [96, 36]) {
      const r = run(song, (s) => planAddNote(s, T, K, { start: 2400, pitch }, "1/4"));
      expect(r.keys).toEqual([`2400:${pitch}`]);
    }
  });

  it("표시 범위는 클립의 음까지 넓어진다: pitch 100 음이 있으면 102까지 추가", () => {
    const song = base([n(0, 480, 100)]);
    const r = run(song, (s) => planAddNote(s, T, K, { start: 960, pitch: 102 }, "1/4"));
    expect(r.keys).toEqual(["960:102"]);
    expect(planAddNote(song, T, K, { start: 960, pitch: 103 }, "1/4").song).toBe(song);
  });

  it("velocity 1.5 / 0 / 생략 → 1 / 0.05 / 0.8, NaN은 no-op", () => {
    const song = base();
    const vel = (velocity: number | undefined) =>
      notesOf(planAddNote(song, T, K, { start: 2400, pitch: 62, velocity }, "1/4").song).at(
        -1,
      )?.velocity;
    expect(vel(1.5)).toBe(1);
    expect(vel(0)).toBe(0.05);
    expect(vel(undefined)).toBe(0.8);
    expect(vel(0.3)).toBe(0.3);
    expect(
      planAddNote(song, T, K, { start: 2400, pitch: 62, velocity: Number.NaN }, "1/4")
        .song,
    ).toBe(song);
  });

  it("다른 트랙·클립은 같은 참조로 남는다", () => {
    const song = base();
    song.tracks.push({
      id: "other",
      instrument: "bass",
      clips: [{ id: K, start: 0, length: 1920, body: { type: "notes", notes: [] } }],
    });
    const r = run(song, (s) => planAddNote(s, T, K, { start: 2400, pitch: 62 }, "1/4"));
    expect(r.song.tracks[1]).toBe(song.tracks[1]);
  });

  it("addNote는 planAddNote(...).song", () => {
    const song = base();
    expect(addNote(song, T, K, { start: 1000, pitch: 62 }, "1/4")).toEqual(
      planAddNote(song, T, K, { start: 1000, pitch: 62 }, "1/4").song,
    );
    expect(addNote(song, T, K, { start: 0, pitch: 60 }, "1/4")).toBe(song);
  });
});

describe("planMoveNotes", () => {
  const BC: NoteKey[] = ["480:64", "480:67"];

  it("B·C를 dTicks 480: 결과 순서 [A, B', C', D], 새 키", () => {
    const song = base();
    const r = run(song, (s) => planMoveNotes(s, T, K, BC, 480, 0, "1/4"));
    expect(notesOf(r.song)).toEqual([A, n(960, 480, 64), n(960, 480, 67), D]);
    expect(r.keys).toEqual(["960:64", "960:67"]);
  });

  it("dTicks 500: round(500/480)=1 → 위와 같음", () => {
    const song = base();
    const r = run(song, (s) => planMoveNotes(s, T, K, BC, 500, 0, "1/4"));
    expect(notesOf(r.song)).toEqual([A, n(960, 480, 64), n(960, 480, 67), D]);
    expect(r.keys).toEqual(["960:64", "960:67"]);
  });

  it("dTicks 300: 내림이 아니라 반올림 → round(0.625)=1 → 480 이동", () => {
    const song = base();
    const r = run(song, (s) => planMoveNotes(s, T, K, BC, 300, 0, "1/4"));
    expect(r.keys).toEqual(["960:64", "960:67"]);
  });

  it("dTicks 200: round(0.416)=0, dPitch 0 → no-op", () => {
    const song = base();
    const r = planMoveNotes(song, T, K, BC, 200, 0, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual(BC);
  });

  it("dTicks -200: round(-0.416)=0 → no-op(내림이면 -480 이동)", () => {
    const song = base();
    const r = planMoveNotes(song, T, K, BC, -200, 0, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual(BC);
  });

  it("dTicks 0, dPitch +2: B→66, C→69", () => {
    const song = base();
    const r = run(song, (s) => planMoveNotes(s, T, K, BC, 0, 2, "1/4"));
    expect(notesOf(r.song)).toEqual([A, n(480, 480, 66), n(480, 480, 69), D]);
    expect(r.keys).toEqual(["480:66", "480:69"]);
  });

  it("dPitch는 정수로 반올림: 1.6 → 2, 0.4 → no-op", () => {
    const song = base();
    expect(run(song, (s) => planMoveNotes(s, T, K, BC, 0, 1.6, "1/4")).keys).toEqual([
      "480:66",
      "480:69",
    ]);
    expect(planMoveNotes(song, T, K, BC, 0, 0.4, "1/4").song).toBe(song);
  });

  it("A를 dTicks 960: D와 겹침 → 전체 거부, keys=입력", () => {
    const song = base();
    const r = planMoveNotes(song, T, K, ["0:60"], 960, 0, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual(["0:60"]);
  });

  it("선택 안 된 다른 음과의 겹침: A·E를 +2 → E'(64)가 B와 겹쳐 전체 거부", () => {
    // A(0..480,60)→62는 E가 떠난 자리와 겹치지 않지만 E(480..960,62)→64가 B와 겹친다.
    const E = n(480, 480, 62);
    const song = base([A, B, E, D]);
    const r = planMoveNotes(song, T, K, ["0:60", "480:62"], 0, 2, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual(["0:60", "480:62"]);
  });

  it("이동한 음끼리의 겹침도 거부(손으로 고친 곡: 같은 음높이로 겹친 두 음을 함께 이동)", () => {
    const song = base([n(0, 960, 60), n(480, 960, 60)]);
    const r = planMoveNotes(song, T, K, ["0:60", "480:60"], 1920, 0, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual(["0:60", "480:60"]);
  });

  it("D를 dTicks -480: A와 맞닿음 → 허용, 순서 [A,B,C,D']", () => {
    const song = base();
    const r = run(song, (s) => planMoveNotes(s, T, K, ["960:60"], -480, 0, "1/4"));
    expect(notesOf(r.song)).toEqual([A, B, C, n(480, 960, 60)]);
    expect(r.keys).toEqual(["480:60"]);
  });

  it("D를 dTicks -1920 / +6720 / +5760: 거부 / 거부 / 허용", () => {
    const song = base();
    expect(planMoveNotes(song, T, K, ["960:60"], -1920, 0, "1/4").song).toBe(song);
    expect(planMoveNotes(song, T, K, ["960:60"], 6720, 0, "1/4").song).toBe(song);
    const r = run(song, (s) => planMoveNotes(s, T, K, ["960:60"], 5760, 0, "1/4"));
    expect(notesOf(r.song).at(-1)).toEqual(n(6720, 960, 60));
    expect(r.keys).toEqual(["6720:60"]);
  });

  it("A를 dPitch +40 / -24 / -25: 거부 / 허용 / 거부", () => {
    const song = base();
    expect(planMoveNotes(song, T, K, ["0:60"], 0, 40, "1/4").song).toBe(song);
    expect(run(song, (s) => planMoveNotes(s, T, K, ["0:60"], 0, -24, "1/4")).keys).toEqual([
      "0:36",
    ]);
    expect(planMoveNotes(song, T, K, ["0:60"], 0, -25, "1/4").song).toBe(song);
  });

  it("화음 모양: B·C를 dPitch +30 → C가 97이라 덩어리 전체 거부(음별로 깎지 않는다)", () => {
    const song = base();
    const r = planMoveNotes(song, T, K, BC, 0, 30, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual(BC);
  });

  it("화음 모양(시간축): A·D를 dTicks +6720 → D가 클립 밖이라 전체 거부", () => {
    const song = base();
    const r = planMoveNotes(song, T, K, ["0:60", "960:60"], 6720, 0, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual(["0:60", "960:60"]);
  });

  it("NaN·±Infinity: 전부 no-op", () => {
    const song = base();
    for (const [dt, dp] of [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [Number.NEGATIVE_INFINITY, 0],
      [0, Number.POSITIVE_INFINITY],
      [0, Number.NEGATIVE_INFINITY],
    ]) {
      const r = planMoveNotes(song, T, K, BC, dt, dp, "1/4");
      expect(r.song, `${dt},${dp}`).toBe(song);
      expect(r.keys).toEqual(BC);
    }
  });

  it('["999:1"]: 낡은 키는 무시 → no-op(같은 참조), keys=[]', () => {
    const song = base();
    const r = planMoveNotes(song, T, K, ["999:1"], 480, 0, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual([]);
  });

  it("있는 키와 없는 키를 섞으면 있는 것만 이동, 중복 키는 한 번", () => {
    const song = base();
    const r = run(song, (s) =>
      planMoveNotes(s, T, K, ["999:1", "480:64", "480:64"], 0, 1, "1/4"),
    );
    expect(notesOf(r.song)).toEqual([A, n(480, 480, 65), C, D]);
    expect(r.keys).toEqual(["480:65"]);
  });

  it("거부된 이동의 keys는 걸러진 입력 키", () => {
    const song = base();
    const r = planMoveNotes(song, T, K, ["999:1", "0:60"], 960, 0, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual(["0:60"]);
  });

  it("손으로 고친 곡: 선택 안 된 같은 음높이 70 두 음의 겹침은 검사하지 않는다", () => {
    const song = base([A, B, C, n(1920, 960, 70), n(2400, 960, 70)]);
    const r = run(song, (s) => planMoveNotes(s, T, K, ["480:64"], 0, 2, "1/4"));
    expect(r.keys).toEqual(["480:66"]);
  });

  it("음높이 범위는 원래 클립의 음 기준: 100 음이 있으면 다른 음을 102까지 옮길 수 있다", () => {
    const song = base([A, n(960, 480, 100)]);
    expect(run(song, (s) => planMoveNotes(s, T, K, ["0:60"], 0, 42, "1/4")).keys).toEqual([
      "0:102",
    ]);
    expect(planMoveNotes(song, T, K, ["0:60"], 0, 43, "1/4").song).toBe(song);
  });

  it("뒤로 옮긴 음은 안정 정렬로 제자리를 찾는다", () => {
    const song = base();
    const r = run(song, (s) => planMoveNotes(s, T, K, ["0:60"], 1920, 0, "1/4"));
    expect(notesOf(r.song)).toEqual([B, C, D, n(1920, 480, 60)]);
  });

  it("moveNotes는 planMoveNotes(...).song", () => {
    const song = base();
    expect(moveNotes(song, T, K, BC, 480, 0, "1/4")).toEqual(
      planMoveNotes(song, T, K, BC, 480, 0, "1/4").song,
    );
    expect(moveNotes(song, T, K, BC, 0, 0, "1/4")).toBe(song);
  });
});

describe("planResizeNotes", () => {
  const len = (song: Song, key: NoteKey) =>
    notesOf(song).find((x) => noteKey(x) === key)?.length;

  it("A, +480: maxLen 960(D와 맞닿음) → 길이 960", () => {
    const song = base();
    const r = run(song, (s) => planResizeNotes(s, T, K, ["0:60"], 480, "1/4"));
    expect(len(r.song, "0:60")).toBe(960);
    expect(r.keys).toEqual(["0:60"]);
  });

  it("A, +960: 상한 480으로 클램프 → 길이 960", () => {
    const song = base();
    const r = run(song, (s) => planResizeNotes(s, T, K, ["0:60"], 960, "1/4"));
    expect(len(r.song, "0:60")).toBe(960);
  });

  it("A, -480: 하한 0 → d_eff 0 → no-op", () => {
    const song = base();
    const r = planResizeNotes(song, T, K, ["0:60"], -480, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual(["0:60"]);
  });

  it("D(길이 960), -480 / -960: 길이 480 / 하한으로 클램프 → 480", () => {
    const song = base();
    for (const d of [-480, -960]) {
      const r = run(song, (s) => planResizeNotes(s, T, K, ["960:60"], d, "1/4"));
      expect(len(r.song, "960:60"), String(d)).toBe(480);
    }
  });

  it("[A, D], +480 / +960: 덩어리 상한 480 → A 960, D 1440", () => {
    const song = base();
    for (const d of [480, 960]) {
      const r = run(song, (s) => planResizeNotes(s, T, K, ["0:60", "960:60"], d, "1/4"));
      expect(len(r.song, "0:60")).toBe(960);
      expect(len(r.song, "960:60")).toBe(1440);
      expect(r.keys).toEqual(["0:60", "960:60"]);
    }
  });

  it("D, +99999 / +Infinity: 클립 끝(길이 6720)", () => {
    const song = base();
    for (const d of [99999, Number.POSITIVE_INFINITY]) {
      const r = run(song, (s) => planResizeNotes(s, T, K, ["960:60"], d, "1/4"));
      expect(len(r.song, "960:60")).toBe(6720);
    }
  });

  it("D, -Infinity: 하한(한 칸)으로 수렴 → 480", () => {
    const song = base();
    const r = run(song, (s) =>
      planResizeNotes(s, T, K, ["960:60"], Number.NEGATIVE_INFINITY, "1/4"),
    );
    expect(len(r.song, "960:60")).toBe(480);
  });

  it("D, 200: round(200/480)=0 → no-op, NaN도 no-op", () => {
    const song = base();
    expect(planResizeNotes(song, T, K, ["960:60"], 200, "1/4").song).toBe(song);
    expect(planResizeNotes(song, T, K, ["960:60"], Number.NaN, "1/4").song).toBe(song);
  });

  it("격자보다 짧은 음(240): -480 / 0은 no-op(줄이려다 늘지 않는다), +480은 720", () => {
    const S = n(0, 240, 62);
    const song = base([S]);
    for (const d of [-480, 0]) {
      const r = planResizeNotes(song, T, K, ["0:62"], d, "1/4");
      expect(r.song, String(d)).toBe(song);
      expect(r.keys).toEqual(["0:62"]);
    }
    const r = run(song, (s) => planResizeNotes(s, T, K, ["0:62"], 480, "1/4"));
    expect(len(r.song, "0:62")).toBe(720);
  });

  it("상한 < 하한이면 no-op", () => {
    // A(0..480)의 다음 같은 음높이가 240에 있다(손으로 고친 곡): maxLen 240 < 길이 480.
    // 다른 선택 음 E(1920..2160)의 하한은 480-240=240 > A의 상한 240-480 → 상한<하한.
    const song = base([A, n(240, 240, 60), n(1920, 240, 62)]);
    // +480·−480 둘 다: −480은 상한·하한만 보면 −240으로 클램프돼 방향이 맞으므로
    // 상한<하한 검사만이 거부한다.
    for (const d of [480, -480]) {
      const r = planResizeNotes(song, T, K, ["0:60", "1920:62"], d, "1/4");
      expect(r.song, String(d)).toBe(song);
      expect(r.keys).toEqual(["0:60", "1920:62"]);
    }
  });

  it('낡은 키만 있으면 no-op, keys=[]', () => {
    const song = base();
    const r = planResizeNotes(song, T, K, ["999:1"], 480, "1/4");
    expect(r.song).toBe(song);
    expect(r.keys).toEqual([]);
  });

  it("resizeNotes는 planResizeNotes(...).song", () => {
    const song = base();
    expect(resizeNotes(song, T, K, ["0:60"], 480, "1/4")).toEqual(
      planResizeNotes(song, T, K, ["0:60"], 480, "1/4").song,
    );
  });
});

describe("planRemoveNotes", () => {
  it('["480:64"]: B 삭제, keys=[]', () => {
    const song = base();
    const r = run(song, (s) => planRemoveNotes(s, T, K, ["480:64"]));
    expect(notesOf(r.song)).toEqual([A, C, D]);
    expect(r.keys).toEqual([]);
  });

  it("없는 키: no-op(같은 참조)", () => {
    const song = base();
    const r = planRemoveNotes(song, T, K, ["999:1"]);
    expect(r.song).toBe(song);
    expect(r.keys).toEqual([]);
  });

  it("전체: notes []이고 클립은 남는다", () => {
    const song = base();
    const r = run(song, (s) =>
      planRemoveNotes(s, T, K, ["0:60", "480:64", "480:67", "960:60"]),
    );
    expect(notesOf(r.song)).toEqual([]);
    expect(r.song.tracks[0].clips).toHaveLength(1);
  });

  it("같은 (start,pitch)가 둘이면(손으로 고친 곡) 첫 음만 지운다", () => {
    const song = base([n(0, 240, 60), n(0, 480, 60)]);
    const r = run(song, (s) => planRemoveNotes(s, T, K, ["0:60", "0:60"]));
    expect(notesOf(r.song)).toEqual([n(0, 480, 60)]);
  });

  it("removeNotes는 planRemoveNotes(...).song", () => {
    const song = base();
    expect(removeNotes(song, T, K, ["480:64"])).toEqual(
      planRemoveNotes(song, T, K, ["480:64"]).song,
    );
  });
});

describe("planSetVelocities", () => {
  it('["0:60"] 0.5 / 한 번 더 / 2 / 0 / NaN', () => {
    const song = base();
    const r = run(song, (s) => planSetVelocities(s, T, K, ["0:60"], 0.5));
    expect(notesOf(r.song)[0].velocity).toBe(0.5);
    expect(notesOf(r.song).slice(1)).toEqual([B, C, D]);
    expect(r.keys).toEqual(["0:60"]);

    const again = planSetVelocities(r.song, T, K, ["0:60"], 0.5);
    expect(again.song).toBe(r.song);
    expect(again.keys).toEqual(["0:60"]);

    const velocityAfter = (v: number) =>
      notesOf(run(song, (s) => planSetVelocities(s, T, K, ["0:60"], v)).song)[0].velocity;
    expect(velocityAfter(2)).toBe(1);
    expect(velocityAfter(0)).toBe(0.05);
    const nan = planSetVelocities(song, T, K, ["0:60"], Number.NaN);
    expect(nan.song).toBe(song);
    expect(nan.keys).toEqual(["0:60"]);
  });

  it("여러 음은 같은 값으로, 이미 그 값인 음은 같은 객체로", () => {
    const song = base([A, n(480, 480, 64, 0.5)]);
    const r = run(song, (s) => planSetVelocities(s, T, K, ["0:60", "480:64"], 0.5));
    expect(notesOf(r.song).map((x) => x.velocity)).toEqual([0.5, 0.5]);
    expect(notesOf(r.song)[1]).toBe(notesOf(song)[1]);
  });

  it("setVelocities는 planSetVelocities(...).song", () => {
    const song = base();
    expect(setVelocities(song, T, K, ["0:60"], 0.5)).toEqual(
      planSetVelocities(song, T, K, ["0:60"], 0.5).song,
    );
  });
});

describe("selectNotesInBox", () => {
  it("{400,500,60,64} → A, B", () => {
    expect(
      selectNotesInBox(base(), T, K, { startTick: 400, endTick: 500, loPitch: 60, hiPitch: 64 }),
    ).toEqual(["0:60", "480:64"]);
  });

  it("{480,480,0,127}: 폭 0 → []", () => {
    expect(
      selectNotesInBox(base(), T, K, { startTick: 480, endTick: 480, loPitch: 0, hiPitch: 127 }),
    ).toEqual([]);
  });

  it("전체 박스는 음 배열 순서, NaN이 있으면 []", () => {
    const song = base();
    expect(
      selectNotesInBox(song, T, K, { startTick: 0, endTick: 7680, loPitch: 0, hiPitch: 127 }),
    ).toEqual(["0:60", "480:64", "480:67", "960:60"]);
    for (const box of [
      { startTick: Number.NaN, endTick: 7680, loPitch: 0, hiPitch: 127 },
      { startTick: 0, endTick: Number.NaN, loPitch: 0, hiPitch: 127 },
      { startTick: 0, endTick: 7680, loPitch: Number.NaN, hiPitch: 127 },
      { startTick: 0, endTick: 7680, loPitch: 0, hiPitch: Number.NaN },
    ]) {
      expect(selectNotesInBox(song, T, K, box)).toEqual([]);
    }
  });
});

describe("bakeClipToNotes", () => {
  it("piano-block(0~1920, C): notes 본문, pitch {60,64,67}, expandSong 동치", () => {
    const song = songWithPatterns({
      bars: 4,
      tracks: [
        {
          id: T,
          instrument: "piano",
          clips: [{ id: K, start: 0, length: 1920, pattern: "piano-block" }],
        },
      ],
    });
    const snapshot = structuredClone(song);
    const baked = bakeClipToNotes(song, T, K);
    expectValidAndInputUntouched(song, snapshot, baked);
    const clip = baked.tracks[0].clips[0];
    expect(clip).toMatchObject({ id: K, start: 0, length: 1920 });
    expect(clip.body.type).toBe("notes");
    expect(new Set((clip.body as NotesBody).notes.map((x) => x.pitch))).toEqual(
      new Set([60, 64, 67]),
    );
    expect(expandSong(baked)).toEqual(expandSong(song));
  });

  it("마디 중간 코드 변경(C 0~960 / G 960~)이 있는 piano-arpeggio-8th: 동치", () => {
    const G = { root: 7, quality: "maj" as const };
    const progression: ChordSegment[] = [
      { start: 0, length: 960, chord: { root: 0, quality: "maj" } },
      { start: 960, length: 2880, chord: G },
      { start: 3840, length: 3840, chord: { root: 9, quality: "min" } },
    ];
    const song = songWithPatterns({
      bars: 4,
      progression,
      tracks: [
        {
          id: T,
          instrument: "piano",
          clips: [
            { id: K, start: 0, length: 1920, pattern: "piano-arpeggio-8th" },
            // 클립 시작이 0이 아니고 안에서 코드가 바뀐다(G → Am at 3840).
            { id: "clip-2", start: 2880, length: 1920, pattern: "piano-arpeggio-8th" },
          ],
        },
      ],
    });
    let baked = bakeClipToNotes(song, T, K);
    baked = bakeClipToNotes(baked, T, "clip-2");
    expect(validateSong(baked)).toEqual([]);
    expect(baked.tracks[0].clips.every((c) => c.body.type === "notes")).toBe(true);
    expect(expandSong(baked)).toEqual(expandSong(song));
  });

  it("드럼·기타·베이스도 굽는다(동치)", () => {
    const song = songWithPatterns({
      bars: 4,
      tracks: [
        {
          id: "d",
          instrument: "drums",
          clips: [{ id: K, start: 960, length: 2880, pattern: "drum-basic-rock" }],
        },
        {
          id: "g",
          instrument: "guitar",
          clips: [{ id: K, start: 0, length: 1000, pattern: "guitar-strum-quarter" }],
        },
        {
          id: "b",
          instrument: "bass",
          clips: [{ id: K, start: 1920, length: 3840, pattern: "bass-root-fifth" }],
        },
      ],
    });
    let baked = song;
    for (const id of ["d", "g", "b"]) baked = bakeClipToNotes(baked, id, K);
    expect(validateSong(baked)).toEqual([]);
    expect(expandSong(baked)).toEqual(expandSong(song));
  });

  it("notes 클립: no-op(같은 참조)", () => {
    const song = base();
    expect(bakeClipToNotes(song, T, K)).toBe(song);
  });
});

describe("emptyNotesClip", () => {
  it("패턴 클립 → 같은 id·start·length, notes [], 다른 클립·트랙은 같은 참조", () => {
    const song = songWithPatterns({
      bars: 4,
      tracks: [
        {
          id: T,
          instrument: "piano",
          clips: [
            { id: K, start: 0, length: 1920, pattern: "piano-block" },
            { id: "clip-2", start: 1920, length: 960, pattern: "piano-block" },
          ],
        },
        {
          id: "d",
          instrument: "drums",
          clips: [{ id: K, start: 0, length: 1920, pattern: "drum-basic-rock" }],
        },
      ],
    });
    const snapshot = structuredClone(song);
    const r = emptyNotesClip(song, T, "clip-2");
    expectValidAndInputUntouched(song, snapshot, r);
    expect(r.tracks[0].clips[1]).toEqual({
      id: "clip-2",
      start: 1920,
      length: 960,
      body: { type: "notes", notes: [] },
    });
    expect(r.tracks[0].clips[0]).toBe(song.tracks[0].clips[0]);
    expect(r.tracks[1]).toBe(song.tracks[1]);
  });

  it("notes 클립: no-op(같은 참조)", () => {
    const song = base();
    expect(emptyNotesClip(song, T, K)).toBe(song);
  });
});

describe("addEmptyNotesClip", () => {
  const gap = () =>
    songWithPatterns({
      bars: 4,
      tracks: [
        {
          id: T,
          instrument: "piano",
          clips: [
            { id: "clip-1", start: 0, length: 1920, pattern: "piano-block" },
          ],
        },
        {
          id: "d",
          instrument: "drums",
          clips: [
            { id: "drum-1", start: 0, length: 1920, pattern: "drum-basic-rock" },
          ],
        },
      ],
    });

  it("빈 칸: addClip과 같은 자리·길이의 빈 음 클립을 한 번에 만든다", () => {
    const song = gap();
    const snapshot = structuredClone(song);
    const r = addEmptyNotesClip(song, T, 3000);
    expectValidAndInputUntouched(song, snapshot, r);
    // 3000틱이 든 반마디 칸(2880)에 기본 1마디(1920) — 곡 끝(7680)까지 여유 있음.
    expect(r.tracks[0].clips).toHaveLength(2);
    expect(r.tracks[0].clips[1]).toEqual({
      id: "clip-2",
      start: 2880,
      length: 1920,
      body: { type: "notes", notes: [] },
    });
    expect(r.tracks[0].clips[0]).toBe(song.tracks[0].clips[0]);
    expect(r.tracks[1]).toBe(song.tracks[1]);
  });

  it("addClip + emptyNotesClip 합성과 결과가 같다", () => {
    const song = gap();
    const added = addClip(song, T, 3000);
    const id = added.tracks[0].clips.find((c) => c.id === "clip-2")!.id;
    expect(addEmptyNotesClip(song, T, 3000)).toEqual(
      emptyNotesClip(added, T, id),
    );
  });

  it("자리가 없으면(이미 클립 위) 같은 참조", () => {
    const song = gap();
    expect(addEmptyNotesClip(song, T, 100)).toBe(song);
  });

  it("곡 끝 뒤·음수·NaN은 같은 참조", () => {
    const song = gap();
    expect(addEmptyNotesClip(song, T, 99999)).toBe(song);
    expect(addEmptyNotesClip(song, T, -5)).toBe(song);
    expect(addEmptyNotesClip(song, T, Number.NaN)).toBe(song);
  });

  it("드럼 트랙은 Error(자리가 있어도)", () => {
    expect(() => addEmptyNotesClip(gap(), "d", 3000)).toThrow(Error);
  });

  it("없는 트랙은 Error", () => {
    expect(() => addEmptyNotesClip(gap(), "nope", 3000)).toThrow(Error);
  });
});

// ---------------------------------------------------------------------------
// 속성 테스트
// ---------------------------------------------------------------------------

/** 클립의 음이 편집 규칙을 지키는지: 정렬, 클립 안, 같은 음높이 겹침 없음, 세기 범위. */
function ruleViolation(notes: readonly Note[], clipLength: number): string | null {
  // 같은 음높이끼리: start 순으로 보면 앞 음의 끝 ≤ 다음 음의 시작.
  const lastEnd = new Map<number, number>();
  for (let i = 0; i < notes.length; i++) {
    const x = notes[i];
    const at = `notes[${i}] ${JSON.stringify(x)}`;
    if (i > 0 && x.start < notes[i - 1].start) return `${at} 정렬 안 됨`;
    if (x.start < 0 || x.start + x.length > clipLength) return `${at} 클립 밖`;
    if (!(x.velocity >= MIN_VELOCITY && x.velocity <= 1)) return `${at} 세기`;
    const end = lastEnd.get(x.pitch);
    if (end !== undefined && x.start < end) return `${at} 같은 음높이 겹침`;
    lastEnd.set(x.pitch, x.start + x.length);
  }
  return null;
}

const OPS = [
  "add",
  "move",
  "resize",
  "remove",
  "velocity",
  "box",
  "bake",
  "empty",
] as const;
type Op = (typeof OPS)[number];
const UNITS = Object.keys(GRID_UNITS) as GridUnit[];

function propertySongs(): Song[] {
  // 빈 음 클립 곡: 화음 트랙 셋 + 드럼, 패턴 클립을 섞는다.
  const withPatterns = songWithPatterns({
    bars: 4,
    tracks: [
      {
        id: "t-piano",
        instrument: "piano",
        clips: [
          { id: "clip-1", start: 0, length: 1920, pattern: "piano-arpeggio-8th" },
          { id: "clip-2", start: 1920, length: 3840, pattern: "piano-block" },
        ],
      },
      {
        id: "t-guitar",
        instrument: "guitar",
        clips: [{ id: "clip-1", start: 960, length: 2880, pattern: "guitar-strum-quarter" }],
      },
      {
        id: "t-bass",
        instrument: "bass",
        clips: [{ id: "clip-1", start: 0, length: 7680, pattern: "bass-root-fifth" }],
      },
      {
        id: "t-drums",
        instrument: "drums",
        clips: [{ id: "clip-1", start: 0, length: 1920, pattern: "drum-basic-rock" }],
      },
    ],
    progression: [
      { start: 0, length: 960, chord: { root: 0, quality: "maj" } },
      { start: 960, length: 2880, chord: { root: 7, quality: "dom7" } },
      { start: 3840, length: 3840, chord: { root: 9, quality: "min7" } },
    ],
  });
  let emptied = withPatterns;
  emptied = emptyNotesClip(emptied, "t-piano", "clip-2");
  emptied = emptyNotesClip(emptied, "t-guitar", "clip-1");
  let baked = withPatterns;
  baked = bakeClipToNotes(baked, "t-piano", "clip-1");
  baked = bakeClipToNotes(baked, "t-bass", "clip-1");
  baked = bakeClipToNotes(baked, "t-drums", "clip-1");
  return [emptied, baked];
}

function runProperty(
  initial: Song,
  seedBase: number,
  checkRules: boolean,
  counters: { changed: Map<Op, number>; unchanged: Map<Op, number>; thrown: Map<Op, number> },
) {
  const bump = (m: Map<Op, number>, op: Op) => m.set(op, (m.get(op) ?? 0) + 1);
  for (let seed = 1; seed <= 20; seed++) {
    const rand = mulberry32(seed * 7919 + seedBase);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
    const weird = () =>
      pick([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5]);
    let song = initial;

    for (let step = 0; step < 300; step++) {
      const prev = song;
      // JSON 문자열 비교: 유효한 곡에는 NaN·Infinity·undefined가 없어 손실이 없고, 깊은 toEqual보다 빠르다.
      const prevJson = JSON.stringify(prev);
      const op = pick(OPS);

      const trackId = rand() < 0.05 ? "nope" : pick(prev.tracks).id;
      const track = prev.tracks.find((t) => t.id === trackId);
      const clipId =
        rand() < 0.05 || !track || track.clips.length === 0
          ? pick(["nope", "clip-1"])
          : pick(track.clips).id;
      const clip = track?.clips.find((c) => c.id === clipId);
      const existing = clip?.body.type === "notes" ? clip.body.notes : [];
      const unit = pick(UNITS);
      const keys: NoteKey[] = [];
      const keyCount = int(0, 4);
      for (let i = 0; i < keyCount; i++) {
        keys.push(
          existing.length > 0 && rand() < 0.85
            ? noteKey(pick(existing))
            : `${int(0, 8000)}:${int(20, 100)}`,
        );
      }
      const tick = () =>
        rand() < 0.05 ? weird() : rand() < 0.5 ? int(-4, 4) * GRID_UNITS[unit] : int(-2000, 9000);

      let mustThrow = !track || !clip;
      if (!mustThrow && op !== "bake" && op !== "empty") {
        mustThrow = track!.instrument === "drums" || clip!.body.type !== "notes";
      }

      let next: Song | undefined;
      let planKeys: NoteKey[] | undefined;
      let error: unknown;
      try {
        switch (op) {
          case "add": {
            const r = planAddNote(
              prev,
              trackId,
              clipId,
              {
                start: tick(),
                pitch: rand() < 0.05 ? weird() : int(20, 105),
                length: rand() < 0.4 ? undefined : rand() < 0.05 ? weird() : int(-100, 4000),
                velocity: rand() < 0.4 ? undefined : rand() < 0.05 ? weird() : rand() * 1.4 - 0.2,
              },
              unit,
            );
            next = r.song;
            planKeys = r.keys;
            break;
          }
          case "move": {
            const r = planMoveNotes(
              prev,
              trackId,
              clipId,
              keys,
              tick(),
              rand() < 0.05 ? weird() : int(-6, 6),
              unit,
            );
            next = r.song;
            planKeys = r.keys;
            break;
          }
          case "resize": {
            const r = planResizeNotes(prev, trackId, clipId, keys, tick(), unit);
            next = r.song;
            planKeys = r.keys;
            break;
          }
          case "remove": {
            const r = planRemoveNotes(prev, trackId, clipId, keys);
            next = r.song;
            planKeys = r.keys;
            break;
          }
          case "velocity": {
            const r = planSetVelocities(
              prev,
              trackId,
              clipId,
              keys,
              rand() < 0.05 ? weird() : pick([0.8, 0.5, rand() * 1.4 - 0.2]),
            );
            next = r.song;
            planKeys = r.keys;
            break;
          }
          case "box": {
            const s = tick();
            const box = {
              startTick: s,
              endTick: s + int(0, 3000),
              loPitch: int(20, 90),
              hiPitch: int(40, 110),
            };
            const selected = selectNotesInBox(prev, trackId, clipId, box);
            const present = new Set(existing.map(noteKey));
            expect(selected.filter((k) => !present.has(k))).toEqual([]);
            next = prev;
            break;
          }
          case "bake":
            next = bakeClipToNotes(prev, trackId, clipId);
            break;
          case "empty":
            next = emptyNotesClip(prev, trackId, clipId);
            break;
        }
      } catch (e) {
        error = e;
      }

      expect(JSON.stringify(prev) === prevJson, `${op} 입력 변형`).toBe(true);
      if (error !== undefined) {
        bump(counters.thrown, op);
        expect(mustThrow, `${op} 예상 못 한 오류: ${String(error)}`).toBe(true);
        expect((error as Error).constructor).toBe(Error);
        continue;
      }
      expect(mustThrow, `${op} 던져야 했다`).toBe(false);

      song = next as Song;
      expect(validateSong(song)).toEqual([]);

      if (checkRules) {
        for (const t of song.tracks) {
          for (const c of t.clips) {
            if (c.body.type === "notes") {
              expect(ruleViolation(c.body.notes, c.length), `${op} ${t.id}/${c.id}`).toBeNull();
            }
          }
        }
      }

      // 돌려준 키는 결과 클립에 실제로 있는 음이다.
      if (planKeys && planKeys.length > 0) {
        const afterTrack = song.tracks.find((t) => t.id === trackId)!;
        const after = afterTrack.clips.find((c) => c.id === clipId)!;
        const afterNotes = (after.body as NotesBody).notes;
        const present = new Set(afterNotes.map(noteKey));
        expect(planKeys.filter((k) => !present.has(k)), `${op} 결과에 없는 키`).toEqual([]);
        expect(new Set(planKeys).size).toBe(planKeys.length);
      }

      if (song === prev) {
        bump(counters.unchanged, op);
        expect(JSON.stringify(song) === prevJson).toBe(true);
      } else {
        bump(counters.changed, op);
        expect(JSON.stringify(song) === prevJson, `${op} 바뀌었다면서 내용이 같다`).toBe(false);
      }
    }
  }
}

describe("속성: 무작위 음 편집 열", () => {
  it("시드 20개 x 연산 300번(빈 음 클립 곡·패턴을 구운 곡): 매번 유효·규칙 준수·입력 불변·허용된 Error만", () => {
    const counters = {
      changed: new Map<Op, number>(),
      unchanged: new Map<Op, number>(),
      thrown: new Map<Op, number>(),
    };
    const [emptied, baked] = propertySongs();
    runProperty(emptied, 0, true, counters);
    runProperty(baked, 1, true, counters);

    for (const op of OPS) {
      if (op !== "box") {
        expect(counters.changed.get(op) ?? 0, `${op} 바뀜 경로`).toBeGreaterThan(0);
      }
      expect(counters.unchanged.get(op) ?? 0, `${op} no-op 경로`).toBeGreaterThan(0);
      expect(counters.thrown.get(op) ?? 0, `${op} 오류 경로`).toBeGreaterThan(0);
    }
  }, 30_000);

  it("손으로 고친 곡(같은 음높이 겹침·중복 (start,pitch)·격자보다 짧은 음): validateSong과 입력 불변만", () => {
    const counters = {
      changed: new Map<Op, number>(),
      unchanged: new Map<Op, number>(),
      thrown: new Map<Op, number>(),
    };
    const messy = base([
      n(0, 1000, 60),
      n(0, 300, 60),
      n(240, 960, 60),
      n(480, 7, 64),
      n(480, 2000, 64, 0),
      n(7000, 680, 120, 1),
    ]);
    runProperty(messy, 2, false, counters);
    expect(counters.changed.get("move") ?? 0).toBeGreaterThan(0);
    expect(counters.changed.get("resize") ?? 0).toBeGreaterThan(0);
  }, 30_000);
});

describe("snapTickDelta", () => {
  it("변화량을 가장 가까운 칸으로 반올림한다(이동·길이 계획이 쓰는 같은 규칙)", () => {
    expect(snapTickDelta(0, "1/8")).toBe(0);
    expect(snapTickDelta(119, "1/8")).toBe(0);
    expect(snapTickDelta(120, "1/8")).toBe(240);
    expect(snapTickDelta(-119, "1/8")).toBe(0);
    expect(snapTickDelta(-121, "1/8")).toBe(-240);
    expect(snapTickDelta(700, "1/4")).toBe(480);
    expect(snapTickDelta(61, "1/16")).toBe(120);
  });

  it("-0을 남기지 않고 NaN은 NaN이다", () => {
    expect(Object.is(snapTickDelta(-100, "1/8"), 0)).toBe(true);
    expect(snapTickDelta(Number.NaN, "1/8")).toBeNaN();
  });

  it("0으로 스냅되는 변화량이면 이동·길이 계획은 같은 참조다", () => {
    const song = songWithNotes({ notes: [{ start: 0, length: 480, pitch: 60, velocity: 0.8 }] });
    const t = song.tracks[0];
    const c = t.clips[0];
    const k = [noteKey({ start: 0, pitch: 60 })];
    expect(snapTickDelta(100, "1/8")).toBe(0);
    expect(planMoveNotes(song, t.id, c.id, k, 100, 0, "1/8").song).toBe(song);
    expect(planResizeNotes(song, t.id, c.id, k, 100, "1/8").song).toBe(song);
  });
});
