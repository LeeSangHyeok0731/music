# 곡 파일 저장·불러오기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 곡을 JSON 파일로 내보내고 다시 가져올 수 있게 한다.

**Architecture:** 검증과 직렬화는 `lib/score/`의 순수 함수(zod 스키마 + 정규화)로 두어 브라우저 없이 테스트한다. 파일 I/O는 브라우저 API이므로 `components/transport/`에만 둔다. 불러오기는 기존 실행취소 스택(`commitWith`)에 그대로 쌓는다. 저장이 정확하려면 현재 템포가 곡 안에 있어야 하므로, `song.tempo`를 유일한 진실로 만드는 기존 결함 수정을 함께 한다.

**Tech Stack:** TypeScript, Next.js 16.2.12, React 19.2.4, zod 4.4.3(신규), vitest 4, Tailwind CSS 4

**설계 문서:** [`docs/superpowers/specs/2026-08-02-song-file-io-design.md`](../specs/2026-08-02-song-file-io-design.md)

## Global Constraints

- 패키지 매니저는 **pnpm**이다. `npm install` / `yarn`을 쓰지 않는다.
- `lib/score/`는 Web Audio도 React도 File API도 import하지 않는다. 순수 TS만.
- `lib/audio/`는 React를 import하지 않는다.
- 브라우저 API(`Blob`, `URL`, `File`)를 쓰는 파일은 `components/`에만 둔다.
- `useState`에 담은 객체를 제자리에서 변형하지 않는다. 새 객체를 만든다.
- Tailwind 클래스 문자열을 직접 쓴다. `cn()` 헬퍼도 컴포넌트 라이브러리도 추가하지 않는다.
- 테스트는 `lib/**/*.test.ts`와 `state/**/*.test.ts`만 수집된다(`vitest.config.mts`). 환경은 `node`이고 `@testing-library/react`가 없으므로 **React 훅과 컴포넌트는 테스트하지 않는다.**
- 파일 형식 상수는 `format: "bandline-song"`, `version: 1`이다. 정확히 이 값이어야 한다.
- 사용자에게 보이는 문구는 전부 한국어다. 아래 표의 문구를 **글자 그대로** 쓴다.

| 상황 | 문구 |
| --- | --- |
| JSON 파싱 실패 | `JSON 파일이 아닙니다.` |
| `format` 불일치 | `Bandline 곡 파일이 아닙니다.` |
| `version`이 1보다 큼 | `더 새로운 버전에서 만든 파일입니다.` |
| `version`이 1보다 작거나 그 밖의 스키마 위반 | `파일이 손상되었습니다 (경로)` |
| 파일 읽기 실패 | `파일을 읽지 못했습니다.` |

- 커밋 메시지는 Conventional Commit + 한국어 현재형이다 (`feat(score): ...`).

---

## File Structure

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `package.json` | zod 의존성 | 1 |
| `lib/score/schema.ts` | zod 스키마. 타입·enum·필수 필드 검사 + 값 단위 복구(반올림·클램프) | 1 |
| `lib/score/schema.test.ts` | 위 스키마의 거부/복구 테스트 | 1 |
| `lib/score/serialize.ts` | `serializeSong` / `parseSong` / 곡 전체를 아는 정규화(경계 클램프·정렬) | 2 |
| `lib/score/serialize.test.ts` | 왕복·거부·복구 테스트 | 2 |
| `state/useSongHistory.ts` | `replaceWithoutHistory` 추가 | 3 |
| `state/StudioProvider.tsx` | 템포 일원화(4) · `loadSong` 액션(5) | 4, 5 |
| `components/transport/songFile.ts` | 브라우저 파일 I/O — 다운로드 트리거, 파일 텍스트 읽기 | 6 |
| `components/transport/TransportBar.tsx` | 저장·불러오기 버튼과 숨은 file input | 6 |

`schema.ts`와 `serialize.ts`를 나누는 이유는 복구가 두 단계이기 때문이다. 타일 하나만 보면 되는 복구(반올림, velocity 클램프)는 스키마 안에서 끝나지만, 경계 클램프는 `lengthTicks`를 알아야 하므로 곡 전체를 보는 쪽에 있어야 한다.

---

### Task 1: zod 스키마

**Files:**
- Modify: `package.json` (dependencies)
- Create: `lib/score/schema.ts`
- Test: `lib/score/schema.test.ts`

**Interfaces:**
- Consumes: `lib/score/types.ts`의 `Song`, `Tile`, `Line` 타입 · `lib/score/edit.ts`의 `MIN_TILE_LENGTH`
- Produces:
  - `export const FILE_FORMAT = "bandline-song"`
  - `export const FILE_VERSION = 1`
  - `export const SongFileSchema` — `safeParse(unknown)` 시 `{ format, version, song }`을 돌려주는 zod 스키마. `song`의 모양이 `Song`과 맞는지는 Task 2의 `parseSong` 반환 타입에서 검사된다
  - 타입 alias는 export하지 않는다. `schema.ts`는 `Song`을 import하지 않는다

- [ ] **Step 1: zod 설치**

```bash
pnpm add zod
```

Expected: `dependencies`에 `"zod": "^4.4.3"`이 추가된다. 버전이 다르면 그대로 두고 진행한다 — 아래 코드는 zod 4의 `safeParse` / `error.issues` API만 쓴다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

Create `lib/score/schema.test.ts`:

```ts
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
```

- [ ] **Step 3: 테스트가 실패하는 것을 확인한다**

Run: `pnpm vitest run lib/score/schema.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/score/schema"`

- [ ] **Step 4: 스키마를 구현한다**

Create `lib/score/schema.ts`:

```ts
import { z } from "zod";

import { MIN_TILE_LENGTH } from "./edit";

/** 이 파일이 Bandline 곡임을 알리는 표식. 값을 바꾸면 기존 파일이 전부 열리지 않는다. */
export const FILE_FORMAT = "bandline-song";

/** 파일 형식 버전. 이 값이 아니면 거부한다. */
export const FILE_VERSION = 1;

/** 트랜스포트 슬라이더의 범위와 같다. */
const MIN_TEMPO = 40;
const MAX_TEMPO = 240;

const MIN_MIDI = 0;
const MAX_MIDI = 127;

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
  );

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
    lengthTicks: tick.refine((value) => value >= MIN_TILE_LENGTH, {
      message: "곡 길이가 너무 짧습니다",
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
```

`schema.ts`는 `Song` 타입을 import하지 않는다. 스키마 결과가 `Song`과 어긋나는지는 Task 2의 `serialize.ts`에서 잡힌다 — `parseSong`의 반환 타입이 `{ song: Song }`이므로, 스키마가 `Song`과 다른 모양을 내놓으면 거기서 컴파일이 깨진다. 검사 지점을 한 곳에 두고 쓰지 않는 타입 alias는 만들지 않는다.

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

Run: `pnpm vitest run lib/score/schema.test.ts`
Expected: PASS — 전부 통과

- [ ] **Step 6: 타입 검사**

Run: `pnpm check-types`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add package.json pnpm-lock.yaml lib/score/schema.ts lib/score/schema.test.ts
git commit -m "feat(score): 곡 파일 zod 스키마를 추가한다"
```

---

### Task 2: 직렬화와 파싱

**Files:**
- Create: `lib/score/serialize.ts`
- Test: `lib/score/serialize.test.ts`

**Interfaces:**
- Consumes: Task 1의 `FILE_FORMAT`, `FILE_VERSION`, `SongFileSchema` · `lib/score/edit.ts`의 `MIN_TILE_LENGTH`
- Produces:
  - `export function serializeSong(song: Song): string`
  - `export function parseSong(text: string): ParseResult`
  - `export type ParseResult = { ok: true; song: Song } | { ok: false; reason: string }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `lib/score/serialize.test.ts`:

```ts
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
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm vitest run lib/score/serialize.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/score/serialize"`

- [ ] **Step 3: 직렬화·파싱을 구현한다**

Create `lib/score/serialize.ts`:

```ts
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
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `pnpm vitest run lib/score/serialize.test.ts`
Expected: PASS — 전부 통과

`왕복` 테스트가 실패하면 스키마의 transform이 값을 바꾼 것이다. 데모 곡의 값(velocity 0.7, 정수 틱, tempo 120)은 전부 복구 대상이 아니므로 그대로 나와야 한다.

- [ ] **Step 5: 전체 테스트와 타입 검사**

Run: `pnpm test`
Expected: 기존 테스트 포함 전부 PASS

Run: `pnpm check-types`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add lib/score/serialize.ts lib/score/serialize.test.ts
git commit -m "feat(score): 곡 직렬화와 파일 파싱 함수를 추가한다"
```

---

### Task 3: 히스토리를 건너뛰는 곡 교체

**Files:**
- Modify: `state/useSongHistory.ts`

**Interfaces:**
- Consumes: 기존 `SongHistory` 타입
- Produces: `SongHistory`에 `replaceWithoutHistory: (updater: (song: Song) => Song) => void` 추가

테스트 없이 진행하는 유일한 태스크다. 훅 안의 함수라 `@testing-library/react` 없이는 부를 수 없고, 그 의존성을 들이는 것은 이 슬라이스의 범위가 아니다. 계약은 Task 7의 수동 검증 5번이 확인한다.

- [ ] **Step 1: 타입에 함수를 더한다**

Modify `state/useSongHistory.ts` — `SongHistory` 타입의 `commitWith` 아래에 추가:

```ts
  /**
   * 히스토리에 쌓지 않고 곡을 교체한다.
   *
   * 템포 슬라이더처럼 드래그 한 번에 수십 번 불리는 조작을 위한 것이다.
   * commitWith로 처리하면 Ctrl+Z 50칸이 전부 템포로 채워져 실제 편집을
   * 되돌릴 수 없게 된다.
   */
  replaceWithoutHistory: (updater: (song: Song) => Song) => void;
```

- [ ] **Step 2: 구현을 더한다**

Modify `state/useSongHistory.ts` — `commitWith` 정의 아래에 추가:

```ts
  const replaceWithoutHistory = useCallback((updater: (song: Song) => Song) => {
    const next = updater(songRef.current);
    if (next === songRef.current) return;

    // pastRef를 건드리지 않는다. 이게 commitWith와의 유일한 차이다.
    songRef.current = next;
    setSong(next);
  }, []);
```

- [ ] **Step 3: 반환값에 추가한다**

Modify `state/useSongHistory.ts` — 마지막 `return` 문:

```ts
  return {
    song,
    commitWith,
    replaceWithoutHistory,
    undo,
    canUndo: past.length > 0,
  };
```

- [ ] **Step 4: 검사**

Run: `pnpm check-types`
Expected: 에러 없음

Run: `pnpm test`
Expected: 기존 `useSongHistory.test.ts` 포함 전부 PASS (순수 함수 `pushHistory`만 테스트하므로 영향 없음)

- [ ] **Step 5: 커밋**

```bash
git add state/useSongHistory.ts
git commit -m "feat(state): 히스토리를 건너뛰는 곡 교체 함수를 추가한다"
```

---

### Task 4: 템포 소유권 일원화

**Files:**
- Modify: `state/StudioProvider.tsx`

**Interfaces:**
- Consumes: Task 3의 `replaceWithoutHistory`
- Produces: `StudioValue.tempo`가 이제 `song.tempo`에서 나온다. **타입과 이름은 그대로**이므로 `TransportBar.tsx`는 바뀌지 않는다.

`lib/audio/engine.ts:177`의 `setSong`은 그대로 둔다. 여전히 `bpm`을 건드리지 않고, `StudioProvider`가 필요할 때 `setTempo`를 명시적으로 부른다.

- [ ] **Step 1: 훅에서 새 함수를 꺼낸다**

Modify `state/StudioProvider.tsx:97-103` (구현 완료 후 실제 위치 — 작성 당시의 `:93-98`에서 그 사이 추가된 줄만큼 밀렸다):

```ts
  const {
    song,
    commitWith,
    replaceWithoutHistory,
    undo: undoSong,
    canUndo,
  } = useSongHistory(initialSong);
```

- [ ] **Step 2: tempo state를 제거한다**

Modify `state/StudioProvider.tsx:113`(작성 당시 위치; 구현 완료 후에는 지워진 줄 자리에 남은 주석이 `:118-119`에 있다) — 이 줄을 지운다:

```ts
  const [tempo, setTempoState] = useState(song.tempo);
```

지운 자리에 주석을 남긴다:

```ts
  // 템포는 song.tempo가 유일한 진실이다. 별도 state로 두면 슬라이더로 바꾼
  // 값이 곡에 반영되지 않아, 저장한 파일에 곡을 만들 때의 옛 템포가 들어간다.
```

- [ ] **Step 3: setTempo가 곡을 갱신하게 한다**

Modify `state/StudioProvider.tsx:217-223`(작성 당시 위치; 구현 완료 후에는 `:223-230`이다):

```ts
  const setTempo = useCallback(
    (bpm: number) => {
      // 히스토리에 쌓지 않는다. 드래그 한 번에 onChange가 수십 번 불린다.
      replaceWithoutHistory((s) => ({ ...s, tempo: bpm }));
      getEngine().setTempo(bpm);
    },
    [getEngine, replaceWithoutHistory],
  );
```

- [ ] **Step 4: undo가 엔진 템포를 복원된 곡에 맞추게 한다**

템포가 곡 안으로 들어오면서 `undo`도 템포를 되돌리게 된다. 그런데 `lib/audio/engine.ts:177`의 `setSong`은 의도적으로 `bpm`을 건드리지 않으므로, 엔진은 되돌리기 전 템포를 그대로 들고 있는다.

**이걸 빠뜨리면 화면 슬라이더는 120인데 소리는 160으로 나는 상태가 된다** — 이 슬라이스가 없애려는 바로 그 갈라짐이다. 곡을 갱신하는 effect는 `setSong`만 부르므로 스스로 낫지 않는다.

Modify `state/StudioProvider.tsx` — `undo` 콜백에서 `const restored = undoSong();` 아래, 선택 정리 위에 추가:

```ts
    // 템포가 곡 안에 있으므로 되돌리면 템포도 되돌아간다. 엔진의 bpm은
    // setSong이 건드리지 않으니(engine.ts의 주석 참고) 여기서 맞춰야 한다.
    // 안 맞추면 슬라이더와 실제 재생 속도가 영구히 갈라진다.
    getEngine().setTempo(restored.tempo);
```

`undo`의 의존성 배열에 `getEngine`을 추가한다.

- [ ] **Step 5: context value가 곡의 템포를 내보내게 한다**

Modify `state/StudioProvider.tsx` — `useMemo<StudioValue>`의 객체에서 `tempo,`를 다음으로 바꾼다:

```ts
      tempo: song.tempo,
```

그리고 같은 `useMemo`의 의존성 배열에서 `tempo,`를 **제거한다**. `song`이 이미 의존성에 있으므로 템포가 바뀌면 `song`이 새 객체가 되어 value가 갱신된다.

- [ ] **Step 6: 검사**

Run: `pnpm check-types`
Expected: 에러 없음. 만약 `tempo is not defined`가 나오면 Step 5에서 놓친 참조가 있다 — `useMemo` 의존성 배열을 확인한다.

Run: `pnpm lint`
Expected: 에러 없음. `react-hooks/exhaustive-deps` 경고가 나오면 의존성 배열이 실제 참조와 어긋난 것이다.

- [ ] **Step 7: 실제로 들어본다**

Run: `pnpm dev`

1. 템포 슬라이더를 160으로 올린다 — 숫자 표시가 160이 되어야 한다
2. 재생한다 — **160으로 들려야 한다**
3. 정지하고 타일을 하나 찍는다
4. 슬라이더를 다시 크게 움직인 뒤 `Ctrl+Z`를 한 번 누른다 — **템포가 아니라 3번에서 찍은 타일이 사라져야 한다**
5. 그 상태에서 **다시 재생한다** — 슬라이더가 가리키는 숫자와 실제로 들리는 속도가 같아야 한다

4번은 `replaceWithoutHistory`의 검증이다. 템포가 한 칸씩 되돌아가면 `commitWith`를 쓴 것이다.

**5번은 Step 4의 검증이다.** 되돌리기가 곡의 템포를 옛 값으로 바꿔 놓았는데 엔진의 `bpm`은 그대로라면, 화면은 120을 보여주면서 소리는 160으로 난다. 눈으로는 안 보이고 귀로만 잡힌다.

- [ ] **Step 8: 커밋**

```bash
git add state/StudioProvider.tsx
git commit -m "fix(state): 템포를 곡의 값으로 일원화한다"
```

---

### Task 5: loadSong 액션

**Files:**
- Modify: `state/StudioProvider.tsx`

**Interfaces:**
- Consumes: Task 4의 변경 · 기존 `commitWith`, `playingRef`, `getEngine`, `setSelection`, `setError`
- Produces: `StudioValue`에 `loadSong: (song: Song) => void` 추가

- [ ] **Step 1: 타입에 액션을 더한다**

Modify `state/StudioProvider.tsx` — `StudioValue` 타입의 `undo` 위에 추가:

```ts
  /** 곡을 통째로 교체한다. 실행취소 스택에 쌓이므로 Ctrl+Z로 되돌린다. */
  loadSong: (song: Song) => void;
```

- [ ] **Step 2: 구현한다**

Modify `state/StudioProvider.tsx` — `undo` 정의 위에 추가:

```ts
  const loadSong = useCallback(
    (loaded: Song) => {
      // 편집 핸들러와 같은 가드다. Engine.setSong은 재생 중이면 무시하는데,
      // 곡을 갱신하는 effect는 song에만 반응하므로 정지해도 다시 맞춰주지
      // 않는다. 재생 중에 불러오면 화면과 엔진이 영원히 갈라진다.
      if (playingRef.current) return;

      // 두 줄은 서로 다른 곳을 건드린다 — commitWith는 React 상태를,
      // Engine.setTempo는 엔진의 bpm을. 순서는 상관없다.
      //
      // 엔진 쪽을 빼먹으면 안 된다. 곡을 갱신하는 effect는 setSong만 부르고
      // setSong은 bpm을 건드리지 않으므로(engine.ts의 주석 참고), 불러온 곡의
      // 템포가 엔진에 영원히 반영되지 않는다.
      commitWith(() => loaded);
      getEngine().setTempo(loaded.tempo);

      // 불러온 곡에 이전 선택이 있을 리 없다. 안 지우면 존재하지 않는
      // 타일의 팝오버가 떠 있게 된다.
      setSelection(null);
      setError(null);
    },
    [commitWith, getEngine],
  );
```

`song`이 바뀌면 기존 effect(`StudioProvider.tsx:166`, 작성 당시 위치는 `:160`)가 `getEngine().setSong(song)`을 부른다. 여기서 따로 부르지 않는다.

- [ ] **Step 3: value에 넣는다**

Modify `state/StudioProvider.tsx` — `useMemo<StudioValue>`의 객체와 의존성 배열 **양쪽**에 `loadSong`을 추가한다. 객체에서는 `undo,` 위에, 의존성 배열에서도 같은 자리에 넣는다.

- [ ] **Step 4: 검사**

Run: `pnpm check-types`
Expected: 에러 없음

Run: `pnpm lint`
Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add state/StudioProvider.tsx
git commit -m "feat(state): 곡을 통째로 교체하는 loadSong 액션을 추가한다"
```

---

### Task 6: 파일 I/O와 트랜스포트 버튼

**Files:**
- Create: `components/transport/songFile.ts`
- Modify: `components/transport/TransportBar.tsx`

**Interfaces:**
- Consumes: Task 2의 `serializeSong`, `parseSong` · Task 5의 `loadSong` · 기존 `useStudio()`의 `song`, `editable`
- Produces:
  - `export function downloadSong(song: Song): void`
  - `export async function readFileText(file: File): Promise<string | null>` — 실패 시 `null`

브라우저 API를 쓰므로 `lib/`이 아니라 `components/` 아래다. `vitest.config.mts`의 `include` 밖이라 자동 테스트 대상이 아니다.

- [ ] **Step 1: 파일 I/O 헬퍼를 만든다**

Create `components/transport/songFile.ts`:

```ts
"use client";

import { serializeSong } from "@/lib/score/serialize";
import type { Song } from "@/lib/score/types";

/** Song에 이름 필드가 없다. 중복은 브라우저가 (1)을 붙여 준다. */
const FILE_NAME = "bandline-song.json";

export function downloadSong(song: Song): void {
  const blob = new Blob([serializeSong(song)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = FILE_NAME;
  anchor.click();

  // 이걸 빼면 곡 하나가 탭이 닫힐 때까지 메모리에 남는다.
  URL.revokeObjectURL(url);
}

/** 읽지 못하면 null. 호출부가 문구를 정한다. */
export async function readFileText(file: File): Promise<string | null> {
  try {
    return await file.text();
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: setError를 context에 노출한다**

파일 불러오기 실패 문구를 트랜스포트 바가 띄우려면 setter가 필요하다. 버튼을 달기 전에 먼저 연다.

Modify `state/StudioProvider.tsx` — `StudioValue` 타입의 `error` 아래에 추가:

```ts
  /** 트랜스포트 바의 문구 자리에 한 줄을 띄운다. 파일 불러오기 실패에 쓴다. */
  setError: (message: string | null) => void;
```

`useMemo<StudioValue>`의 객체와 의존성 배열 **양쪽**에 `setError`를 추가한다. `setError`는 `useState`의 setter라 정체성이 안정적이므로 그대로 넘기면 된다.

Run: `pnpm check-types`
Expected: 에러 없음

- [ ] **Step 3: 트랜스포트 바에 import와 구조분해를 더한다**

Modify `components/transport/TransportBar.tsx` — 파일 맨 위 import에 추가:

```ts
import { useRef } from "react";

import { parseSong } from "@/lib/score/serialize";
import { downloadSong, readFileText } from "./songFile";
```

`useStudio()` 구조분해에 `song`, `loadSong`, `setError`를 추가한다:

```ts
  const {
    song,
    isPlaying,
    tempo,
    metronome,
    position,
    supported,
    error,
    setError,
    play,
    stop,
    setTempo,
    setMetronome,
    loadSong,
    undo,
    canUndo,
    editable,
  } = useStudio();
```

- [ ] **Step 4: 핸들러와 ref를 더한다**

Modify `components/transport/TransportBar.tsx` — `const notice = ...` 위에 추가:

```ts
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 같은 파일을 두 번 연속 고르면 값이 안 바뀌어 change가 오지 않는다.
    // 파일을 고쳐서 다시 여는 게 정확히 그 시나리오다.
    event.target.value = "";
    if (!file) return;

    const text = await readFileText(file);
    if (text === null) {
      setError("파일을 읽지 못했습니다.");
      return;
    }

    const result = parseSong(text);
    if (!result.ok) {
      setError(result.reason);
      return;
    }

    loadSong(result.song);
  }
```

`onPickFile`이 `async`인데 `onChange`는 반환값을 무시한다. `event.target.value = ""`를 **`await`보다 앞에** 두는 이유가 여기 있다 — 이벤트 객체는 핸들러가 반환된 뒤에도 살아 있지만, `await` 뒤로 미루면 다음 선택이 먼저 들어올 여지가 생긴다.

- [ ] **Step 5: 버튼과 input을 렌더한다**

Modify `components/transport/TransportBar.tsx` — 실행 취소 버튼(`</button>`) 바로 다음에 추가:

```tsx
      <button
        type="button"
        onClick={() => downloadSong(song)}
        disabled={!editable}
        aria-label="곡 저장"
        className="rounded-md border border-white/10 bg-white/[0.07] px-3 py-1.5 text-[13px] text-zinc-100 transition-colors hover:bg-white/[0.13] disabled:cursor-not-allowed disabled:opacity-40"
      >
        ⭳ 저장
      </button>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={!editable}
        aria-label="곡 불러오기"
        className="rounded-md border border-white/10 bg-white/[0.07] px-3 py-1.5 text-[13px] text-zinc-100 transition-colors hover:bg-white/[0.13] disabled:cursor-not-allowed disabled:opacity-40"
      >
        ⭱ 불러오기
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onPickFile}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
```

- [ ] **Step 6: 검사**

Run: `pnpm lint`
Expected: 에러 없음

Run: `pnpm check-types`
Expected: 에러 없음

Run: `pnpm build`
Expected: 성공. 실패하면 `songFile.ts`의 `"use client"`가 빠졌거나 `lib/score/`가 브라우저 API를 import한 것이다.

- [ ] **Step 7: 커밋**

```bash
git add components/transport/songFile.ts components/transport/TransportBar.tsx state/StudioProvider.tsx
git commit -m "feat(editor): 트랜스포트 바에 곡 저장·불러오기 버튼을 추가한다"
```

---

### Task 7: 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 정적 검사 전부**

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

Expected: 넷 다 성공

- [ ] **Step 2: 실제로 들어본다**

Run: `pnpm dev`

정적 검사는 소리에 대해 아무것도 증명하지 않는다. 아래를 순서대로 직접 확인한다.

1. 타일 몇 개를 찍고 **템포를 슬라이더로 바꾼 뒤** 저장한다 → `bandline-song.json`이 받아진다
2. 새로고침한다 → 데모 곡으로 돌아간다
3. 저장한 파일을 불러온다 → 타일과 **템포 슬라이더 위치**가 그대로다
4. 재생한다 → **바꾼 템포로 들린다.** 이게 템포 일원화의 핵심 검증이다
5. 슬라이더를 크게 드래그한 뒤 `Ctrl+Z` → 템포가 아니라 **직전에 찍은 타일**이 되돌아간다
6. `Ctrl+Z`로 불러오기를 되돌린다 → 곡과 템포가 **함께** 이전 상태로 돌아간다
7. 같은 파일을 연속 두 번 불러온다 → 두 번째도 동작한다
8. `package.json`을 불러온다 → `Bandline 곡 파일이 아닙니다.`가 뜬다
9. 재생 중에는 저장·불러오기 버튼이 둘 다 비활성화돼 있다

- [ ] **Step 3: 손상된 파일을 만들어 확인한다**

저장한 `bandline-song.json`을 텍스트 편집기로 열어 타일 하나의 `velocity`를 `"높게"`(문자열)로 바꾸고 불러온다.

Expected: `파일이 손상되었습니다 (lines[...].tiles[...].velocity)`

같은 파일에서 `"version": 1`을 `2`로 바꾸고 불러온다.

Expected: `더 새로운 버전에서 만든 파일입니다.`

- [ ] **Step 4: 문제가 없으면 종료**

모두 통과하면 이 슬라이스는 끝이다. 실패한 항목이 있으면 해당 태스크로 돌아간다.

---

### 사후 보정 — 전체 브랜치 리뷰 (2026-08-02)

이 태스크들이 전부 끝나고 병합 전 최종 리뷰에서 위 계획이 놓친 결함 두 개가 나왔다. 계획 자체는 아래처럼 고쳐 반영한다 — 원래 태스크 본문은 실행 당시 그대로 두고, 여기 추가한다.

**Task 3(`replaceWithoutHistory`)이 놓친 것:** 새 항목을 히스토리에 안 쌓는 것만 구현하고, 이미 쌓인 과거 스냅샷은 그대로 뒀다. 그런데 과거 스냅샷도 각자 그 시점의 옛 템포 값을 갖고 있어서, "타일을 찍고 → 템포를 바꾸고 → `Ctrl+Z`"를 하면 타일과 **함께 템포도** 그 스냅샷이 저장된 시점 값으로 되돌아갔다 — 방금 바꾼 템포가 조용히 사라지는 결함이다. `replaceWithoutHistory`는 이제 `pastRef.current`의 모든 스냅샷에도 같은 updater를 적용한다(새 배열을 만들어서). 이 방식은 템포처럼 곡 전체에 적용되는 설정에서만 맞다 — 구조적 편집에는 쓰면 안 된다.

**Task 5(`loadSong`)이 놓친 것:** `engine.ts`의 악기 맵(`instruments`)이 최초 `play()` 이후로는 절대 안 바뀐다는 전제를 그대로 뒀다. 그 전제는 "라인 구성이 편집으로 바뀌지 않는다"는 데 있었는데, `loadSong`이 정확히 그 전제를 깬다 — 불러온 파일의 라인 `id`나 `instrument`가 이전 곡과 다를 수 있다. 라인 `id`가 바뀌면 그 라인이 예외 없이 조용히 무음이 되고, `instrument`만 바뀌면 옛 악기로 계속 울린다. `lib/audio/engine.ts`의 `setSong`이 이제 라인 구성(순서·`id`·`instrument`) 변화를 감지해 악기 맵을 다시 채운다(`sameLineComposition` 헬퍼, 그래프가 아직 없으면 손대지 않는다).

두 보정 모두 `lib/audio/engine.test.ts`와 `state/useSongHistory.ts`의 갱신된 doc 코멘트로 확인할 수 있다. `replaceWithoutHistory`는 여전히 훅 안의 함수라 자동 테스트 대상이 아니다 — 계약은 doc 코멘트와 수동 검증으로 남긴다.
