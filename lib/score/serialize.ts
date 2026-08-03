import type { ZodError } from "zod";

import { MIN_TILE_LENGTH } from "./edit";
import { FILE_FORMAT, FILE_VERSION, SongFileSchema } from "./schema";
import type { Song, Tile } from "./types";

export type ParseResult =
  | { ok: true; song: Song }
  | { ok: false; reason: string };

/** 사람이 파일을 열어 고칠 수 있게 들여쓴다. 곡 하나는 커봐야 수백 KB다. */
const INDENT = 2;

export function serializeSong(song: Song): string {
  return JSON.stringify(
    { format: FILE_FORMAT, version: FILE_VERSION, song },
    null,
    INDENT,
  );
}

/**
 * 파일 텍스트를 곡으로 바꾼다.
 *
 * **예외를 던지지 않는다.** 호출부가 try/catch 없이 reason을 그대로 화면에
 * 띄울 수 있어야 한다. JSON 파싱 실패도 결과 객체로 감싼다.
 */
export function parseSong(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "JSON 파일이 아닙니다." };
  }

  const result = SongFileSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, reason: reasonFor(result.error, raw) };
  }

  return { ok: true, song: normalize(result.data.song) };
}

/**
 * zod 이슈를 한국어 한 줄로 줄인다.
 *
 * 트랜스포트 바의 문구 자리는 ml-auto로 오른쪽에 붙어서, 여러 줄이 들어가면
 * 레이아웃이 밀린다. 첫 이슈만 쓴다.
 */
function reasonFor(error: ZodError, raw: unknown): string {
  const issue = error.issues[0];
  const path = issue?.path ?? [];
  const head = path[0];

  if (head === "format") {
    return "Bandline 곡 파일이 아닙니다.";
  }

  if (head === "version") {
    // 더 작은 값은 존재한 적이 없으므로 손상된 파일이다. "새 버전"이라고
    // 말하면 틀린 안내가 된다.
    const version = (raw as { version?: unknown })?.version;
    if (typeof version === "number" && version > FILE_VERSION) {
      return "더 새로운 버전에서 만든 파일입니다.";
    }
    return "파일이 손상되었습니다 (version)";
  }

  return `파일이 손상되었습니다 (${formatPath(path)})`;
}

/** ["song", "lines", 0, "tiles", 2, "notes"] -> "lines[0].tiles[2].notes" */
function formatPath(path: readonly PropertyKey[]): string {
  // 봉투의 song은 사용자에게 의미가 없다. 벗긴다.
  const parts = path[0] === "song" ? path.slice(1) : path;
  if (parts.length === 0) return "파일 전체";

  return parts.reduce<string>((acc, key) => {
    if (typeof key === "number") return `${acc}[${key}]`;
    return acc ? `${acc}.${String(key)}` : String(key);
  }, "");
}

/**
 * 곡 전체를 알아야 하는 복구.
 *
 * 스키마가 이미 반올림과 값 클램프를 끝냈다. 여기서는 lengthTicks를 알아야
 * 하는 경계 클램프와 정렬만 한다.
 *
 * **원본을 변형하지 않는다.** 정렬은 새 배열에서 한다.
 */
function normalize(song: Song): Song {
  return {
    ...song,
    lines: song.lines.map((line) => ({
      ...line,
      tiles: line.tiles
        .map((tile) => clampTile(tile, song.lengthTicks))
        .sort((a, b) => a.start - b.start),
    })),
  };
}

/**
 * 타일 하나를 곡 경계 안으로 넣는다.
 *
 * 순서가 중요하다. start를 먼저 당겨두므로 length 상한이 항상
 * MIN_TILE_LENGTH 이상이다 — 곡 맨 끝에 붙은 짧은 타일도 최소 길이를
 * 확보한다. 스키마가 lengthTicks >= MIN_TILE_LENGTH를 보장하므로
 * 아래 상한이 음수가 되지 않는다.
 */
function clampTile(tile: Tile, lengthTicks: number): Tile {
  const start = clamp(tile.start, 0, lengthTicks - MIN_TILE_LENGTH);
  const length = clamp(tile.length, MIN_TILE_LENGTH, lengthTicks - start);

  if (start === tile.start && length === tile.length) return tile;
  return { ...tile, start, length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
