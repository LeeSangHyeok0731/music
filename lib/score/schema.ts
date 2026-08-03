import { z } from "zod";

import { MIN_TILE_LENGTH } from "./edit";
import { PPQ } from "./types";

/** 이 파일이 Bandline 곡임을 알리는 표식. 값을 바꾸면 기존 파일이 전부 열리지 않는다. */
export const FILE_FORMAT = "bandline-song";

/** 파일 형식 버전. 이 값이 아니면 거부한다. */
export const FILE_VERSION = 1;

/**
 * 트랜스포트 슬라이더의 범위와 같다. `TransportBar.tsx`가 이 값을 그대로
 * import해서 쓰므로, 여기 값을 바꾸면 슬라이더도 같이 바뀐다 — 값을
 * 두 곳에 따로 적어 어긋날 여지를 없앤다.
 */
export const MIN_TEMPO = 40;
export const MAX_TEMPO = 240;

const MIN_MIDI = 0;
const MAX_MIDI = 127;

/**
 * `lengthTicks`의 상한. 500마디(4/4 기준) 분량이다.
 *
 * 음악적 제한이 아니라 **렌더 비용 가드**다. `Ruler`와 `BarLines`는 마디
 * 수만큼 DOM/배경을 그리므로, 손으로 고친 파일이 `lengthTicks: 1e9` 같은
 * 값을 담고 들어오면 그 렌더링만으로 탭이 멈춘다. 이 값보다 긴 곡을 실제로
 * 만들 UI가 생기면 그때 다시 정한다.
 */
export const MAX_LENGTH_TICKS = PPQ * 4 * 500;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 유한한 수만 받는다.
 *
 * z.number()는 NaN을 거부하지만 Infinity는 통과시킨다. Infinity가 틱으로
 * 들어오면 반올림해도 Infinity라 그 뒤의 클램프 계산이 전부 NaN이 된다.
 */
const finiteNumber = z.number().refine(Number.isFinite, {
  message: "유한한 수가 아닙니다",
});

/** 틱은 정수가 불변식이다. 손으로 고친 파일에서 소수점이 흔하다. */
const tick = finiteNumber.transform((value) => Math.round(value));

const TileSchema = z.object({
  id: z.string().min(1),
  start: tick,
  length: tick,
  // 넘쳐도 클리핑만 유발하므로 의도는 명확하다. 조용히 고친다.
  velocity: finiteNumber.transform((value) => clamp(value, 0, 1)),
  notes: z.array(z.number().int().min(MIN_MIDI).max(MAX_MIDI)).min(1),
});

const LineSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    kind: z.enum(["pitched", "drum"]),
    instrument: z.enum(["piano", "guitar", "bass", "drums"]),
    tiles: z.array(TileSchema),
  })
  .refine(
    (line) => new Set(line.tiles.map((t) => t.id)).size === line.tiles.length,
    // 편집 함수가 find로 첫 번째만 잡아 두 번째 타일은 영원히 편집되지 않는다.
    // 곡 전체 유일성은 요구하지 않는다 — edit.ts가 라인까지 확인한다.
    { message: "같은 라인 안에 타일 id가 중복됩니다", path: ["tiles"] },
  )
  .refine((line) => (line.kind === "drum") === (line.instrument === "drums"), {
    // kind와 instrument가 어긋나면 addTile이 notes: []인 유령 타일을 만든다
    // (defaultNotesFor는 drums만 빈 배열을 준다). 소리도 안 나고 화면에도
    // 안 보이는데 toggleDrumCell은 notes[0]으로 칸을 찾으므로 지울 수도
    // 없다 — 만들어질 수는 있지만 지울 방법이 없는 상태라 아예 막는다.
    message: "kind와 instrument가 서로 맞지 않습니다",
    path: ["instrument"],
  });

const SongSchema = z
  .object({
    tempo: finiteNumber.transform((value) =>
      clamp(Math.round(value), MIN_TEMPO, MAX_TEMPO),
    ),
    timeSignature: z.tuple([
      z.number().int().positive(),
      z.number().int().positive(),
    ]),
    // 타일 하나도 들어가지 않는 곡은 열지 않는다. serialize.ts의 경계
    // 클램프 계산이 이 하한에 기대고 있다.
    lengthTicks: tick
      .refine((value) => value >= MIN_TILE_LENGTH, {
        message: "곡 길이가 너무 짧습니다",
      })
      // MAX_LENGTH_TICKS 참고 — 렌더 비용 가드다.
      .refine((value) => value <= MAX_LENGTH_TICKS, {
        message: "곡 길이가 너무 깁니다",
      }),
    // 라인 추가 UI가 아직 없다. 빈 곡은 복구할 방법이 없는 상태다.
    lines: z.array(LineSchema).min(1),
  })
  .refine(
    (song) => new Set(song.lines.map((l) => l.id)).size === song.lines.length,
    { message: "라인 id가 중복됩니다", path: ["lines"] },
  );

export const SongFileSchema = z.object({
  format: z.literal(FILE_FORMAT),
  version: z.literal(FILE_VERSION),
  song: SongSchema,
});
