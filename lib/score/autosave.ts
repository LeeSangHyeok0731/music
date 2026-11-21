import { buildDemoSong } from "./demo-song";
import type { Song } from "./model";
import { parseSong } from "./song-schema";

/** 자동 저장에 쓰는 localStorage 키. 곡 모델 버전(v3)이 바뀌면 키도 바꾼다. */
export const AUTOSAVE_KEY = "bandline:song:v3";

export type LoadResult = { song: Song; notice: string | null };

const UNREADABLE_NOTICE = "저장된 곡을 읽지 못해 데모 곡으로 시작합니다";
const REPAIRED_PREFIX = "저장된 곡을 고쳐서 열었습니다: ";
const MAX_NOTICE_LENGTH = 200;

export function serializeSong(song: Song): string {
  return JSON.stringify(song);
}

function unreadable(): LoadResult {
  // 공유되는 객체를 돌려주지 않는다 — 호출마다 새 데모 곡.
  return { song: buildDemoSong(), notice: UNREADABLE_NOTICE };
}

function repairedNotice(repairs: string[]): string {
  const text = REPAIRED_PREFIX + repairs.join("; ");
  return text.length > MAX_NOTICE_LENGTH
    ? text.slice(0, MAX_NOTICE_LENGTH - 1) + "…"
    : text;
}

/**
 * 저장소에서 읽은 문자열을 곡으로 바꾼다. 어떤 입력에도 던지지 않는다.
 *
 * - 저장된 것이 없으면(`null`·빈 문자열·공백) 안내 없이 데모 곡.
 * - 깨진 JSON이거나 `parseSong`이 거부하면(옛 v2 곡 포함) 데모 곡과 안내. 거부된
 *   입력의 일부는 쓰지 않는다.
 * - 복구가 있었으면 `parseSong`이 돌려준 곡 그대로와 복구 내용을 알리는 안내.
 */
export function loadSong(raw: string | null): LoadResult {
  if (raw === null || raw.trim() === "") {
    return { song: buildDemoSong(), notice: null };
  }

  try {
    const result = parseSong(JSON.parse(raw));
    if (!result.ok) return unreadable();
    return {
      song: result.song,
      notice: result.repairs.length > 0 ? repairedNotice(result.repairs) : null,
    };
  } catch {
    // JSON.parse의 SyntaxError, 지나치게 깊은 중첩의 RangeError 등.
    return unreadable();
  }
}
