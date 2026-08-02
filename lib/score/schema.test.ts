import { describe, expect, it } from "vitest";

import { MIN_TILE_LENGTH } from "@/lib/score/edit";
import { FILE_FORMAT, FILE_VERSION, SongFileSchema } from "@/lib/score/schema";
import { buildDemoSong } from "@/lib/score/fixture";

/** 유효한 파일 하나. 각 테스트가 필요한 부분만 덮어쓴다. */
function validFile() {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    song: buildDemoSong(),
  };
}

describe("상수", () => {
  it("형식 이름과 버전은 고정값이다", () => {
    expect(FILE_FORMAT).toBe("bandline-song");
    expect(FILE_VERSION).toBe(1);
  });
});

describe("SongFileSchema — 통과", () => {
  it("데모 곡을 그대로 통과시킨다", () => {
    const result = SongFileSchema.safeParse(validFile());
    expect(result.success).toBe(true);
  });

  it("겹치는 타일을 거부하지 않는다", () => {
    const file = validFile();
    const line = file.song.lines[0];
    line.tiles = [
      { id: "a", start: 0, length: 960, velocity: 0.7, notes: [60] },
      { id: "b", start: 480, length: 960, velocity: 0.7, notes: [64] },
    ];

    expect(SongFileSchema.safeParse(file).success).toBe(true);
  });
});

describe("SongFileSchema — 거부", () => {
  it("format이 다르면 거부한다", () => {
    const file = { ...validFile(), format: "something-else" };
    expect(SongFileSchema.safeParse(file).success).toBe(false);
  });

  it("version이 1보다 크면 거부한다", () => {
    const file = { ...validFile(), version: 2 };
    expect(SongFileSchema.safeParse(file).success).toBe(false);
  });

  it("version이 1보다 작아도 거부한다", () => {
    const file = { ...validFile(), version: 0 };
    expect(SongFileSchema.safeParse(file).success).toBe(false);
  });

  it("lines가 비어 있으면 거부한다", () => {
    const file = validFile();
    file.song.lines = [];
    expect(SongFileSchema.safeParse(file).success).toBe(false);
  });

  it("instrument가 4종 밖이면 거부한다", () => {
    const file = validFile();
    // 엔진에 없는 악기다. 통과시키면 그 라인만 조용히 무음이 된다.
    (file.song.lines[0] as { instrument: string }).instrument = "theremin";
    expect(SongFileSchema.safeParse(file).success).toBe(false);
  });

  it("kind가 두 종류 밖이면 거부한다", () => {
    const file = validFile();
    (file.song.lines[0] as { kind: string }).kind = "wobble";
    expect(SongFileSchema.safeParse(file).success).toBe(false);
  });

  it("notes가 빈 배열이면 거부한다", () => {
    const file = validFile();
    file.song.lines[0].tiles[0].notes = [];
    expect(SongFileSchema.safeParse(file).success).toBe(false);
  });

  it("notes 값이 MIDI 범위 밖이면 거부한다", () => {
    // 세기는 클램프해도 소리 크기만 달라지지만, 음높이를 클램프하면
    // 곡이 조용히 다른 곡이 된다. 여기만은 고치지 않는다.
    const over = validFile();
    over.song.lines[0].tiles[0].notes = [128];
    expect(SongFileSchema.safeParse(over).success).toBe(false);

    const under = validFile();
    under.song.lines[0].tiles[0].notes = [-1];
    expect(SongFileSchema.safeParse(under).success).toBe(false);
  });

  it("lengthTicks가 최소 타일 길이보다 작으면 거부한다", () => {
    const file = validFile();
    file.song.lengthTicks = MIN_TILE_LENGTH - 1;
    expect(SongFileSchema.safeParse(file).success).toBe(false);
  });

  it("라인 id가 중복되면 거부한다", () => {
    const file = validFile();
    file.song.lines[1].id = file.song.lines[0].id;
    expect(SongFileSchema.safeParse(file).success).toBe(false);
  });

  it("한 라인 안에서 타일 id가 중복되면 거부한다", () => {
    const file = validFile();
    const line = file.song.lines[0];
    line.tiles = [
      { id: "dup", start: 0, length: 480, velocity: 0.7, notes: [60] },
      { id: "dup", start: 480, length: 480, velocity: 0.7, notes: [64] },
    ];
    expect(SongFileSchema.safeParse(file).success).toBe(false);
  });

  it("라인이 달라 타일 id가 겹치는 것은 허용한다", () => {
    // 곡 전체 유일성은 요구하지 않는다. edit.ts가 라인까지 확인한다.
    const file = validFile();
    file.song.lines[0].tiles = [
      { id: "same", start: 0, length: 480, velocity: 0.7, notes: [60] },
    ];
    file.song.lines[1].tiles = [
      { id: "same", start: 0, length: 480, velocity: 0.7, notes: [62] },
    ];
    expect(SongFileSchema.safeParse(file).success).toBe(true);
  });

  it("필드가 없으면 거부한다", () => {
    expect(SongFileSchema.safeParse({}).success).toBe(false);
    expect(SongFileSchema.safeParse(null).success).toBe(false);
  });

  it("NaN과 Infinity를 거부한다", () => {
    const nan = validFile();
    nan.song.lines[0].tiles[0].start = Number.NaN;
    expect(SongFileSchema.safeParse(nan).success).toBe(false);

    const inf = validFile();
    inf.song.lines[0].tiles[0].length = Number.POSITIVE_INFINITY;
    expect(SongFileSchema.safeParse(inf).success).toBe(false);
  });
});

describe("SongFileSchema — 값 단위 복구", () => {
  it("velocity를 0..1로 클램프한다", () => {
    const file = validFile();
    file.song.lines[0].tiles[0].velocity = 1.5;
    const result = SongFileSchema.safeParse(file);

    expect(result.success).toBe(true);
    expect(result.data!.song.lines[0].tiles[0].velocity).toBe(1);
  });

  it("음수 velocity도 클램프한다", () => {
    const file = validFile();
    file.song.lines[0].tiles[0].velocity = -0.5;
    const result = SongFileSchema.safeParse(file);

    expect(result.data!.song.lines[0].tiles[0].velocity).toBe(0);
  });

  it("비정수 틱을 반올림한다", () => {
    const file = validFile();
    file.song.lines[0].tiles[0].start = 480.6;
    file.song.lines[0].tiles[0].length = 479.4;
    const result = SongFileSchema.safeParse(file);

    expect(result.data!.song.lines[0].tiles[0].start).toBe(481);
    expect(result.data!.song.lines[0].tiles[0].length).toBe(479);
  });

  it("tempo를 40..240으로 클램프하고 반올림한다", () => {
    const fast = validFile();
    fast.song.tempo = 999;
    expect(SongFileSchema.safeParse(fast).data!.song.tempo).toBe(240);

    const slow = validFile();
    slow.song.tempo = 1;
    expect(SongFileSchema.safeParse(slow).data!.song.tempo).toBe(40);

    const fractional = validFile();
    fractional.song.tempo = 120.7;
    expect(SongFileSchema.safeParse(fractional).data!.song.tempo).toBe(121);
  });
});
