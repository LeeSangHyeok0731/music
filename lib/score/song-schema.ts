import { z } from "zod";

import {
  BEAT_UNITS,
  CHORD_QUALITIES,
  INSTRUMENT_IDS,
  MAX_BEATS_PER_BAR,
  MAX_TEMPO,
  MIN_TEMPO,
  SONG_VERSION,
  type ChordSegment,
  type Clip,
  type Song,
} from "./model";
import { validateSong } from "./validate";

/**
 * 구조를 본다. 틱(start·length)·pitch·velocity·템포·마디 수의 정수성·범위와
 * 클립·음·코드 진행 구간의 정렬·겹침·빈틈은 여기서 보지 않는다 — 복구할 수 있는
 * 것(소수 틱의 끝점 반올림, start 정렬)은 `repair`가 고치고, 나머지(진행이 곡을
 * 덮지 못함 등)는 `validateSong`이 거부한다. 코드 진행은 여기서 최소 한 구간인지만
 * 본다.
 *
 * 예외로 여기서 정수성·범위까지 보는 값:
 * - `timeSignature`: 곡 길이(`bars × ticksPerBar`)를 정하므로 무제한이면 `MAX_BARS`
 *   렌더 비용 가드가 뚫린다. 분자 1~`MAX_BEATS_PER_BAR` 정수, 분모 `BEAT_UNITS`
 *   (`model.ts` 참고). 복구하지 않고 거부한다.
 * - `chord.root`(0~11 정수)와 `meta`의 문자열 길이·편집자 수 상한.
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
  z.object({ type: z.literal("pattern"), pattern: z.string().min(1) }),
  z.object({ type: z.literal("notes"), notes: z.array(noteSchema) }),
]);

const segmentSchema = z.object({
  start: z.number(),
  length: z.number(),
  chord: chordSchema,
});

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
  // 박자표는 곡 길이를 정하므로 구조 단계에서 상한을 건다(`model.ts` 참고).
  timeSignature: z.tuple([
    z.number().int().min(1).max(MAX_BEATS_PER_BAR),
    z.literal(BEAT_UNITS),
  ]),
  bars: z.number(),
  progression: z.array(segmentSchema).min(1),
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
  // 캐스트하지 않는다 — 스키마와 모델이 어긋나면 check-types가 잡게 한다.
  const data: Song = parsed.data;
  const song = repair(data, repairs);

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
  let resortedProgression = false;

  /**
   * 소수 틱 구간을 정수 틱으로 바꾼다. start와 length를 따로 반올림하지 않고 양
   * 끝점을 반올림한다(start=round(start), end=round(start+length), length=end-start).
   * 따로 하면 맞닿은 구간이 1틱 겹치거나 끝에 닿은 구간이 1틱 넘친다.
   *
   * **의도된 해석:** 겹침·곡 끝·클립 끝 판정은 반올림한 정수 끝점으로 한다. 그래서
   * 1틱 미만의 겹침이나 초과(예: 실제 끝 480.1과 다음 시작 480)는 반올림이 흡수해
   * 맞닿은 것이 되고, 반올림한 뒤에도 1틱 이상 겹치는 것만 거부된다.
   * 끝점이 뒤집혀 length ≤ 0이 되면 그대로 두어 validateSong이 거부하게 한다.
   */
  const roundSpan = (start: number, length: number) => {
    const nextStart = Math.round(start);
    const nextLength = Math.round(start + length) - nextStart;
    if (nextStart !== start) rounded += 1;
    if (nextLength !== length) rounded += 1;
    return { start: nextStart, length: nextLength };
  };

  const roundedTempo = Math.round(song.tempo);
  const tempo = clamp(roundedTempo, MIN_TEMPO, MAX_TEMPO);
  if (tempo !== roundedTempo) {
    repairs.push(`템포를 ${MIN_TEMPO}~${MAX_TEMPO} 범위로 고쳤습니다 (${song.tempo} → ${tempo})`);
  } else if (roundedTempo !== song.tempo) {
    repairs.push(`템포를 정수로 반올림했습니다 (${song.tempo} → ${tempo})`);
  }

  // 진행 구간도 클립과 같이 끝점을 반올림하고 start로 정렬한다. 빈틈·겹침은 고치지
  // 않는다 — 반올림한 정수 끝점으로 validateSong이 판정해 거부한다.
  const roundedProgression: ChordSegment[] = song.progression.map((seg) => ({
    ...seg,
    ...roundSpan(seg.start, seg.length),
  }));
  const progression = [...roundedProgression].sort((a, b) => a.start - b.start);
  if (progression.some((seg, i) => seg !== roundedProgression[i])) {
    resortedProgression = true;
  }

  const tracks = song.tracks.map((track) => {
    let clips: Clip[] = track.clips.map((clip) => {
      // 클립과 음 모두 끝점을 반올림한다(`roundSpan`). 음이 클립 끝을 넘는지도
      // 반올림한 정수 끝점으로 판정하므로 1틱 미만의 초과는 잘리지 않는다.
      const { start, length } = roundSpan(clip.start, clip.length);

      if (clip.body.type === "pattern") {
        return { ...clip, start, length };
      }

      let notes = clip.body.notes.map((n) => {
        const velocity = clamp(n.velocity, 0, 1);
        if (velocity !== n.velocity) clampedVelocity += 1;
        return { ...n, ...roundSpan(n.start, n.length), velocity };
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
  if (resortedProgression) {
    repairs.push("코드 진행 구간의 순서를 start 순으로 정렬했습니다");
  }

  return { ...song, tempo, progression, tracks };
}
