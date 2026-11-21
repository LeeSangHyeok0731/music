import { describe, expect, it } from "vitest";

import { AUTOSAVE_KEY, loadSong, serializeSong } from "@/lib/score/autosave";
import { buildDemoSong } from "@/lib/score/demo-song";
import type { Song } from "@/lib/score/model";
import { parseSong } from "@/lib/score/song-schema";
import { songWithNotes, songWithPatterns } from "@/lib/score/testing/builders";
import { validateSong } from "@/lib/score/validate";

const UNREADABLE = "저장된 곡을 읽지 못해 데모 곡으로 시작합니다";
const REPAIRED_PREFIX = "저장된 곡을 고쳐서 열었습니다: ";

describe("AUTOSAVE_KEY", () => {
  it("v3 키다", () => {
    expect(AUTOSAVE_KEY).toBe("bandline:song:v3");
  });
});

describe("loadSong — 저장된 것이 없을 때", () => {
  it.each([
    ["null", null],
    ["빈 문자열", ""],
    ["공백만", "  \n\t "],
  ])("%s 이면 안내 없이 데모 곡이다", (_label, raw) => {
    const result = loadSong(raw);
    expect(result.notice).toBeNull();
    expect(result.song).toEqual(buildDemoSong());
  });

  it("매번 새 데모 곡을 돌려준다(공유되는 객체가 아니다)", () => {
    const a = loadSong(null).song;
    const b = loadSong(null).song;
    expect(a).not.toBe(b);
    expect(a.tracks).not.toBe(b.tracks);
    a.tracks[0].clips = [];
    a.progression.length = 0;
    expect(loadSong(null).song).toEqual(buildDemoSong());
  });
});

describe("loadSong — 읽을 수 없을 때는 데모 곡과 한 줄 안내", () => {
  const v2Song = {
    v: 2,
    tempo: 120,
    timeSignature: [4, 4],
    bars: 1,
    tracks: [{ id: "t", instrument: "piano", clips: [] }],
    meta: { title: "옛 곡", editors: [] },
  };
  const v3WithoutProgression = (() => {
    const rest: Record<string, unknown> = { ...buildDemoSong() };
    delete rest.progression;
    return rest;
  })();

  it.each([
    ["깨진 JSON", "{"],
    ["null 리터럴", "null"],
    ["빈 배열", "[]"],
    ["숫자", "3"],
    ["문자열", '"곡"'],
    ["v2 곡", JSON.stringify(v2Song)],
    ["진행이 빠진 v3 곡", JSON.stringify(v3WithoutProgression)],
    ["진행이 곡을 덮지 못하는 v3 곡", JSON.stringify({ ...buildDemoSong(), progression: [] })],
  ])("%s", (_label, raw) => {
    const result = loadSong(raw);
    expect(result.song).toEqual(buildDemoSong());
    expect(result.notice).toBe(UNREADABLE);
  });

  it("거부된 곡의 일부를 쓰지 않는다 — 부분 결과가 아니라 데모 곡이다", () => {
    // 구조는 맞지만 진행이 곡 끝을 덮지 못해 불변식에서 거부되는 곡.
    const rejected: Song = {
      ...songWithNotes({
        notes: [{ start: 0, length: 480, pitch: 60, velocity: 0.8 }],
        bars: 2,
      }),
      meta: { title: "거부될 곡", editors: [] },
    };
    rejected.progression = [
      { start: 0, length: 1920, chord: { root: 0, quality: "maj" } },
    ];
    expect(validateSong(rejected)).not.toEqual([]);
    expect(parseSong(JSON.parse(JSON.stringify(rejected))).ok).toBe(false);

    const result = loadSong(JSON.stringify(rejected));
    expect(result.song.meta.title).toBe("데모 곡");
    expect(result.song).toEqual(buildDemoSong());
    expect(result.notice).toBe(UNREADABLE);
  });

  it("안내는 한 줄이다", () => {
    expect(UNREADABLE).not.toMatch(/\n/);
    expect(loadSong("{").notice).not.toMatch(/\n/);
  });
});

describe("loadSong — 어떤 문자열이 와도 던지지 않는다", () => {
  const weird: Array<[string, string]> = [
    ["아주 긴 문자열", "x".repeat(2_000_000)],
    ["여는 중괄호", "{"],
    ["NUL 문자", "\u0000"],
    ["이진처럼 보이는 글", "�\u0001\u0002\u0003\u007f\u0080ÿ"],
    ["짝 없는 서로게이트", '"\uD800"'],
    ["여는 대괄호 1만 개(미완성)", "[".repeat(10_000)],
    ["깊이 1만 중첩(완성)", "[".repeat(10_000) + "]".repeat(10_000)],
    ["깊이 1만 중첩 객체", '{"a":'.repeat(10_000) + "1" + "}".repeat(10_000)],
    ["__proto__ 키", '{"__proto__":{"v":3},"v":3}'],
    ["거대한 수", '{"v":3,"tempo":1e999,"bars":1e308}'],
    ["BOM", "﻿{}"],
  ];

  it.each(weird)("%s", (_label, raw) => {
    let result: ReturnType<typeof loadSong> | undefined;
    expect(() => {
      result = loadSong(raw);
    }).not.toThrow();
    expect(result?.song).toEqual(buildDemoSong());
    expect(result?.notice).toBe(UNREADABLE);
  });
});

describe("loadSong — 올바른 곡", () => {
  it("데모 곡은 왕복해도 같고 안내가 없다", () => {
    const song = buildDemoSong();
    const result = loadSong(serializeSong(song));
    expect(result.song).toEqual(song);
    expect(result.notice).toBeNull();
  });

  it("음 클립과 여러 구간 진행이 있는 곡도 왕복한다", () => {
    const patterns = songWithPatterns({
      tracks: [
        {
          id: "t-bass",
          instrument: "bass",
          clips: [{ id: "c-1", start: 0, length: 3840, pattern: "bass-root-quarter" }],
        },
      ],
      bars: 4,
      progression: [
        { start: 0, length: 1920, chord: { root: 0, quality: "maj" } },
        { start: 1920, length: 3840, chord: { root: 9, quality: "min" } },
        { start: 5760, length: 1920, chord: { root: 7, quality: "dom7" } },
      ],
    });
    const song: Song = {
      ...patterns,
      tracks: [
        ...patterns.tracks,
        ...songWithNotes({
          trackId: "t-piano",
          notes: [
            { start: 0, length: 480, pitch: 60, velocity: 0.8 },
            { start: 480, length: 960, pitch: 64, velocity: 0.5 },
          ],
          bars: 4,
        }).tracks,
      ],
    };
    expect(validateSong(song)).toEqual([]);
    expect(song.progression).toHaveLength(3);

    const result = loadSong(serializeSong(song));
    expect(result.song).toEqual(song);
    expect(result.notice).toBeNull();
  });

  it("serializeSong은 JSON.stringify와 같다", () => {
    const song = buildDemoSong();
    expect(serializeSong(song)).toBe(JSON.stringify(song));
  });

  it("복구 없이 열린 곡은 parseSong의 결과 그대로다", () => {
    const song = buildDemoSong();
    const parsed = parseSong(JSON.parse(serializeSong(song)));
    expect(parsed.ok).toBe(true);
    expect(loadSong(serializeSong(song)).song).toEqual(parsed.ok ? parsed.song : null);
  });
});

describe("loadSong — 복구가 필요한 곡", () => {
  it("소수 틱은 복구된 곡과 '고쳐서' 안내로 열린다", () => {
    const fractional = songWithNotes({
      notes: [{ start: 100.5, length: 240, pitch: 60, velocity: 0.8 }],
    });
    const raw = JSON.stringify(fractional);
    const parsed = parseSong(JSON.parse(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.repairs.length).toBeGreaterThan(0);

    const result = loadSong(raw);
    // loadSong은 parseSong이 돌려준 곡을 그대로 쓴다.
    expect(result.song).toEqual(parsed.song);
    expect(result.song).not.toEqual(buildDemoSong());
    expect(result.notice).toContain("고쳐서");
    expect(result.notice).toBe(REPAIRED_PREFIX + parsed.repairs.join("; "));

    const clip = result.song.tracks[0].clips[0];
    if (clip.body.type !== "notes") throw new Error("notes 클립이어야 한다");
    // Math.round(100.5) = 101, 끝 Math.round(340.5) = 341 → length 240
    expect(clip.body.notes[0].start).toBe(101);
    expect(validateSong(result.song)).toEqual([]);
  });

  it("보고가 여럿이면 '; '로 잇는다", () => {
    const song = songWithNotes({
      notes: [{ start: 100.5, length: 240, pitch: 60, velocity: 2 }],
      tempo: 120.4,
    });
    const parsed = parseSong(JSON.parse(JSON.stringify(song)));
    expect(parsed.ok && parsed.repairs.length).toBeGreaterThanOrEqual(2);
    const result = loadSong(JSON.stringify(song));
    expect(result.notice).toContain("; ");
    expect(result.notice).toBe(
      REPAIRED_PREFIX + (parsed.ok ? parsed.repairs.join("; ") : ""),
    );
  });

  it("안내가 200자를 넘으면 200자에서 자르고 …을 붙인다", () => {
    // 보고 문구를 최대한 길게 만든다: 긴 소수 템포 범위 보정 + 반올림 + velocity
    // + 자름 + 버림 + 정렬(음·진행).
    const base = songWithNotes({ notes: [], bars: 2 });
    const clip = base.tracks[0].clips[0];
    const song = {
      ...base,
      tempo: 987654321.123456789,
      progression: [
        { start: 1920, length: 1920, chord: { root: 7, quality: "maj" } },
        { start: 0, length: 1920.4, chord: { root: 0, quality: "maj" } },
      ],
      tracks: [
        {
          ...base.tracks[0],
          clips: [
            {
              ...clip,
              body: {
                type: "notes",
                notes: [
                  { start: 960, length: 240, pitch: 62, velocity: 3 },
                  { start: 0.5, length: 240, pitch: 60, velocity: 0.5 },
                  { start: 3000, length: 2000, pitch: 64, velocity: 0.5 },
                  { start: 9999, length: 10, pitch: 65, velocity: 0.5 },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(song);
    const parsed = parseSong(JSON.parse(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const full = REPAIRED_PREFIX + parsed.repairs.join("; ");
    expect(full.length).toBeGreaterThan(200); // 자를 이유가 있는 입력인지 확인

    const { song: loaded, notice } = loadSong(raw);
    expect(loaded).toEqual(parsed.song);
    expect(notice).not.toBeNull();
    expect(notice).toHaveLength(200);
    expect(notice?.endsWith("…")).toBe(true);
    expect(notice).toBe(full.slice(0, 199) + "…");
  });

  it("200자 이하 안내는 자르지 않는다", () => {
    const song = songWithNotes({
      notes: [{ start: 100.5, length: 240, pitch: 60, velocity: 0.8 }],
    });
    const { notice } = loadSong(JSON.stringify(song));
    expect(notice).not.toBeNull();
    expect(notice!.length).toBeLessThanOrEqual(200);
    expect(notice).not.toContain("…");
  });
});
