# 타일 타임라인 재생 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하드코딩된 16마디 곡을 악기 라인 위에 타일로 그리고, 재생하면 플레이 플래그가 지나가며 정확한 타이밍으로 소리가 나는 읽기 전용 타임라인을 만든다.

**Architecture:** `lib/score/`(순수 데이터·시간 변환) → `lib/audio/`(AudioContext·look-ahead 스케줄러·신스 악기) → `state/StudioProvider`(엔진 1개 + React UI 상태) → `components/`(DOM 타일 + 별도 rAF 플래그 레이어)의 단방향 3계층. 스케줄러는 `AudioClock` / `NoteSink` 두 인터페이스에만 의존해 브라우저 없이 결정적으로 테스트된다.

**Tech Stack:** Next.js 16.2.12 (App Router), React 19.2.4, TypeScript 5, Tailwind CSS 4, Web Audio API, Vitest

설계 문서: `docs/superpowers/specs/2026-07-31-tile-timeline-playback-design.md`

## Global Constraints

- 패키지 매니저는 **pnpm**이다. `npm install` / `yarn`을 쓰지 않는다.
- `AudioContext`를 **모듈 스코프에서 생성하지 않는다.** 사용자 제스처 핸들러 안에서 지연 생성하고 같은 핸들러에서 `await ctx.resume()`까지 끝낸다.
- 오디오 스케줄링에 `setTimeout` / `requestAnimationFrame`으로 노트를 하나씩 울리지 않는다. look-ahead 스케줄러로 `audioContext.currentTime` 기준 절대 시각에 미리 예약한다.
- 예약 시각에 `Date.now()`, `performance.now()`, rAF 타임스탬프를 섞지 않는다.
- 재생 중 매 프레임 값(플래그 위치)은 `useState`에 넣지 않는다. rAF에서 DOM에 직접 쓴다.
- `use client`는 훅이나 브라우저 API를 쓰는 **모든 파일**에 붙인다. 한곳에 몰아주는 루트 컴포넌트를 두지 않는다.
- `lib/score/`는 Web Audio도 React도 import하지 않는다. `lib/audio/`는 React를 import하지 않는다.
- 임포트는 `@/` alias(저장소 루트 기준)로 해결한다.
- `PPQ = 480`. 시간은 정수 틱으로 저장하고 초 변환은 예약 직전에 한 번만 한다.
- `Line.tiles[]`는 `start` 오름차순 정렬이 불변식이다.
- 상수: `PX_PER_BAR = 120`, lookahead `0.1`초, 스케줄러 타이머 `25`ms, 마스터 게인 `0.7`, 최대 동시 보이스 `32`, 페이드아웃 `0.005`초, 드럼 타일 길이 `120`틱 고정, GM 드럼 번호 `36` 킥 / `38` 스네어 / `42` 하이햇.
- `exponentialRampToValueAtTime`의 목표값은 0이 될 수 없다. `0.0001`로 내린 뒤 `setValueAtTime(0, ...)`으로 마무리한다.
- 커밋 메시지는 Conventional Commit 형식에 한국어 설명. 스코프는 `score` / `audio` / `state` / `editor` / `app` / `config` / `docs`.

---

## File Structure

**생성**

```text
lib/score/types.ts              PPQ, Tile, Line, Song, InstrumentId, LineKind
lib/score/time.ts               틱↔초, 틱→마디:박, ticksPerBar
lib/score/notes.ts              MIDI 번호 → 음 이름 (타일 표시용)
lib/score/fixture.ts            16마디 데모 곡 생성
lib/score/time.test.ts
lib/score/fixture.test.ts

lib/audio/types.ts              AudioClock, NoteSink, Instrument
lib/audio/scheduler.ts          Scheduler — 순수 로직, 브라우저 불필요
lib/audio/scheduler.test.ts
lib/audio/context.ts            AudioContext 지연 생성, isSupported, ensureRunning
lib/audio/env.ts                엔벨로프 헬퍼, fadeOutAndStop, midiToFreq
lib/audio/voices.ts             VoicePool — 동시 발음 상한 + voice stealing
lib/audio/instruments/piano.ts
lib/audio/instruments/guitar.ts
lib/audio/instruments/bass.ts
lib/audio/instruments/drums.ts
lib/audio/instruments/index.ts  InstrumentId → 생성 함수 매핑
lib/audio/metronome.ts
lib/audio/engine.ts             Engine — 노드 그래프 소유, play/stop/setTempo/currentTick

state/StudioProvider.tsx

components/timeline/layout.ts   PX_PER_BAR, tickToPx, 라인 높이 상수, DRUM_ROWS
components/timeline/Timeline.tsx
components/timeline/LineHeaders.tsx
components/timeline/BarLines.tsx
components/timeline/TileLine.tsx
components/timeline/DrumGrid.tsx
components/timeline/Playflag.tsx
components/transport/TransportBar.tsx

vitest.config.ts
```

**수정**

```text
package.json          test 스크립트 + vitest devDependency
app/layout.tsx        metadata title/description
app/page.tsx          스캐폴드 내용을 StudioProvider + Timeline + TransportBar로 교체
AGENTS.md             "현재 상태" 절 갱신 (Task 12)
.claude/rules/frontend-architecture.md   "현재 상태 vs 계획" 절 갱신 (Task 12)
```

---

## Task 1: 시간 변환과 Vitest 도입

**Files:**
- Create: `vitest.config.ts`
- Create: `lib/score/types.ts`
- Create: `lib/score/time.ts`
- Test: `lib/score/time.test.ts`
- Modify: `package.json` (scripts에 `test` 추가, devDependencies에 vitest 추가)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `PPQ: 480` (상수)
  - `type Tile = { id: string; start: number; length: number; velocity: number; notes: number[] }`
  - `type LineKind = "pitched" | "drum"`
  - `type InstrumentId = "piano" | "guitar" | "bass" | "drums"`
  - `type Line = { id: string; name: string; kind: LineKind; instrument: InstrumentId; tiles: Tile[] }`
  - `type Song = { tempo: number; timeSignature: [number, number]; lengthTicks: number; lines: Line[] }`
  - `ticksToSeconds(ticks: number, bpm: number): number`
  - `secondsToTicks(seconds: number, bpm: number): number`
  - `ticksPerBar(ts: [number, number]): number`
  - `ticksToBarBeat(ticks: number, ts: [number, number]): { bar: number; beat: number }`

- [ ] **Step 1: Vitest 설치**

```bash
pnpm add -D vitest
```

- [ ] **Step 2: `vitest.config.ts` 생성**

`@/` alias를 저장소 루트로 해석해야 `tsconfig.json`의 `paths`와 동작이 같아진다. `import.meta.url`을 쓰는 이유는 이 파일이 ESM이라 `__dirname`이 없기 때문이다.

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": rootDir },
  },
});
```

- [ ] **Step 3: `package.json`에 test 스크립트 추가**

`scripts`에 아래 한 줄을 더한다. 기존 스크립트는 건드리지 않는다.

```json
"test": "vitest run"
```

- [ ] **Step 4: 실패하는 테스트 작성 — `lib/score/time.test.ts`**

`vitest` globals를 켜지 않고 명시적으로 import한다. 그래야 `tsconfig.json`을 고치지 않아도 `pnpm check-types`가 통과한다.

```ts
import { describe, expect, it } from "vitest";

import { PPQ } from "@/lib/score/types";
import {
  secondsToTicks,
  ticksPerBar,
  ticksToBarBeat,
  ticksToSeconds,
} from "@/lib/score/time";

describe("ticksToSeconds", () => {
  it("120BPM에서 4분음표 한 개는 0.5초다", () => {
    expect(ticksToSeconds(PPQ, 120)).toBe(0.5);
  });

  it("템포가 두 배면 시간은 절반이다", () => {
    expect(ticksToSeconds(PPQ, 240)).toBe(0.25);
  });

  it("0틱은 0초다", () => {
    expect(ticksToSeconds(0, 120)).toBe(0);
  });
});

describe("secondsToTicks", () => {
  it("ticksToSeconds의 역함수다", () => {
    expect(secondsToTicks(0.5, 120)).toBe(PPQ);
  });
});

describe("ticksPerBar", () => {
  it("4/4 한 마디는 4분음표 4개다", () => {
    expect(ticksPerBar([4, 4])).toBe(PPQ * 4);
  });

  it("3/4 한 마디는 4분음표 3개다", () => {
    expect(ticksPerBar([3, 4])).toBe(PPQ * 3);
  });

  it("6/8 한 마디는 8분음표 6개다", () => {
    expect(ticksPerBar([6, 8])).toBe(PPQ * 3);
  });
});

describe("ticksToBarBeat", () => {
  it("0틱은 1마디 1박이다", () => {
    expect(ticksToBarBeat(0, [4, 4])).toEqual({ bar: 1, beat: 1 });
  });

  it("1920틱은 2마디 1박이다", () => {
    expect(ticksToBarBeat(1920, [4, 4])).toEqual({ bar: 2, beat: 1 });
  });

  it("2400틱은 2마디 2박이다", () => {
    expect(ticksToBarBeat(2400, [4, 4])).toEqual({ bar: 2, beat: 2 });
  });
});

describe("누적 오차", () => {
  it("정수 틱에서 계산하면 몇 번을 불러도 같은 값이 나온다", () => {
    // 스케줄러가 앵커에서 매번 다시 계산하는 근거
    expect(ticksToSeconds(10_000, 137)).toBe(ticksToSeconds(10_000, 137));
  });

  it("한 틱씩 더해 나가는 방식과 결과가 갈린다", () => {
    let accumulated = 0;
    for (let i = 0; i < 10_000; i++) {
      accumulated += ticksToSeconds(1, 137);
    }
    const direct = ticksToSeconds(10_000, 137);
    // 10,000번 정도로는 차이가 미세하지만, 재생이 길어질수록 벌어진다.
    // 그래서 pos += delta 로 굴리지 않는다.
    expect(Math.abs(accumulated - direct)).toBeLessThan(1e-6);
  });
});
```

- [ ] **Step 5: 테스트가 실패하는지 확인**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "@/lib/score/types"` (파일이 아직 없음)

- [ ] **Step 6: `lib/score/types.ts` 작성**

```ts
/** 4분음표 하나에 해당하는 틱 수. 모든 음악적 시간의 기준 단위. */
export const PPQ = 480;

export type LineKind = "pitched" | "drum";

export type InstrumentId = "piano" | "guitar" | "bass" | "drums";

export type Tile = {
  id: string;
  /** 곡 시작 기준 절대 틱. 정수. */
  start: number;
  /** 틱. 정수. 드럼 라인에서는 격자 한 칸 폭(120)으로 고정된다. */
  length: number;
  /** 0..1 */
  velocity: number;
  /** 동시에 울릴 MIDI 번호. 드럼 라인에서는 GM 드럼 번호. */
  notes: number[];
};

export type Line = {
  id: string;
  name: string;
  /** 어느 컴포넌트로 그릴지만 고른다. 스케줄러는 이 필드를 읽지 않는다. */
  kind: LineKind;
  instrument: InstrumentId;
  /** start 오름차순 정렬이 불변식이다. */
  tiles: Tile[];
};

export type Song = {
  tempo: number;
  timeSignature: [number, number];
  lengthTicks: number;
  lines: Line[];
};

/** GM 관행에 따른 드럼 번호. */
export const DRUM_KICK = 36;
export const DRUM_SNARE = 38;
export const DRUM_HIHAT = 42;
```

- [ ] **Step 7: `lib/score/time.ts` 작성**

```ts
import { PPQ } from "./types";

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm);
}

export function secondsToTicks(seconds: number, bpm: number): number {
  return ((seconds * bpm) / 60) * PPQ;
}

export function ticksPerBar(ts: [number, number]): number {
  const [beatsPerBar, beatUnit] = ts;
  const ticksPerBeat = PPQ * (4 / beatUnit);
  return ticksPerBeat * beatsPerBar;
}

/** 1부터 세는 마디와 박을 돌려준다. */
export function ticksToBarBeat(
  ticks: number,
  ts: [number, number],
): { bar: number; beat: number } {
  const [, beatUnit] = ts;
  const ticksPerBeat = PPQ * (4 / beatUnit);
  const perBar = ticksPerBar(ts);
  const clamped = Math.max(0, ticks);

  return {
    bar: Math.floor(clamped / perBar) + 1,
    beat: Math.floor((clamped % perBar) / ticksPerBeat) + 1,
  };
}
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS — `lib/score/time.test.ts`의 테스트가 전부 통과

- [ ] **Step 9: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음

- [ ] **Step 10: 커밋**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml lib/score/types.ts lib/score/time.ts lib/score/time.test.ts
git commit -m "feat(score): 곡 타입과 음악적 시간 변환 추가"
```

---

## Task 2: 데모 곡 fixture

**Files:**
- Create: `lib/score/fixture.ts`
- Test: `lib/score/fixture.test.ts`

**Interfaces:**
- Consumes: Task 1의 `PPQ`, `Tile`, `Line`, `Song`, `DRUM_KICK`, `DRUM_SNARE`, `DRUM_HIHAT`, `ticksPerBar`
- Produces:
  - `DEMO_BARS: 16` (상수)
  - `DRUM_TILE_LENGTH: 120` (상수)
  - `buildDemoSong(): Song` — 16마디 C–Am–F–G 진행, 4개 라인(`piano` / `guitar` / `bass` / `drums`), 모든 `tiles[]`가 `start` 오름차순

- [ ] **Step 1: 실패하는 테스트 작성 — `lib/score/fixture.test.ts`**

```ts
import { describe, expect, it } from "vitest";

import { DEMO_BARS, DRUM_TILE_LENGTH, buildDemoSong } from "@/lib/score/fixture";
import { ticksPerBar } from "@/lib/score/time";
import { DRUM_HIHAT, DRUM_KICK, DRUM_SNARE } from "@/lib/score/types";

describe("buildDemoSong", () => {
  const song = buildDemoSong();

  it("120BPM 4/4 16마디다", () => {
    expect(song.tempo).toBe(120);
    expect(song.timeSignature).toEqual([4, 4]);
    expect(song.lengthTicks).toBe(ticksPerBar([4, 4]) * DEMO_BARS);
  });

  it("30초보다 길다 — 드리프트를 귀로 확인할 수 있어야 한다", () => {
    const seconds = (song.lengthTicks / 480) * (60 / song.tempo);
    expect(seconds).toBeGreaterThan(30);
  });

  it("라인이 4개다", () => {
    expect(song.lines.map((l) => l.instrument)).toEqual([
      "piano",
      "guitar",
      "bass",
      "drums",
    ]);
  });

  it("드럼 라인만 kind가 drum이다", () => {
    const drum = song.lines.filter((l) => l.kind === "drum");
    expect(drum).toHaveLength(1);
    expect(drum[0].instrument).toBe("drums");
  });

  it("모든 라인의 tiles가 start 오름차순이다 — 스케줄러 커서의 전제", () => {
    for (const line of song.lines) {
      for (let i = 1; i < line.tiles.length; i++) {
        expect(line.tiles[i].start).toBeGreaterThanOrEqual(
          line.tiles[i - 1].start,
        );
      }
    }
  });

  it("타일 id가 곡 전체에서 유일하다", () => {
    const ids = song.lines.flatMap((l) => l.tiles.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 타일이 곡 길이 안에 있고 음을 하나 이상 가진다", () => {
    for (const line of song.lines) {
      for (const tile of line.tiles) {
        expect(tile.notes.length).toBeGreaterThan(0);
        expect(tile.start).toBeGreaterThanOrEqual(0);
        expect(tile.start + tile.length).toBeLessThanOrEqual(song.lengthTicks);
        expect(tile.velocity).toBeGreaterThan(0);
        expect(tile.velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("피아노는 마디마다 3화음 하나다", () => {
    const piano = song.lines.find((l) => l.instrument === "piano")!;
    expect(piano.tiles).toHaveLength(DEMO_BARS);
    for (const tile of piano.tiles) {
      expect(tile.notes).toHaveLength(3);
    }
  });

  it("드럼 타일은 길이가 고정이고 킥·스네어·하이햇만 쓴다", () => {
    const drums = song.lines.find((l) => l.kind === "drum")!;
    for (const tile of drums.tiles) {
      expect(tile.length).toBe(DRUM_TILE_LENGTH);
      expect(tile.notes).toHaveLength(1);
      expect([DRUM_KICK, DRUM_SNARE, DRUM_HIHAT]).toContain(tile.notes[0]);
    }
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "@/lib/score/fixture"`

- [ ] **Step 3: `lib/score/fixture.ts` 작성**

```ts
import { ticksPerBar } from "./time";
import {
  DRUM_HIHAT,
  DRUM_KICK,
  DRUM_SNARE,
  PPQ,
  type Line,
  type Song,
  type Tile,
} from "./types";

export const DEMO_BARS = 16;

/** 드럼 격자 한 칸의 폭. 16분음표. 실제 울림 길이가 아니라 칸 폭을 뜻한다. */
export const DRUM_TILE_LENGTH = 120;

const TIME_SIGNATURE: [number, number] = [4, 4];
const BAR = ticksPerBar(TIME_SIGNATURE); // 1920
const BEAT = PPQ; // 480

/** C – Am – F – G 를 네 번 반복한다. */
const PROGRESSION = [
  { chord: [60, 64, 67], root: 48 }, // C
  { chord: [57, 60, 64], root: 45 }, // Am
  { chord: [53, 57, 60], root: 41 }, // F
  { chord: [55, 59, 62], root: 43 }, // G
] as const;

function buildPiano(): Line {
  const tiles: Tile[] = [];
  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const step = PROGRESSION[bar % PROGRESSION.length];
    tiles.push({
      id: `piano-${bar}`,
      start: bar * BAR,
      length: BAR,
      velocity: 0.7,
      notes: [...step.chord],
    });
  }
  return {
    id: "line-piano",
    name: "피아노",
    kind: "pitched",
    instrument: "piano",
    tiles,
  };
}

function buildGuitar(): Line {
  const tiles: Tile[] = [];
  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const step = PROGRESSION[bar % PROGRESSION.length];
    // 1박과 3박에 한 번씩 스트로크
    for (const beat of [0, 2]) {
      tiles.push({
        id: `guitar-${bar}-${beat}`,
        start: bar * BAR + beat * BEAT,
        length: BEAT * 2,
        velocity: 0.5,
        notes: step.chord.map((n) => n + 12),
      });
    }
  }
  return {
    id: "line-guitar",
    name: "기타",
    kind: "pitched",
    instrument: "guitar",
    tiles,
  };
}

function buildBass(): Line {
  const tiles: Tile[] = [];
  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const step = PROGRESSION[bar % PROGRESSION.length];
    for (const beat of [0, 2]) {
      tiles.push({
        id: `bass-${bar}-${beat}`,
        start: bar * BAR + beat * BEAT,
        length: BEAT * 2,
        velocity: 0.8,
        notes: [step.root - 12],
      });
    }
  }
  return {
    id: "line-bass",
    name: "베이스",
    kind: "pitched",
    instrument: "bass",
    tiles,
  };
}

function buildDrums(): Line {
  const tiles: Tile[] = [];
  for (let bar = 0; bar < DEMO_BARS; bar++) {
    const base = bar * BAR;

    for (const beat of [0, 2]) {
      tiles.push({
        id: `kick-${bar}-${beat}`,
        start: base + beat * BEAT,
        length: DRUM_TILE_LENGTH,
        velocity: 0.9,
        notes: [DRUM_KICK],
      });
    }

    for (const beat of [1, 3]) {
      tiles.push({
        id: `snare-${bar}-${beat}`,
        start: base + beat * BEAT,
        length: DRUM_TILE_LENGTH,
        velocity: 0.7,
        notes: [DRUM_SNARE],
      });
    }

    // 8분음표 하이햇
    for (let eighth = 0; eighth < 8; eighth++) {
      tiles.push({
        id: `hihat-${bar}-${eighth}`,
        start: base + eighth * (BEAT / 2),
        length: DRUM_TILE_LENGTH,
        velocity: eighth % 2 === 0 ? 0.5 : 0.3,
        notes: [DRUM_HIHAT],
      });
    }
  }

  // start 오름차순 불변식을 여기서 보장한다
  tiles.sort((a, b) => a.start - b.start);

  return {
    id: "line-drums",
    name: "드럼",
    kind: "drum",
    instrument: "drums",
    tiles,
  };
}

export function buildDemoSong(): Song {
  return {
    tempo: 120,
    timeSignature: TIME_SIGNATURE,
    lengthTicks: BAR * DEMO_BARS,
    lines: [buildPiano(), buildGuitar(), buildBass(), buildDrums()],
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS — `time.test.ts`와 `fixture.test.ts`가 모두 통과

- [ ] **Step 5: 커밋**

```bash
git add lib/score/fixture.ts lib/score/fixture.test.ts
git commit -m "feat(score): 16마디 데모 곡 fixture 추가"
```

---

## Task 3: look-ahead 스케줄러

**Files:**
- Create: `lib/audio/types.ts`
- Create: `lib/audio/scheduler.ts`
- Test: `lib/audio/scheduler.test.ts`

**Interfaces:**
- Consumes: Task 1의 `PPQ`, `Song`; Task 2의 `buildDemoSong`
- Produces:
  - `interface AudioClock { readonly currentTime: number }`
  - `interface NoteSink { schedule(lineId: string, note: number, when: number, dur: number, vel: number): void }`
  - `interface Instrument { play(note: number, when: number, dur: number, vel: number): void }`
  - `class Scheduler`
    - `constructor(song: Song, clock: AudioClock, sink: NoteSink, lookaheadSeconds?: number)`
    - `start(atTime: number): void`
    - `advance(): void`
    - `setTempo(bpm: number): void`
    - `currentTick(): number`
    - `isDone(): boolean`
    - `readonly tempo: number`

- [ ] **Step 1: `lib/audio/types.ts` 작성**

이 파일은 테스트 대상이 아니라 다음 스텝의 테스트가 import할 타입이므로 먼저 만든다.

```ts
/** 스케줄러가 시간을 읽는 통로. 실제 실행에서는 AudioContext가 이 모양을 만족한다. */
export interface AudioClock {
  readonly currentTime: number;
}

/** 스케줄러가 예약을 내보내는 통로. 실제 실행에서는 악기 디스패처가 받는다. */
export interface NoteSink {
  schedule(
    lineId: string,
    note: number,
    when: number,
    dur: number,
    vel: number,
  ): void;
}

/** 하나의 악기. when은 audioContext.currentTime 기준 절대 초. */
export interface Instrument {
  play(note: number, when: number, dur: number, vel: number): void;
}
```

- [ ] **Step 2: 실패하는 테스트 작성 — `lib/audio/scheduler.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { Scheduler } from "@/lib/audio/scheduler";
import type { AudioClock, NoteSink } from "@/lib/audio/types";
import { buildDemoSong } from "@/lib/score/fixture";
import { ticksToSeconds } from "@/lib/score/time";
import { PPQ, type Song } from "@/lib/score/types";

class FakeClock implements AudioClock {
  currentTime = 0;
  advanceBy(seconds: number): void {
    this.currentTime += seconds;
  }
}

type Recorded = {
  lineId: string;
  note: number;
  when: number;
  dur: number;
  vel: number;
};

class RecordingSink implements NoteSink {
  readonly events: Recorded[] = [];
  schedule(
    lineId: string,
    note: number,
    when: number,
    dur: number,
    vel: number,
  ): void {
    this.events.push({ lineId, note, when, dur, vel });
  }
}

/** 타일 하나에 음이 여러 개면 예약도 그만큼 나온다. */
function totalNoteCount(song: Song): number {
  return song.lines.reduce(
    (sum, line) =>
      sum + line.tiles.reduce((s, tile) => s + tile.notes.length, 0),
    0,
  );
}

/** 25ms 타이머를 흉내내 seconds만큼 굴린다. */
function run(scheduler: Scheduler, clock: FakeClock, seconds: number): void {
  const steps = Math.ceil(seconds / 0.025);
  scheduler.advance();
  for (let i = 0; i < steps; i++) {
    clock.advanceBy(0.025);
    scheduler.advance();
  }
}

describe("Scheduler", () => {
  let song: Song;
  let clock: FakeClock;
  let sink: RecordingSink;
  let scheduler: Scheduler;

  beforeEach(() => {
    song = buildDemoSong();
    clock = new FakeClock();
    sink = new RecordingSink();
    scheduler = new Scheduler(song, clock, sink);
    scheduler.start(0);
  });

  it("곡을 끝까지 굴리면 모든 음이 정확히 한 번씩 예약된다", () => {
    run(scheduler, clock, 33);
    expect(sink.events).toHaveLength(totalNoteCount(song));
    expect(scheduler.isDone()).toBe(true);
  });

  it("예약 시각이 음악적 시간과 일치한다", () => {
    run(scheduler, clock, 5);
    const piano = sink.events.filter((e) => e.lineId === "line-piano");
    // 피아노는 마디마다 3화음 하나 — 첫 마디는 0초, 둘째 마디는 2초
    expect(piano[0].when).toBeCloseTo(0, 9);
    expect(piano[3].when).toBeCloseTo(ticksToSeconds(1920, 120), 9);
    expect(piano[3].when).toBeCloseTo(2, 9);
  });

  it("예약 길이가 타일 길이와 일치한다", () => {
    run(scheduler, clock, 3);
    const piano = sink.events.find((e) => e.lineId === "line-piano")!;
    // 피아노 타일은 한 마디(1920틱) = 120BPM에서 2초
    expect(piano.dur).toBeCloseTo(2, 9);
  });

  it("같은 타일을 두 번 예약하지 않는다", () => {
    run(scheduler, clock, 33);
    const keys = sink.events.map((e) => `${e.lineId}:${e.note}:${e.when}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("advance를 시간 전진 없이 여러 번 불러도 중복이 없다", () => {
    scheduler.advance();
    const first = sink.events.length;
    scheduler.advance();
    scheduler.advance();
    expect(sink.events).toHaveLength(first);
  });

  it("lookahead 구간 밖은 아직 예약하지 않는다", () => {
    scheduler.advance();
    // lookahead 0.1초 → 0.1초 이후 시작하는 음은 아직 없어야 한다
    for (const event of sink.events) {
      expect(event.when).toBeLessThan(0.1);
    }
  });

  it("horizon 경계에 정확히 걸친 타일은 다음 틱으로 넘어간다", () => {
    // lookahead를 0.5초로 두면 첫 advance의 경계는 정확히 1920틱(2초)이 아니라 0.5초
    const boundaryClock = new FakeClock();
    const boundarySink = new RecordingSink();
    // 0.5초 = 240틱. 피아노 두 번째 타일은 1920틱이므로 경계 테스트는
    // lookahead를 2초로 잡아 둘째 마디(정확히 2.0초)가 경계에 걸리게 한다
    const s = new Scheduler(song, boundaryClock, boundarySink, 2);
    s.start(0);
    s.advance();
    const pianoWhens = boundarySink.events
      .filter((e) => e.lineId === "line-piano")
      .map((e) => e.when);
    // 0초짜리는 들어오고, 정확히 2.0초짜리는 아직 안 들어온다
    expect(pianoWhens).toContain(0);
    expect(pianoWhens.every((w) => w < 2)).toBe(true);
  });

  it("currentTick이 시간에 비례해 전진한다", () => {
    expect(scheduler.currentTick()).toBeCloseTo(0, 6);
    clock.advanceBy(2);
    // 120BPM에서 2초 = 한 마디 = 1920틱
    expect(scheduler.currentTick()).toBeCloseTo(1920, 6);
  });

  it("start 시각이 0이 아니어도 그 시각을 기준으로 예약한다", () => {
    const c = new FakeClock();
    const s2 = new RecordingSink();
    c.currentTime = 10;
    const sch = new Scheduler(song, c, s2);
    sch.start(10.5);
    sch.advance();
    expect(s2.events.every((e) => e.when >= 10.5)).toBe(true);
  });
});

describe("Scheduler.setTempo", () => {
  it("템포를 바꿔도 이미 예약된 구간과 새 구간 사이에 틈이나 겹침이 없다", () => {
    const song = buildDemoSong();
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(song, clock, sink);
    scheduler.start(0);

    // 4초까지 120BPM으로 굴린다
    run(scheduler, clock, 4);
    const beforeCount = sink.events.length;
    const lastWhenBefore = Math.max(...sink.events.map((e) => e.when));

    scheduler.setTempo(240);
    run(scheduler, clock, 20);

    const added = sink.events.slice(beforeCount);
    expect(added.length).toBeGreaterThan(0);
    // 새로 예약된 것은 전부 기존 예약 경계 이후다 — 과거에 예약되면 즉시 울린다
    for (const event of added) {
      expect(event.when).toBeGreaterThanOrEqual(lastWhenBefore - 1e-9);
    }
  });

  it("템포를 바꾸면 이후 간격이 새 템포를 따른다", () => {
    const song = buildDemoSong();
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(song, clock, sink);
    scheduler.start(0);
    scheduler.setTempo(240);
    run(scheduler, clock, 5);

    const piano = sink.events
      .filter((e) => e.lineId === "line-piano")
      .map((e) => e.when);
    // 240BPM에서 한 마디(1920틱)는 1초
    const uniqueStarts = [...new Set(piano)].sort((a, b) => a - b);
    expect(uniqueStarts[1] - uniqueStarts[0]).toBeCloseTo(1, 6);
  });

  it("tempo 프로퍼티가 현재 값을 돌려준다", () => {
    const song = buildDemoSong();
    const scheduler = new Scheduler(song, new FakeClock(), new RecordingSink());
    expect(scheduler.tempo).toBe(song.tempo);
    scheduler.setTempo(90);
    expect(scheduler.tempo).toBe(90);
  });
});

describe("Scheduler 커서", () => {
  it("커서는 뒤로 가지 않는다", () => {
    const song = buildDemoSong();
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(song, clock, sink);
    scheduler.start(0);

    let previous = 0;
    for (let i = 0; i < 200; i++) {
      clock.advanceBy(0.025);
      scheduler.advance();
      expect(sink.events.length).toBeGreaterThanOrEqual(previous);
      previous = sink.events.length;
    }
  });

  it("PPQ 기준 dur 계산이 음수가 되지 않는다", () => {
    const song = buildDemoSong();
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(song, clock, sink);
    scheduler.start(0);
    run(scheduler, clock, 33);
    for (const event of sink.events) {
      expect(event.dur).toBeGreaterThan(0);
      expect(Number.isFinite(event.when)).toBe(true);
    }
    expect(PPQ).toBe(480);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "@/lib/audio/scheduler"`

- [ ] **Step 4: `lib/audio/scheduler.ts` 작성**

```ts
import { PPQ, type Song } from "@/lib/score/types";

import type { AudioClock, NoteSink } from "./types";

/**
 * look-ahead 스케줄러.
 *
 * 타이머가 얼마나 정확한지에 의존하지 않는다. 타이머의 역할은 "충분히 미리
 * 예약했는가"뿐이고, 한 번 예약된 노드는 타이머가 늦어도 정확한 시각에 울린다.
 *
 * 시각 계산은 앵커 방식이다. 재생 위치를 pos += delta로 굴리지 않고 항상
 * 정수 앵커에서 다시 계산하므로 부동소수 오차가 쌓이지 않는다.
 */
export class Scheduler {
  private readonly song: Song;
  private readonly clock: AudioClock;
  private readonly sink: NoteSink;
  private readonly lookahead: number;

  /** 라인별 "다음에 예약할 타일" 인덱스. 전체 스캔을 피하는 장치. */
  private cursors: number[] = [];

  private anchorTick = 0;
  private anchorTime = 0;
  private bpm: number;

  /** 이 틱보다 앞은 예약이 끝났다. setTempo가 앵커를 옮길 기준점. */
  private scheduledUntilTick = 0;

  /**
   * @param lookaheadSeconds 늘리면 안정적이지만 템포 변경 반응이 느려진다.
   *   0.1초는 25ms 타이머가 세 번 밀려도 버티는 값이다.
   */
  constructor(
    song: Song,
    clock: AudioClock,
    sink: NoteSink,
    lookaheadSeconds = 0.1,
  ) {
    this.song = song;
    this.clock = clock;
    this.sink = sink;
    this.lookahead = lookaheadSeconds;
    this.bpm = song.tempo;
  }

  get tempo(): number {
    return this.bpm;
  }

  /** @param atTime 곡의 0틱이 울릴 절대 시각. */
  start(atTime: number): void {
    this.anchorTime = atTime;
    this.anchorTick = 0;
    this.scheduledUntilTick = 0;
    this.cursors = this.song.lines.map(() => 0);
  }

  tickToTime(tick: number): number {
    return this.anchorTime + ((tick - this.anchorTick) / PPQ) * (60 / this.bpm);
  }

  timeToTick(time: number): number {
    return this.anchorTick + (((time - this.anchorTime) * this.bpm) / 60) * PPQ;
  }

  /** 표시용 현재 틱. 재생 중이 아니면 의미가 없다. */
  currentTick(): number {
    return this.timeToTick(this.clock.currentTime);
  }

  isDone(): boolean {
    return this.song.lines.every(
      (line, i) => this.cursors[i] >= line.tiles.length,
    );
  }

  /** 타이머가 부를 때마다 lookahead 구간 안의 타일을 예약한다. */
  advance(): void {
    const horizonTime = this.clock.currentTime + this.lookahead;
    const horizonTick = this.timeToTick(horizonTime);

    this.song.lines.forEach((line, i) => {
      let cursor = this.cursors[i];

      while (cursor < line.tiles.length) {
        const tile = line.tiles[cursor];
        // 경계에 정확히 걸친 타일은 다음 틱으로 넘긴다
        if (tile.start >= horizonTick) break;

        const when = this.tickToTime(tile.start);
        const dur = (tile.length / PPQ) * (60 / this.bpm);
        for (const note of tile.notes) {
          this.sink.schedule(line.id, note, when, dur, tile.velocity);
        }
        cursor++;
      }

      this.cursors[i] = cursor;
    });

    if (horizonTick > this.scheduledUntilTick) {
      this.scheduledUntilTick = horizonTick;
    }
  }

  /**
   * 앵커를 "이미 예약이 끝난 경계"로 옮기고 새 BPM을 넣는다.
   * 이미 예약된 노트는 옛 템포로 그대로 울리고, 그 다음부터 새 템포가
   * 이어져 틈도 겹침도 생기지 않는다.
   */
  setTempo(bpm: number): void {
    const boundary = this.scheduledUntilTick;
    this.anchorTime = this.tickToTime(boundary);
    this.anchorTick = boundary;
    this.bpm = bpm;
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS — `time` / `fixture` / `scheduler` 테스트가 모두 통과

- [ ] **Step 6: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add lib/audio/types.ts lib/audio/scheduler.ts lib/audio/scheduler.test.ts
git commit -m "feat(audio): look-ahead 스케줄러와 앵커 기반 시간 변환 추가"
```

---

## Task 4: AudioContext 수명주기와 엔벨로프 헬퍼

**Files:**
- Create: `lib/audio/context.ts`
- Create: `lib/audio/env.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `isAudioSupported(): boolean`
  - `getAudioContext(): AudioContext`
  - `ensureRunning(): Promise<void>`
  - `midiToFreq(note: number): number`
  - `applyEnvelope(param: AudioParam, when: number, peak: number, attack: number, decay: number): void`
  - `fadeOutAndStop(param: AudioParam, when: number, seconds?: number): void`

- [ ] **Step 1: `lib/audio/context.ts` 작성**

모듈 스코프에서 `new AudioContext()`를 부르지 않는 것이 핵심이다. 부르면 서버 렌더링과 빌드 중에 실행되어 `AudioContext is not defined`로 깨진다.

```ts
"use client";

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let ctx: AudioContext | null = null;

function getConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as WebkitWindow).webkitAudioContext ?? null;
}

export function isAudioSupported(): boolean {
  return getConstructor() !== null;
}

/**
 * 앱 전체에 AudioContext는 하나다. 반드시 사용자 제스처 핸들러 안에서
 * 처음 호출해야 한다.
 */
export function getAudioContext(): AudioContext {
  if (ctx) return ctx;

  const Ctor = getConstructor();
  if (!Ctor) {
    throw new Error("이 브라우저는 Web Audio를 지원하지 않습니다.");
  }
  ctx = new Ctor();
  return ctx;
}

/**
 * 자동재생 정책상 컨텍스트는 suspended로 시작한다. 사용자 제스처 핸들러
 * 안에서 이걸 await해야 소리가 난다. 탭이 백그라운드에 다녀오면 다시
 * suspended가 될 수 있어 재생 시작마다 부른다.
 */
export async function ensureRunning(): Promise<void> {
  const context = getAudioContext();
  if (context.state !== "running") {
    await context.resume();
  }
}
```

- [ ] **Step 2: `lib/audio/env.ts` 작성**

```ts
"use client";

/** A4(69) = 440Hz 기준 평균율. */
export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * attack까지 peak로 올렸다가 decay 동안 떨어뜨린다.
 *
 * exponentialRampToValueAtTime의 목표값은 0이 될 수 없다(예외가 난다).
 * 0.0001까지 내린 뒤 setValueAtTime(0)으로 마무리한다.
 */
export function applyEnvelope(
  param: AudioParam,
  when: number,
  peak: number,
  attack: number,
  decay: number,
): void {
  const floor = 0.0001;
  param.setValueAtTime(floor, when);
  param.linearRampToValueAtTime(Math.max(peak, floor), when + attack);
  param.exponentialRampToValueAtTime(floor, when + attack + decay);
  param.setValueAtTime(0, when + attack + decay);
}

/**
 * 지금 값에서 짧게 페이드아웃시킨다. 뚝 자르면 클릭 노이즈가 난다.
 * voice stealing과 정지에서 쓴다.
 */
export function fadeOutAndStop(
  param: AudioParam,
  when: number,
  seconds = 0.005,
): void {
  const floor = 0.0001;
  param.cancelScheduledValues(when);
  param.setValueAtTime(Math.max(param.value, floor), when);
  param.exponentialRampToValueAtTime(floor, when + seconds);
  param.setValueAtTime(0, when + seconds);
}
```

- [ ] **Step 3: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add lib/audio/context.ts lib/audio/env.ts
git commit -m "feat(audio): AudioContext 지연 생성과 엔벨로프 헬퍼 추가"
```

---

## Task 5: 보이스 풀과 신스 악기 4종

**Files:**
- Create: `lib/audio/voices.ts`
- Create: `lib/audio/instruments/piano.ts`
- Create: `lib/audio/instruments/guitar.ts`
- Create: `lib/audio/instruments/bass.ts`
- Create: `lib/audio/instruments/drums.ts`
- Create: `lib/audio/instruments/index.ts`

**Interfaces:**
- Consumes: Task 3의 `Instrument`; Task 4의 `midiToFreq`, `applyEnvelope`, `fadeOutAndStop`; Task 1의 `InstrumentId`, `DRUM_KICK`, `DRUM_SNARE`, `DRUM_HIHAT`
- Produces:
  - `class VoicePool` — `constructor(ctx: AudioContext, out: AudioNode, max?: number)`, `acquire(when: number, endsAt: number): GainNode`, `releaseAll(when: number): void`
  - `createPiano(ctx: AudioContext, pool: VoicePool): Instrument`
  - `createGuitar(ctx: AudioContext, pool: VoicePool): Instrument`
  - `createBass(ctx: AudioContext, pool: VoicePool): Instrument`
  - `createDrums(ctx: AudioContext, pool: VoicePool): Instrument`
  - `createInstrument(id: InstrumentId, ctx: AudioContext, pool: VoicePool): Instrument`

- [ ] **Step 1: `lib/audio/voices.ts` 작성**

```ts
"use client";

import { fadeOutAndStop } from "./env";

type ActiveVoice = {
  gain: GainNode;
  endsAt: number;
};

/**
 * 동시 발음 수에 상한을 둔다. 드럼 연타나 코드 스트로크에서 보이스가
 * 무제한으로 늘면 클리핑과 CPU 스파이크가 난다. 상한을 넘으면 가장 오래된
 * 보이스를 페이드아웃시켜 훔친다.
 */
export class VoicePool {
  private active: ActiveVoice[] = [];

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly max = 32,
  ) {}

  /**
   * 이 보이스의 게인 노드를 돌려준다. 호출자는 여기에 소스를 연결하고
   * 엔벨로프를 예약한다.
   */
  acquire(when: number, endsAt: number): GainNode {
    this.reap(when);

    if (this.active.length >= this.max) {
      const oldest = this.active.shift();
      if (oldest) {
        fadeOutAndStop(oldest.gain.gain, when);
      }
    }

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.out);

    // 노드는 일회용이다. 회수하지 않으면 긴 곡에서 수천 개가 쌓인다.
    const entry: ActiveVoice = { gain, endsAt };
    this.active.push(entry);

    return gain;
  }

  /** 정지할 때 울리고 있는 것을 전부 끊는다. */
  releaseAll(when: number): void {
    const releasing = this.active;
    this.active = [];

    for (const voice of releasing) {
      fadeOutAndStop(voice.gain.gain, when);
    }

    // 페이드가 끝난 뒤 노드를 회수한다. 여기서 바로 disconnect하면
    // 페이드가 잘려 클릭 노이즈가 난다. 오디오 예약이 아니라 정리용
    // 타이머이므로 setTimeout을 써도 된다.
    window.setTimeout(() => {
      for (const voice of releasing) {
        voice.gain.disconnect();
      }
    }, 50);
  }

  private reap(now: number): void {
    const still: ActiveVoice[] = [];
    for (const voice of this.active) {
      if (voice.endsAt > now) {
        still.push(voice);
      } else {
        voice.gain.disconnect();
      }
    }
    this.active = still;
  }
}
```

- [ ] **Step 2: `lib/audio/instruments/piano.ts` 작성**

```ts
"use client";

import { applyEnvelope, midiToFreq } from "../env";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";

/** sine 기음 + 두 배음. 빠른 attack, 지수 감쇠. */
export function createPiano(ctx: AudioContext, pool: VoicePool): Instrument {
  const PARTIALS = [
    { ratio: 1, amp: 1 },
    { ratio: 2, amp: 0.35 },
    { ratio: 3, amp: 0.12 },
  ];

  return {
    play(note, when, dur, vel) {
      const freq = midiToFreq(note);
      const attack = 0.005;
      const decay = Math.max(dur, 0.3);
      const gain = pool.acquire(when, when + attack + decay);

      applyEnvelope(gain.gain, when, vel * 0.3, attack, decay);

      for (const partial of PARTIALS) {
        const osc = ctx.createOscillator();
        const partialGain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq * partial.ratio, when);
        partialGain.gain.setValueAtTime(partial.amp, when);
        osc.connect(partialGain);
        partialGain.connect(gain);
        osc.start(when);
        osc.stop(when + attack + decay + 0.05);
        osc.onended = () => {
          osc.disconnect();
          partialGain.disconnect();
        };
      }
    },
  };
}
```

- [ ] **Step 3: `lib/audio/instruments/guitar.ts` 작성**

```ts
"use client";

import { applyEnvelope, midiToFreq } from "../env";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";

/** sawtooth + 로우패스, 약간의 디튠으로 두께를 준다. */
export function createGuitar(ctx: AudioContext, pool: VoicePool): Instrument {
  const DETUNE_CENTS = [-6, 6];

  return {
    play(note, when, dur, vel) {
      const freq = midiToFreq(note);
      const attack = 0.008;
      const decay = Math.max(dur * 0.9, 0.25);
      const gain = pool.acquire(when, when + attack + decay);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(Math.min(freq * 6, 6000), when);
      filter.Q.setValueAtTime(0.7, when);
      filter.connect(gain);

      applyEnvelope(gain.gain, when, vel * 0.22, attack, decay);

      for (const cents of DETUNE_CENTS) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, when);
        osc.detune.setValueAtTime(cents, when);
        osc.connect(filter);
        osc.start(when);
        osc.stop(when + attack + decay + 0.05);
        osc.onended = () => osc.disconnect();
      }
    },
  };
}
```

- [ ] **Step 4: `lib/audio/instruments/bass.ts` 작성**

```ts
"use client";

import { applyEnvelope, midiToFreq } from "../env";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";

/** sine 저음 + 소프트 클립으로 배음을 살짝 만든다. */
export function createBass(ctx: AudioContext, pool: VoicePool): Instrument {
  // 부드러운 tanh 곡선. 매 노트마다 만들지 않도록 한 번만 계산한다.
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2);
  }

  return {
    play(note, when, dur, vel) {
      const freq = midiToFreq(note);
      const attack = 0.01;
      const decay = Math.max(dur * 0.95, 0.2);
      const gain = pool.acquire(when, when + attack + decay);

      const shaper = ctx.createWaveShaper();
      shaper.curve = curve;
      shaper.connect(gain);

      applyEnvelope(gain.gain, when, vel * 0.35, attack, decay);

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, when);
      osc.connect(shaper);
      osc.start(when);
      osc.stop(when + attack + decay + 0.05);
      osc.onended = () => {
        osc.disconnect();
        shaper.disconnect();
      };
    },
  };
}
```

- [ ] **Step 5: `lib/audio/instruments/drums.ts` 작성**

```ts
"use client";

import { DRUM_HIHAT, DRUM_KICK, DRUM_SNARE } from "@/lib/score/types";

import { applyEnvelope } from "../env";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";

/** 노이즈 버퍼는 한 번만 만들어 재사용한다. 매 노트마다 만들면 GC가 돈다. */
function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export function createDrums(ctx: AudioContext, pool: VoicePool): Instrument {
  const noise = createNoiseBuffer(ctx);

  function playKick(when: number, vel: number): void {
    const decay = 0.35;
    const gain = pool.acquire(when, when + decay);
    applyEnvelope(gain.gain, when, vel * 0.9, 0.002, decay);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    // 피치 드롭이 킥의 정체다
    osc.frequency.setValueAtTime(140, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
    osc.connect(gain);
    osc.start(when);
    osc.stop(when + decay + 0.02);
    osc.onended = () => osc.disconnect();
  }

  function playNoiseHit(
    when: number,
    vel: number,
    decay: number,
    filterType: BiquadFilterType,
    frequency: number,
    peak: number,
  ): void {
    const gain = pool.acquire(when, when + decay);
    applyEnvelope(gain.gain, when, vel * peak, 0.001, decay);

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, when);
    filter.connect(gain);

    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.connect(filter);
    source.start(when);
    source.stop(when + decay + 0.02);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
    };
  }

  return {
    play(note, when, _dur, vel) {
      if (note === DRUM_KICK) {
        playKick(when, vel);
      } else if (note === DRUM_SNARE) {
        playNoiseHit(when, vel, 0.18, "bandpass", 1800, 0.5);
      } else if (note === DRUM_HIHAT) {
        playNoiseHit(when, vel, 0.05, "highpass", 7000, 0.3);
      }
      // 알 수 없는 드럼 번호는 조용히 무시한다 — 소리 없는 편이 낫다
    },
  };
}
```

- [ ] **Step 6: `lib/audio/instruments/index.ts` 작성**

```ts
"use client";

import type { InstrumentId } from "@/lib/score/types";

import type { Instrument } from "../types";
import type { VoicePool } from "../voices";
import { createBass } from "./bass";
import { createDrums } from "./drums";
import { createGuitar } from "./guitar";
import { createPiano } from "./piano";

export function createInstrument(
  id: InstrumentId,
  ctx: AudioContext,
  pool: VoicePool,
): Instrument {
  switch (id) {
    case "piano":
      return createPiano(ctx, pool);
    case "guitar":
      return createGuitar(ctx, pool);
    case "bass":
      return createBass(ctx, pool);
    case "drums":
      return createDrums(ctx, pool);
  }
}
```

- [ ] **Step 7: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음. `createInstrument`의 switch가 `InstrumentId`를 모두 덮으므로 반환 타입 오류가 없어야 한다.

- [ ] **Step 8: 커밋**

```bash
git add lib/audio/voices.ts lib/audio/instruments/
git commit -m "feat(audio): 보이스 풀과 오실레이터 신스 악기 4종 추가"
```

---

## Task 6: 메트로놈과 엔진

**Files:**
- Create: `lib/audio/metronome.ts`
- Create: `lib/audio/engine.ts`

**Interfaces:**
- Consumes: Task 3의 `Scheduler`, `NoteSink`, `Instrument`; Task 4의 `getAudioContext`, `ensureRunning`, `applyEnvelope`; Task 5의 `VoicePool`, `createInstrument`; Task 1의 `Song`, `PPQ`, `ticksPerBar`
- Produces:
  - `createMetronome(ctx: AudioContext, out: AudioNode): { click(when: number, accent: boolean): void }`
  - `class Engine`
    - `constructor(song: Song)`
    - `play(): Promise<void>`
    - `stop(): void`
    - `setTempo(bpm: number): void`
    - `setMetronome(on: boolean): void`
    - `currentTick(): number`
    - `isPlaying(): boolean`
    - `dispose(): void`
    - `onStop: (() => void) | null` — 곡이 끝나 스스로 멈출 때 불린다

- [ ] **Step 1: `lib/audio/metronome.ts` 작성**

```ts
"use client";

import { applyEnvelope } from "./env";

export type Metronome = {
  click(when: number, accent: boolean): void;
};

/** 곡 데이터에 들어가지 않는다. 엔진이 직접 예약하는 짧은 클릭이다. */
export function createMetronome(ctx: AudioContext, out: AudioNode): Metronome {
  return {
    click(when, accent) {
      const decay = 0.03;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(out);

      applyEnvelope(gain.gain, when, accent ? 0.25 : 0.15, 0.001, decay);

      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(accent ? 1600 : 1000, when);
      osc.connect(gain);
      osc.start(when);
      osc.stop(when + decay + 0.02);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    },
  };
}
```

- [ ] **Step 2: `lib/audio/engine.ts` 작성**

```ts
"use client";

import { ticksPerBar } from "@/lib/score/time";
import { PPQ, type Song } from "@/lib/score/types";

import { ensureRunning, getAudioContext } from "./context";
import { createInstrument } from "./instruments";
import { createMetronome, type Metronome } from "./metronome";
import { Scheduler } from "./scheduler";
import type { Instrument, NoteSink } from "./types";
import { VoicePool } from "./voices";

const TIMER_MS = 25;
const MASTER_GAIN = 0.7;
const START_DELAY = 0.05;

/**
 * 노드 그래프와 재생 상태를 소유한다. React를 import하지 않는다.
 * UI는 명령형 메서드로만 이 레이어를 건드린다.
 */
export class Engine {
  private readonly song: Song;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pool: VoicePool | null = null;
  private metronome: Metronome | null = null;
  private instruments = new Map<string, Instrument>();

  private scheduler: Scheduler | null = null;
  private timerId: number | null = null;
  private playing = false;
  private metronomeOn = false;
  private bpm: number;

  /** 다음에 예약할 메트로놈 박의 틱. */
  private nextClickTick = 0;

  onStop: (() => void) | null = null;

  constructor(song: Song) {
    this.song = song;
    this.bpm = song.tempo;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  currentTick(): number {
    if (!this.scheduler || !this.playing) return 0;
    return Math.max(0, this.scheduler.currentTick());
  }

  /** 반드시 사용자 제스처 핸들러 안에서 await할 것. */
  async play(): Promise<void> {
    if (this.playing) return;

    const ctx = getAudioContext();
    await ensureRunning();
    this.ctx = ctx;

    this.buildGraph(ctx);

    const sink: NoteSink = {
      schedule: (lineId, note, when, dur, vel) => {
        this.instruments.get(lineId)?.play(note, when, dur, vel);
      },
    };

    const startTime = ctx.currentTime + START_DELAY;
    this.scheduler = new Scheduler(this.song, ctx, sink);
    this.scheduler.setTempo(this.bpm);
    this.scheduler.start(startTime);
    this.nextClickTick = 0;

    this.playing = true;
    this.timerId = window.setInterval(() => this.onTimer(), TIMER_MS);
    this.onTimer();
  }

  stop(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.ctx && this.pool) {
      this.pool.releaseAll(this.ctx.currentTime);
    }
    this.scheduler = null;
    this.playing = false;
  }

  setTempo(bpm: number): void {
    this.bpm = bpm;
    this.scheduler?.setTempo(bpm);
  }

  setMetronome(on: boolean): void {
    this.metronomeOn = on;
    if (on && this.scheduler) {
      // 지금 지나간 박부터 다시 잡는다 — 과거에 예약하면 한꺼번에 울린다
      const beat = PPQ * (4 / this.song.timeSignature[1]);
      this.nextClickTick =
        Math.ceil(this.scheduler.currentTick() / beat) * beat;
    }
  }

  dispose(): void {
    this.stop();
    this.instruments.clear();
    this.master?.disconnect();
    this.master = null;
    this.pool = null;
    this.metronome = null;
    this.ctx = null;
  }

  private buildGraph(ctx: AudioContext): void {
    if (this.master) return;

    // 악기 4종이 동시에 울리면 합산 진폭이 1.0을 넘어 클리핑이 난다
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);

    const pool = new VoicePool(ctx, master);

    for (const line of this.song.lines) {
      this.instruments.set(line.id, createInstrument(line.instrument, ctx, pool));
    }

    this.master = master;
    this.pool = pool;
    this.metronome = createMetronome(ctx, master);
  }

  private onTimer(): void {
    const scheduler = this.scheduler;
    if (!scheduler || !this.ctx) return;

    scheduler.advance();

    if (this.metronomeOn) {
      this.scheduleClicks(scheduler);
    }

    // 곡 끝을 지나면 스스로 멈춘다
    if (scheduler.currentTick() > this.song.lengthTicks) {
      this.stop();
      this.onStop?.();
    }
  }

  private scheduleClicks(scheduler: Scheduler): void {
    if (!this.ctx || !this.metronome) return;

    const beat = PPQ * (4 / this.song.timeSignature[1]);
    const perBar = ticksPerBar(this.song.timeSignature);
    const horizon = this.ctx.currentTime + 0.1;

    while (this.nextClickTick <= this.song.lengthTicks) {
      const when = scheduler.tickToTime(this.nextClickTick);
      if (when >= horizon) break;
      if (when >= this.ctx.currentTime) {
        this.metronome.click(when, this.nextClickTick % perBar === 0);
      }
      this.nextClickTick += beat;
    }
  }
}
```

- [ ] **Step 3: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add lib/audio/metronome.ts lib/audio/engine.ts
git commit -m "feat(audio): 엔진과 메트로놈 추가"
```

---

## Task 7: StudioProvider

**Files:**
- Create: `state/StudioProvider.tsx`

**Interfaces:**
- Consumes: Task 6의 `Engine`; Task 4의 `isAudioSupported`; Task 2의 `buildDemoSong`; Task 1의 `Song`, `ticksToBarBeat`
- Produces:
  - `StudioProvider({ children }: { children: React.ReactNode })`
  - `useStudio(): StudioValue`
  - ```ts
    type StudioValue = {
      song: Song;
      isPlaying: boolean;
      tempo: number;
      metronome: boolean;
      position: { bar: number; beat: number };
      supported: boolean;
      error: string | null;
      play: () => void;
      stop: () => void;
      setTempo: (bpm: number) => void;
      setMetronome: (on: boolean) => void;
      currentTick: () => number;
    };
    ```

- [ ] **Step 1: `state/StudioProvider.tsx` 작성**

`position`만 10Hz로 샘플링하고, 플래그 위치는 여기 들어오지 않는다. 플래그는 Task 9에서 `currentTick()`을 rAF로 직접 읽는다.

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { isAudioSupported } from "@/lib/audio/context";
import { Engine } from "@/lib/audio/engine";
import { buildDemoSong } from "@/lib/score/fixture";
import { ticksToBarBeat } from "@/lib/score/time";
import type { Song } from "@/lib/score/types";

const POSITION_SAMPLE_MS = 100;

export type StudioValue = {
  song: Song;
  isPlaying: boolean;
  tempo: number;
  metronome: boolean;
  position: { bar: number; beat: number };
  supported: boolean;
  error: string | null;
  play: () => void;
  stop: () => void;
  setTempo: (bpm: number) => void;
  setMetronome: (on: boolean) => void;
  currentTick: () => number;
};

const StudioContext = createContext<StudioValue | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const song = useMemo(() => buildDemoSong(), []);
  const engineRef = useRef<Engine | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [tempo, setTempoState] = useState(song.tempo);
  const [metronome, setMetronomeState] = useState(false);
  const [position, setPosition] = useState({ bar: 1, beat: 1 });
  // SSR에서는 window가 없다. 마운트 후에 판정한다.
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(isAudioSupported());
  }, []);

  const getEngine = useCallback((): Engine => {
    if (!engineRef.current) {
      const engine = new Engine(song);
      engine.onStop = () => setIsPlaying(false);
      engineRef.current = engine;
    }
    return engineRef.current;
  }, [song]);

  // 언마운트 시 타이머와 노드를 정리한다
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // 표시용 위치만 10Hz로 샘플링한다. 매 프레임 값이 아니다.
  useEffect(() => {
    if (!isPlaying) return;

    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setPosition(ticksToBarBeat(engine.currentTick(), song.timeSignature));
    }, POSITION_SAMPLE_MS);

    return () => window.clearInterval(id);
  }, [isPlaying, song.timeSignature]);

  const play = useCallback(() => {
    setError(null);
    // 이 호출은 클릭 핸들러 안에서 시작되므로 resume이 허용된다
    getEngine()
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => {
        setIsPlaying(false);
        setError("소리를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.");
      });
  }, [getEngine]);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    setIsPlaying(false);
    setPosition({ bar: 1, beat: 1 });
  }, []);

  const setTempo = useCallback(
    (bpm: number) => {
      setTempoState(bpm);
      getEngine().setTempo(bpm);
    },
    [getEngine],
  );

  const setMetronome = useCallback(
    (on: boolean) => {
      setMetronomeState(on);
      getEngine().setMetronome(on);
    },
    [getEngine],
  );

  const currentTick = useCallback(() => {
    return engineRef.current?.currentTick() ?? 0;
  }, []);

  const value = useMemo<StudioValue>(
    () => ({
      song,
      isPlaying,
      tempo,
      metronome,
      position,
      supported,
      error,
      play,
      stop,
      setTempo,
      setMetronome,
      currentTick,
    }),
    [
      song,
      isPlaying,
      tempo,
      metronome,
      position,
      supported,
      error,
      play,
      stop,
      setTempo,
      setMetronome,
      currentTick,
    ],
  );

  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}

export function useStudio(): StudioValue {
  const value = useContext(StudioContext);
  if (!value) {
    throw new Error("useStudio는 StudioProvider 안에서만 쓸 수 있습니다.");
  }
  return value;
}
```

- [ ] **Step 2: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add state/StudioProvider.tsx
git commit -m "feat(state): 엔진과 React 상태를 잇는 StudioProvider 추가"
```

---

## Task 8: 타임라인 렌더링 (읽기 전용)

**Files:**
- Create: `components/timeline/layout.ts`
- Create: `components/timeline/BarLines.tsx`
- Create: `components/timeline/TileLine.tsx`
- Create: `components/timeline/DrumGrid.tsx`
- Create: `components/timeline/LineHeaders.tsx`
- Create: `components/timeline/Timeline.tsx`
- Create: `lib/score/notes.ts`

**Interfaces:**
- Consumes: Task 7의 `useStudio`; Task 1의 `Line`, `Tile`, `LineKind`, `PPQ`, `ticksPerBar`, 드럼 상수
- Produces:
  - `PX_PER_BAR: 120`, `PITCHED_LINE_HEIGHT: 32`, `DRUM_ROW_HEIGHT: 20`, `DRUM_LINE_HEIGHT: 60`, `DRUM_ROWS: readonly [36, 38, 42]`
  - `tickToPx(tick: number, perBar: number): number`
  - `lineHeight(kind: LineKind): number`
  - `midiToName(note: number): string`
  - `<Timeline />`, `<BarLines />`, `<TileLine />`, `<DrumGrid />`, `<LineHeaders />`

- [ ] **Step 1: `lib/score/notes.ts` 작성**

```ts
const NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/** MIDI 60 → "C4". 타일에 표시할 이름을 만든다. */
export function midiToName(note: number): string {
  const octave = Math.floor(note / 12) - 1;
  return `${NAMES[((note % 12) + 12) % 12]}${octave}`;
}
```

- [ ] **Step 2: `components/timeline/layout.ts` 작성**

```ts
import { DRUM_HIHAT, DRUM_KICK, DRUM_SNARE, type LineKind } from "@/lib/score/types";

export const PX_PER_BAR = 120;
export const PITCHED_LINE_HEIGHT = 32;
export const DRUM_ROW_HEIGHT = 20;
export const DRUM_ROWS = [DRUM_KICK, DRUM_SNARE, DRUM_HIHAT] as const;
export const DRUM_LINE_HEIGHT = DRUM_ROW_HEIGHT * DRUM_ROWS.length;
export const HEADER_WIDTH = 88;

/** @param perBar ticksPerBar(song.timeSignature) */
export function tickToPx(tick: number, perBar: number): number {
  return (tick / perBar) * PX_PER_BAR;
}

/** 라인 높이는 데이터에서 계산하지 않고 kind별 상수로 둔다. */
export function lineHeight(kind: LineKind): number {
  return kind === "drum" ? DRUM_LINE_HEIGHT : PITCHED_LINE_HEIGHT;
}
```

- [ ] **Step 3: `components/timeline/BarLines.tsx` 작성**

DOM 노드를 만들지 않고 CSS 그라디언트로만 그린다.

```tsx
import { PX_PER_BAR } from "./layout";

/** 마디선과 박선. repeating-linear-gradient라 DOM 노드가 0개다. */
export function BarLines({ width }: { width: number }) {
  const beatWidth = PX_PER_BAR / 4;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0"
      style={{
        width,
        backgroundImage: [
          `repeating-linear-gradient(to right, rgb(255 255 255 / 0.14) 0 1px, transparent 1px ${PX_PER_BAR}px)`,
          `repeating-linear-gradient(to right, rgb(255 255 255 / 0.05) 0 1px, transparent 1px ${beatWidth}px)`,
        ].join(","),
      }}
    />
  );
}
```

- [ ] **Step 4: `components/timeline/TileLine.tsx` 작성**

```tsx
import { midiToName } from "@/lib/score/notes";
import type { Line } from "@/lib/score/types";

import { PITCHED_LINE_HEIGHT, tickToPx } from "./layout";

const COLORS: Record<string, string> = {
  piano: "bg-indigo-500/30 border-indigo-400/70 text-indigo-100",
  guitar: "bg-emerald-500/30 border-emerald-400/70 text-emerald-100",
  bass: "bg-amber-500/30 border-amber-400/70 text-amber-100",
  drums: "bg-pink-500/30 border-pink-400/70 text-pink-100",
};

export function TileLine({ line, perBar }: { line: Line; perBar: number }) {
  const color = COLORS[line.instrument] ?? COLORS.piano;

  return (
    <div
      className="relative border-b border-white/10"
      style={{ height: PITCHED_LINE_HEIGHT }}
    >
      {line.tiles.map((tile) => (
        <div
          key={tile.id}
          className={`absolute top-1 flex items-center overflow-hidden rounded border px-1 text-[10px] leading-none whitespace-nowrap ${color}`}
          style={{
            left: tickToPx(tile.start, perBar),
            width: Math.max(tickToPx(tile.length, perBar) - 2, 4),
            height: PITCHED_LINE_HEIGHT - 8,
          }}
        >
          {tile.notes.map(midiToName).join("·")}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: `components/timeline/DrumGrid.tsx` 작성**

빈 칸을 DOM으로 만들지 않는 것이 핵심이다.

```tsx
import type { Line } from "@/lib/score/types";

import {
  DRUM_LINE_HEIGHT,
  DRUM_ROWS,
  DRUM_ROW_HEIGHT,
  PX_PER_BAR,
  tickToPx,
} from "./layout";

/** 16분음표 격자. 배경은 CSS로, 켜진 칸만 DOM 노드로 그린다. */
export function DrumGrid({ line, perBar }: { line: Line; perBar: number }) {
  const stepWidth = PX_PER_BAR / 16;

  return (
    <div
      className="relative border-b border-white/10"
      style={{
        height: DRUM_LINE_HEIGHT,
        backgroundImage: [
          `repeating-linear-gradient(to right, rgb(255 255 255 / 0.06) 0 1px, transparent 1px ${stepWidth}px)`,
          `repeating-linear-gradient(to bottom, rgb(255 255 255 / 0.08) 0 1px, transparent 1px ${DRUM_ROW_HEIGHT}px)`,
        ].join(","),
      }}
    >
      {line.tiles.map((tile) => {
        const row = DRUM_ROWS.indexOf(
          tile.notes[0] as (typeof DRUM_ROWS)[number],
        );
        if (row < 0) return null;

        return (
          <div
            key={tile.id}
            className="absolute rounded-sm border border-pink-300/70 bg-pink-500/45"
            style={{
              left: tickToPx(tile.start, perBar) + 1,
              top: row * DRUM_ROW_HEIGHT + 3,
              width: Math.max(tickToPx(tile.length, perBar) - 2, 4),
              height: DRUM_ROW_HEIGHT - 6,
            }}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: `components/timeline/LineHeaders.tsx` 작성**

```tsx
import type { Line } from "@/lib/score/types";

import { DRUM_ROWS, DRUM_ROW_HEIGHT, HEADER_WIDTH, lineHeight } from "./layout";

const DRUM_ROW_NAMES = ["킥", "스네어", "하이햇"];

export function LineHeaders({ lines }: { lines: Line[] }) {
  return (
    <div
      className="shrink-0 border-r border-white/15"
      style={{ width: HEADER_WIDTH }}
    >
      {lines.map((line) => (
        <div
          key={line.id}
          className="flex flex-col justify-center border-b border-white/10 px-2 text-xs text-zinc-300"
          style={{ height: lineHeight(line.kind) }}
        >
          {line.kind === "drum" ? (
            <>
              {DRUM_ROWS.map((_, i) => (
                <div
                  key={i}
                  className="flex items-center text-[10px] text-zinc-400"
                  style={{ height: DRUM_ROW_HEIGHT }}
                >
                  {DRUM_ROW_NAMES[i]}
                </div>
              ))}
            </>
          ) : (
            line.name
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: `components/timeline/Timeline.tsx` 작성**

Playflag는 Task 9에서 붙인다. 지금은 자리만 잡는다.

```tsx
"use client";

import { useRef } from "react";

import { ticksPerBar } from "@/lib/score/time";

import { useStudio } from "@/state/StudioProvider";
import { BarLines } from "./BarLines";
import { DrumGrid } from "./DrumGrid";
import { LineHeaders } from "./LineHeaders";
import { TileLine } from "./TileLine";
import { tickToPx } from "./layout";

export function Timeline() {
  const { song } = useStudio();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const perBar = ticksPerBar(song.timeSignature);
  const stageWidth = tickToPx(song.lengthTicks, perBar);

  return (
    <div className="flex overflow-hidden rounded-lg border border-white/15 bg-zinc-900">
      <LineHeaders lines={song.lines} />
      <div ref={scrollerRef} className="flex-1 overflow-x-auto">
        <div className="relative" style={{ width: stageWidth }}>
          <BarLines width={stageWidth} />
          {song.lines.map((line) =>
            line.kind === "drum" ? (
              <DrumGrid key={line.id} line={line} perBar={perBar} />
            ) : (
              <TileLine key={line.id} line={line} perBar={perBar} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음

- [ ] **Step 9: 커밋**

```bash
git add lib/score/notes.ts components/timeline/
git commit -m "feat(editor): 읽기 전용 타임라인 렌더링 추가"
```

---

## Task 9: 플레이 플래그와 자동 스크롤

**Files:**
- Create: `components/timeline/Playflag.tsx`
- Modify: `components/timeline/Timeline.tsx` (Playflag 삽입, `scrollerRef` 전달)

**Interfaces:**
- Consumes: Task 7의 `useStudio`(`isPlaying`, `currentTick`); Task 8의 `tickToPx`
- Produces: `<Playflag scrollerRef={...} perBar={...} />`

- [ ] **Step 1: `components/timeline/Playflag.tsx` 작성**

React를 통과하지 않는다. rAF에서 DOM에 직접 쓴다.

```tsx
"use client";

import { useEffect, useRef } from "react";

import { useStudio } from "@/state/StudioProvider";
import { tickToPx } from "./layout";

/** 플래그가 이 비율을 넘어가면 스크롤이 따라간다. */
const FOLLOW_THRESHOLD = 0.75;

export function Playflag({
  scrollerRef,
  perBar,
}: {
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  perBar: number;
}) {
  const { isPlaying, currentTick } = useStudio();
  const flagRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPlaying) {
      // 정지하면 처음으로 되돌린다
      if (flagRef.current) {
        flagRef.current.style.transform = "translateX(0px)";
      }
      return;
    }

    let raf = 0;

    const frame = () => {
      const px = tickToPx(currentTick(), perBar);

      if (flagRef.current) {
        // transform만 바꾼다 — 레이아웃이 다시 계산되지 않는다
        flagRef.current.style.transform = `translateX(${px}px)`;
      }

      const scroller = scrollerRef.current;
      if (
        scroller &&
        px - scroller.scrollLeft > scroller.clientWidth * FOLLOW_THRESHOLD
      ) {
        scroller.scrollLeft = px - scroller.clientWidth * 0.5;
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, currentTick, perBar, scrollerRef]);

  return (
    <div
      ref={flagRef}
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0 z-10 w-0.5 bg-red-500 will-change-transform"
    >
      <div className="absolute -top-0.5 -left-[3px] h-2 w-2 rounded-sm bg-red-500" />
    </div>
  );
}
```

- [ ] **Step 2: `components/timeline/Timeline.tsx` 수정**

`import { Playflag } from "./Playflag";`를 추가하고, `<BarLines ... />` 바로 아래가 아니라 라인들 **뒤에** 넣어 z-index 없이도 위에 오게 한다. 아래 블록으로 `<div className="relative" ...>` 안쪽을 교체한다.

```tsx
        <div className="relative" style={{ width: stageWidth }}>
          <BarLines width={stageWidth} />
          {song.lines.map((line) =>
            line.kind === "drum" ? (
              <DrumGrid key={line.id} line={line} perBar={perBar} />
            ) : (
              <TileLine key={line.id} line={line} perBar={perBar} />
            ),
          )}
          <Playflag scrollerRef={scrollerRef} perBar={perBar} />
        </div>
```

- [ ] **Step 3: 정적 검사**

Run: `pnpm lint && pnpm check-types`
Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add components/timeline/Playflag.tsx components/timeline/Timeline.tsx
git commit -m "feat(editor): rAF 플레이 플래그와 자동 스크롤 추가"
```

---

## Task 10: 트랜스포트 바와 페이지 연결

**Files:**
- Create: `components/transport/TransportBar.tsx`
- Modify: `app/page.tsx` (스캐폴드 전체 교체)
- Modify: `app/layout.tsx` (metadata만 교체)

**Interfaces:**
- Consumes: Task 7의 `useStudio` 전체
- Produces: `<TransportBar />`, Bandline 홈 페이지

- [ ] **Step 1: `components/transport/TransportBar.tsx` 작성**

```tsx
"use client";

import { useStudio } from "@/state/StudioProvider";

export function TransportBar() {
  const {
    isPlaying,
    tempo,
    metronome,
    position,
    supported,
    error,
    play,
    stop,
    setTempo,
    setMetronome,
  } = useStudio();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-white/15 bg-zinc-900 px-4 py-3">
        <button
          type="button"
          onClick={isPlaying ? stop : play}
          disabled={!supported}
          className="w-20 rounded bg-white/10 px-3 py-1.5 text-sm text-zinc-100 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPlaying ? "■ 정지" : "▶ 재생"}
        </button>

        <div className="font-mono text-sm tabular-nums text-zinc-300">
          {String(position.bar).padStart(3, "0")}:{position.beat}
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <span className="text-zinc-400">♩</span>
          <input
            type="range"
            min={40}
            max={240}
            step={1}
            value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
            className="w-40"
          />
          <span className="w-10 font-mono tabular-nums">{tempo}</span>
        </label>

        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={metronome}
            onChange={(e) => setMetronome(e.target.checked)}
          />
          메트로놈
        </label>
      </div>

      {!supported && (
        <p className="text-sm text-amber-400">
          이 브라우저는 Web Audio를 지원하지 않아 재생할 수 없습니다.
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: `app/page.tsx` 전체 교체**

```tsx
import { Timeline } from "@/components/timeline/Timeline";
import { TransportBar } from "@/components/transport/TransportBar";
import { StudioProvider } from "@/state/StudioProvider";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-950">
      <StudioProvider>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-10">
          <h1 className="text-lg font-semibold text-zinc-100">Bandline</h1>
          <TransportBar />
          <Timeline />
        </main>
      </StudioProvider>
    </div>
  );
}
```

- [ ] **Step 3: `app/layout.tsx`의 metadata 교체**

`metadata` 상수만 아래로 바꾼다. 나머지(폰트, RootLayout)는 그대로 둔다.

```tsx
export const metadata: Metadata = {
  title: "Bandline",
  description: "브라우저에서 직접 작곡하고 재생하는 웹 시퀀서",
};
```

- [ ] **Step 4: 정적 검사와 빌드**

Run: `pnpm lint && pnpm check-types && pnpm build`
Expected: 전부 성공. 빌드가 `AudioContext is not defined`로 깨지면 어딘가에서 모듈 스코프 생성이 일어난 것이다.

- [ ] **Step 5: 커밋**

```bash
git add components/transport/TransportBar.tsx app/page.tsx app/layout.tsx
git commit -m "feat(app): 트랜스포트 바와 스튜디오 페이지 연결"
```

---

## Task 11: 실제로 들어보고 고치기

**Files:**
- Modify: 이 단계에서 발견된 문제에 해당하는 파일

**Interfaces:**
- Consumes: Task 1~10 전부
- Produces: 없음 (검증 태스크)

정적 검사와 단위 테스트는 소리에 대해 아무것도 증명하지 않는다. 여기서 처음으로 귀를 쓴다.

- [ ] **Step 1: 개발 서버 실행**

```bash
pnpm dev
```

브라우저에서 http://localhost:3000 을 연다.

- [ ] **Step 2: 첫 소리 확인**

재생을 누른다. 기대: 피아노 화음, 기타, 베이스, 드럼이 동시에 들린다.

들리지 않으면 콘솔을 본다. `AudioContext was not allowed to start`가 보이면 `resume()`이 클릭 핸들러 밖에서 불린 것이다 — `StudioProvider.play`가 `getEngine().play()`를 동기적으로 시작하는지 확인한다.

- [ ] **Step 3: 드리프트 확인 (가장 중요)**

메트로놈을 켜고 16마디 32초를 끝까지 듣는다.

기대: 마지막 마디에서도 클릭과 곡의 킥·스네어가 정확히 겹친다. 뒤로 갈수록 벌어지면 어딘가에서 `pos += delta` 누적이 일어나고 있는 것이다 — `Scheduler.tickToTime`이 항상 앵커에서 계산하는지 확인한다.

- [ ] **Step 4: 글리치 확인**

하이햇이 8분음표로 계속 울리는 구간에서 뚝뚝 끊기는지 듣는다.

기대: 끊김 없음. 끊기면 메인 스레드가 막힌 것이다 — 재생 중 리렌더가 일어나는지 React DevTools Profiler로 확인한다. 플래그가 움직일 때 타임라인이 리렌더되면 안 된다.

- [ ] **Step 5: 템포 변경 확인**

재생 중에 템포 슬라이더를 120 → 200 → 80으로 움직인다.

기대: 소리가 끊기거나 한꺼번에 몰려 울리지 않고 자연스럽게 빨라지고 느려진다. 노트가 한꺼번에 터지면 `setTempo`가 앵커를 과거로 옮긴 것이다.

- [ ] **Step 6: 정지 확인**

재생 중 정지를 누른다.

기대: 딸깍하는 클릭 노이즈 없이 부드럽게 멎고, 플래그가 맨 앞으로 돌아간다.

- [ ] **Step 7: 자동 스크롤 확인**

재생하고 플래그가 화면 오른쪽 3/4 지점을 지날 때를 본다.

기대: 스크롤이 따라가 플래그가 화면 안에 남는다.

- [ ] **Step 8: 곡 끝 확인**

끝까지 재생한다.

기대: 16마디가 끝나면 스스로 멈추고 재생 버튼이 "▶ 재생"으로 돌아간다.

- [ ] **Step 9: 발견된 문제 수정 후 커밋**

문제를 고쳤다면 원인별로 나눠 커밋한다. 없으면 이 스텝을 건너뛴다.

```bash
git add <고친 파일>
git commit -m "fix(audio): <무엇이 왜 틀렸는지>"
```

---

## Task 12: 문서를 사실에 맞게 갱신

**Files:**
- Modify: `AGENTS.md` ("현재 상태" 절)
- Modify: `.claude/rules/frontend-architecture.md` ("현재 상태 vs 계획" 절)

**Interfaces:**
- Consumes: Task 1~11이 만든 실제 디렉터리 구조
- Produces: 없음

두 문서는 지금 "이 구조는 합의된 방향이지 현존하는 구조가 아니다"라고 적고 있다. 이 슬라이스가 실제로 만들었으므로 사실에 맞게 고친다. 설계 문서의 "구현 후 할 일"에 적힌 항목이다.

- [ ] **Step 1: `AGENTS.md`의 "현재 상태" 절 교체**

```markdown
## 현재 상태

읽기 전용 타임라인이 동작한다. `lib/score/`(곡 데이터·시간 변환), `lib/audio/`(AudioContext·look-ahead 스케줄러·신스 악기 4종), `state/StudioProvider.tsx`, `components/timeline/`, `components/transport/`가 실제로 존재한다.

하드코딩된 16마디 데모 곡(`lib/score/fixture.ts`)을 라인 위에 타일로 그리고, 재생하면 플레이 플래그가 지나가며 소리가 난다. **아직 편집은 없다** — 타일 생성·이동·길이 조절·삭제, 드럼 칸 토글, 루프, 시크, 줌, 저장/불러오기는 모두 미구현이다. 악기는 전부 오실레이터 신스이고 샘플은 없다.

설계 근거는 `docs/superpowers/specs/2026-07-31-tile-timeline-playback-design.md`에 있다.
```

- [ ] **Step 2: `.claude/rules/frontend-architecture.md`의 "현재 상태 vs 계획" 절 교체**

절 제목과 첫 문단을 아래로 바꾼다. 그 아래 디렉터리 트리 블록은 그대로 둔다.

```markdown
## 디렉터리 구조

아래 구조는 실제로 존재한다. `lib/score/`, `lib/audio/`, `state/`, `components/timeline/`, `components/transport/`가 모두 만들어져 있다. 아직 없는 것은 `components/ui/`(공용 컨트롤)와 `public/samples/`(악기 샘플)뿐이며, 이 둘은 각각 편집 UI 슬라이스와 샘플 음원 슬라이스에서 생긴다.
```

- [ ] **Step 3: 전체 검증**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: 전부 성공

- [ ] **Step 4: 커밋**

```bash
git add AGENTS.md .claude/rules/frontend-architecture.md
git commit -m "docs: 구현된 디렉터리 구조를 사실에 맞게 갱신"
```

---

## 완료 기준

- `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build`가 모두 통과한다
- 재생을 누르면 4개 라인이 동시에 소리를 낸다
- 메트로놈과 함께 32초를 완주해도 드리프트가 들리지 않는다
- 재생 중 템포를 바꿔도 소리가 끊기거나 몰리지 않는다
- 플래그가 움직일 때 타임라인이 리렌더되지 않는다 (React DevTools Profiler로 확인)
- 곡이 끝나면 스스로 멈춘다
