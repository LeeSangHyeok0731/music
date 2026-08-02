/**
 * `docs/song-file-format.md`가 코드와 어긋나지 않는지 지킨다.
 *
 * 그 문서는 사람이 파일을 손으로 고칠 때와 에이전트가 곡을 생성할 때
 * 둘 다 근거로 쓰인다. 틀린 값이 적혀 있으면 그대로 파일에 옮겨지고,
 * 그 파일은 거부되거나 조용히 다른 곡이 된다. 문서가 코드를 따라오지
 * 못하는 것은 이 저장소에서 이미 한 번 일어났다.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MAX_LENGTH_TICKS, MAX_TEMPO, MIN_TEMPO } from "@/lib/score/schema";
import { parseSong } from "@/lib/score/serialize";
import { MIN_TILE_LENGTH } from "@/lib/score/edit";
import { DRUM_HIHAT, DRUM_KICK, DRUM_SNARE, PPQ } from "@/lib/score/types";

const DOC_PATH = "docs/song-file-format.md";
const doc = readFileSync(DOC_PATH, "utf8");

/** 문서 안의 ```json 블록을 전부 뽑는다. */
function jsonBlocks(): string[] {
  return [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((block) => block[1]);
}

describe("문서의 JSON 예시", () => {
  it("예시가 하나 이상 있다", () => {
    // 정규식이 조용히 아무것도 못 잡는 채로 아래 테스트가 통과하는 걸 막는다.
    expect(jsonBlocks().length).toBeGreaterThan(0);
  });

  it("모든 예시가 실제로 파싱된다", () => {
    // 문서는 최소 예시를 "복사해서 저장하면 바로 열린다"고 안내한다.
    for (const block of jsonBlocks()) {
      const result = parseSong(block);
      if (!result.ok) {
        throw new Error(
          `${DOC_PATH}의 예시가 거부됨: ${result.reason}\n${block.slice(0, 200)}`,
        );
      }
    }
  });
});

describe("문서에 적힌 값이 코드와 같다", () => {
  it("PPQ", () => {
    expect(PPQ).toBe(480);
    expect(doc).toContain("PPQ = 480");
  });

  it("템포 범위", () => {
    expect([MIN_TEMPO, MAX_TEMPO]).toEqual([40, 240]);
    expect(doc).toContain(`${MIN_TEMPO}~${MAX_TEMPO}`);
  });

  it("곡 길이 상한", () => {
    expect(MAX_LENGTH_TICKS).toBe(PPQ * 4 * 500);
    expect(doc).toContain(String(MAX_LENGTH_TICKS));
  });

  it("타일 최소 길이", () => {
    expect(MIN_TILE_LENGTH).toBe(120);
    expect(doc).toContain(String(MIN_TILE_LENGTH));
  });

  it("드럼 번호", () => {
    expect([DRUM_KICK, DRUM_SNARE, DRUM_HIHAT]).toEqual([36, 38, 42]);
    for (const piece of [DRUM_KICK, DRUM_SNARE, DRUM_HIHAT]) {
      expect(doc).toContain(`| ${piece} |`);
    }
  });

  it("마디 환산", () => {
    const bar4_4 = PPQ * 4;
    expect(bar4_4).toBe(1920);
    expect(doc).toContain(String(bar4_4 * 16)); // 16마디 = 30720
    expect(doc).toContain(String((bar4_4 / 4) * 3)); // 3/4 한 마디 = 1440
  });
});
