import { describe, expect, it } from "vitest";

import { MIN_TILE_LENGTH, addTile } from "@/lib/score/edit";
import { buildDemoSong } from "@/lib/score/fixture";
import { FILE_FORMAT, FILE_VERSION } from "@/lib/score/schema";
import { parseSong, serializeSong } from "@/lib/score/serialize";
import type { Song } from "@/lib/score/types";

/** 파일 텍스트를 만들되 song 부분만 바꿔 끼운다. */
function fileText(song: unknown): string {
  return JSON.stringify({
    format: FILE_FORMAT,
    version: FILE_VERSION,
    song,
  });
}

describe("serializeSong", () => {
  it("봉투를 씌운다", () => {
    const parsed = JSON.parse(serializeSong(buildDemoSong()));

    expect(parsed.format).toBe(FILE_FORMAT);
    expect(parsed.version).toBe(FILE_VERSION);
    expect(parsed.song.lines.length).toBeGreaterThan(0);
  });

  it("사람이 읽을 수 있게 들여쓴다", () => {
    expect(serializeSong(buildDemoSong())).toContain("\n");
  });
});

describe("왕복", () => {
  it("데모 곡이 값 그대로 돌아온다", () => {
    const original = buildDemoSong();
    const result = parseSong(serializeSong(original));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song).toEqual(original);
  });

  it("편집한 곡도 값 그대로 돌아온다", () => {
    const edited = addTile(buildDemoSong(), "piano", 1920);
    const result = parseSong(serializeSong(edited));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song).toEqual(edited);
  });
});

describe("거부", () => {
  it("JSON이 아니면 거부한다", () => {
    const result = parseSong("이건 JSON이 아니다");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("JSON 파일이 아닙니다.");
  });

  it("빈 문자열도 거부한다", () => {
    expect(parseSong("").ok).toBe(false);
  });

  it("format이 다르면 우리 파일이 아니라고 말한다", () => {
    const text = JSON.stringify({ name: "bandline", version: 1 });
    const result = parseSong(text);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("Bandline 곡 파일이 아닙니다.");
  });

  it("version이 더 크면 새 버전 파일이라고 말한다", () => {
    const text = JSON.stringify({
      format: FILE_FORMAT,
      version: 2,
      song: buildDemoSong(),
    });
    const result = parseSong(text);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("더 새로운 버전에서 만든 파일입니다.");
  });

  it("스키마 위반은 손상됐다고 말하고 경로를 붙인다", () => {
    const song = buildDemoSong();
    song.lines[0].tiles[0].notes = [];
    const result = parseSong(fileText(song));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("파일이 손상되었습니다");
    // song. 접두사는 벗기고 배열은 대괄호로 쓴다
    expect(result.reason).toContain("lines[0].tiles[0].notes");
  });

  it("어떤 입력에도 예외를 던지지 않는다", () => {
    const inputs = ["", "null", "[]", "{}", "0", '"문자열"', "{unclosed"];
    for (const input of inputs) {
      expect(() => parseSong(input)).not.toThrow();
      expect(parseSong(input).ok).toBe(false);
    }
  });
});

describe("복구", () => {
  it("뒤섞인 타일을 start 오름차순으로 정렬한다", () => {
    const song = buildDemoSong();
    song.lines[0].tiles = [
      { id: "c", start: 960, length: 480, velocity: 0.7, notes: [67] },
      { id: "a", start: 0, length: 480, velocity: 0.7, notes: [60] },
      { id: "b", start: 480, length: 480, velocity: 0.7, notes: [64] },
    ];
    const result = parseSong(fileText(song));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.lines[0].tiles.map((t) => t.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("곡 밖으로 나간 타일을 경계 안으로 당긴다", () => {
    const song = buildDemoSong();
    const end = song.lengthTicks;
    song.lines[0].tiles = [
      { id: "over", start: end + 5000, length: 480, velocity: 0.7, notes: [60] },
    ];
    const result = parseSong(fileText(song));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tile = result.song.lines[0].tiles[0];
    expect(tile.start + tile.length).toBeLessThanOrEqual(end);
  });

  it("음수 start를 0으로 올린다", () => {
    const song = buildDemoSong();
    song.lines[0].tiles = [
      { id: "neg", start: -500, length: 480, velocity: 0.7, notes: [60] },
    ];
    const result = parseSong(fileText(song));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.lines[0].tiles[0].start).toBe(0);
  });

  it("너무 짧은 타일을 최소 길이로 올린다", () => {
    const song = buildDemoSong();
    song.lines[0].tiles = [
      { id: "tiny", start: 0, length: 30, velocity: 0.7, notes: [60] },
    ];
    const result = parseSong(fileText(song));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.lines[0].tiles[0].length).toBe(MIN_TILE_LENGTH);
  });

  it("곡 맨 끝에 붙은 타일도 최소 길이를 확보한다", () => {
    // start를 먼저 당겨두지 않으면 length 상한이 20이 되어 최소 길이를
    // 만족할 수 없다. 3단계 순서가 실제로 지켜지는지 보는 케이스다.
    const song = buildDemoSong();
    const end = song.lengthTicks;
    song.lines[0].tiles = [
      { id: "edge", start: end - 20, length: 480, velocity: 0.7, notes: [60] },
    ];
    const result = parseSong(fileText(song));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tile = result.song.lines[0].tiles[0];
    expect(tile.length).toBeGreaterThanOrEqual(MIN_TILE_LENGTH);
    expect(tile.start).toBe(end - MIN_TILE_LENGTH);
    expect(tile.start + tile.length).toBeLessThanOrEqual(end);
  });

  it("복구한 곡은 편집 함수에 넣어도 정렬 불변식이 유지된다", () => {
    const song = buildDemoSong();
    song.lines[0].tiles = [
      { id: "c", start: 960, length: 480, velocity: 0.7, notes: [67] },
      { id: "a", start: 0, length: 480, velocity: 0.7, notes: [60] },
    ];
    const result = parseSong(fileText(song));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const edited = addTile(result.song, result.song.lines[0].id, 480);
    const starts = edited.lines[0].tiles.map((t) => t.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("겹치는 타일은 그대로 둔다", () => {
    // 겹침은 버그가 아니라 기능이다 — 화음 안의 음마다 길이·세기를
    // 다르게 주는 탈출구다.
    const song = buildDemoSong();
    song.lines[0].tiles = [
      { id: "a", start: 0, length: 960, velocity: 0.7, notes: [60] },
      { id: "b", start: 480, length: 960, velocity: 0.7, notes: [64] },
    ];
    const result = parseSong(fileText(song));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.lines[0].tiles).toHaveLength(2);
    expect(result.song.lines[0].tiles[0].length).toBe(960);
  });

  it("원본 객체를 변형하지 않는다", () => {
    const song: Song = buildDemoSong();
    song.lines[0].tiles = [
      { id: "b", start: 480, length: 480, velocity: 0.7, notes: [64] },
      { id: "a", start: 0, length: 480, velocity: 0.7, notes: [60] },
    ];
    const snapshot = JSON.parse(JSON.stringify(song));
    parseSong(fileText(song));

    expect(song).toEqual(snapshot);
  });
});
