import { z } from "zod";

import {
  CHORD_QUALITIES,
  INSTRUMENT_IDS,
  MAX_TEMPO,
  MIN_TEMPO,
  SONG_VERSION,
  type Clip,
  type Song,
} from "./model";
import { validateSong } from "./validate";

/**
 * 구조만 본다. 숫자의 정수성·범위·정렬·겹침은 여기서 보지 않는다 — 복구할
 * 수 있는 것은 `repair`가 고치고, 나머지는 `validateSong`이 거부한다.
 *
 * zod 4의 `z.number()`는 NaN과 ±Infinity를 거부한다(zod 3은 Infinity를 통과시켰다).
 */
const noteSchema = z.object({
  start: z.number(),
  length: z.number(),
  pitch: z.number(),
  velocity: z.number(),
});

const chordSchema = z.object({
  root: z.number().int().min(0).max(11),
  quality: z.enum(CHORD_QUALITIES),
});

const bodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("chord"),
    chord: chordSchema,
    pattern: z.string().min(1),
  }),
  z.object({ type: z.literal("notes"), notes: z.array(noteSchema) }),
]);

const clipSchema = z.object({
  id: z.string().min(1),
  start: z.number(),
  length: z.number(),
  body: bodySchema,
});

const trackSchema = z.object({
  id: z.string().min(1),
  instrument: z.enum(INSTRUMENT_IDS),
  clips: z.array(clipSchema),
});

const authorSchema = z.object({
  name: z.string().min(1).max(50),
  publicKey: z.string().min(1).max(200),
});

const metaSchema = z.object({
  title: z.string().max(100),
  author: authorSchema.optional(),
  editors: z.array(authorSchema).max(20),
  signature: z.string().max(500).optional(),
});

const songSchema = z.object({
  v: z.literal(SONG_VERSION),
  tempo: z.number(),
  timeSignature: z.tuple([
    z.number().int().positive(),
    z.number().int().positive(),
  ]),
  bars: z.number(),
  tracks: z.array(trackSchema).min(1),
  meta: metaSchema,
});

export type ParseResult =
  | { ok: true; song: Song; repairs: string[] }
  | { ok: false; errors: string[] };

/**
 * 손으로 고친 파일이나 링크에서 온 값을 곡으로 바꾼다.
 *
 * 순서: 구조 검증(zod) → 복구 → 불변식 검증. 복구한 내용은 `repairs`로
 * 돌려줘 호출부가 사용자에게 알릴 수 있게 한다.
 */
export function parseSong(input: unknown): ParseResult {
  const parsed = songSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(루트)"}: ${issue.message}`,
      ),
    };
  }

  const repairs: string[] = [];
  const song = repair(parsed.data as Song, repairs);

  const issues = validateSong(song);
  if (issues.length > 0) {
    return {
      ok: false,
      errors: issues.map((issue) => `${issue.path}: ${issue.message}`),
    };
  }
  return { ok: true, song, repairs };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function repair(song: Song, repairs: string[]): Song {
  let rounded = 0;
  let clampedVelocity = 0;
  let trimmed = 0;
  let dropped = 0;
  let resorted = false;

  const round = (value: number): number => {
    const next = Math.round(value);
    if (next !== value) rounded += 1;
    return next;
  };

  const tempo = clamp(Math.round(song.tempo), MIN_TEMPO, MAX_TEMPO);
  if (tempo !== song.tempo) {
    repairs.push(`템포를 ${MIN_TEMPO}~${MAX_TEMPO} 범위로 고쳤습니다 (${song.tempo} → ${tempo})`);
  }

  const tracks = song.tracks.map((track) => {
    let clips: Clip[] = track.clips.map((clip) => {
      const start = round(clip.start);
      const length = round(clip.length);

      if (clip.body.type === "chord") {
        return { ...clip, start, length };
      }

      let notes = clip.body.notes.map((n) => {
        const velocity = clamp(n.velocity, 0, 1);
        if (velocity !== n.velocity) clampedVelocity += 1;
        return { ...n, start: round(n.start), length: round(n.length), velocity };
      });

      // 클립 길이가 올바를 때만 자르고 버린다. 길이가 틀린 클립은 거부로 넘어간다.
      if (length >= 1) {
        notes = notes.flatMap((n) => {
          if (n.start < 0 || n.start >= length) {
            dropped += 1;
            return [];
          }
          if (n.start + n.length > length) {
            trimmed += 1;
            return [{ ...n, length: length - n.start }];
          }
          return [n];
        });
      }

      const sorted = [...notes].sort((a, b) => a.start - b.start);
      if (sorted.some((n, i) => n !== notes[i])) resorted = true;

      // as const가 없으면 map 콜백의 반환 타입에서 type이 string으로 넓어질 수 있다.
      return {
        ...clip,
        start,
        length,
        body: { type: "notes" as const, notes: sorted },
      };
    });

    const sortedClips = [...clips].sort((a, b) => a.start - b.start);
    if (sortedClips.some((c, i) => c !== clips[i])) resorted = true;
    clips = sortedClips;

    return { ...track, clips };
  });

  if (rounded > 0) repairs.push(`소수 틱 ${rounded}개를 정수로 반올림했습니다`);
  if (clampedVelocity > 0) {
    repairs.push(`범위를 벗어난 velocity ${clampedVelocity}개를 0~1로 고쳤습니다`);
  }
  if (trimmed > 0) repairs.push(`클립 끝을 넘은 음 ${trimmed}개를 클립 끝에서 잘랐습니다`);
  if (dropped > 0) repairs.push(`클립 밖에서 시작하는 음 ${dropped}개를 버렸습니다`);
  if (resorted) repairs.push("클립 또는 음의 순서를 start 순으로 정렬했습니다");

  return { ...song, tempo, tracks };
}
