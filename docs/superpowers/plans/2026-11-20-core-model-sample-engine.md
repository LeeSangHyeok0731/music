# 코어 모델과 샘플 엔진 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bandline의 곡 데이터 모델을 "코드·패턴 클립 + 음 클립"(v2)으로 새로 만들고, 오디오 엔진을 그 모델과 샘플 재생 위에 다시 올린다.

**Architecture:** `lib/score/`는 순수 TS로 새 모델·펼치기(`expandSong`)·검증·스키마를 가진다. 스케줄러는 `Song`이 아니라 펼친 `TrackEvents[]`를 읽는다. 엔진은 `SampleBank`(fetch는 컨텍스트 없이, decode는 컨텍스트 생긴 뒤)를 거쳐 샘플 악기를 만들고, 샘플이 준비되지 않으면 재생을 시작하지 않는다. 옛 UI·상태 계층은 먼저 철거하고 소리 검증용 최소 화면만 남긴다.

**Tech Stack:** Next.js 16.2.12 App Router, React 19.2, TypeScript strict, zod 4.4.3, vitest 4.1.10(`projects`로 node/jsdom 분리), Web Audio, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-20-core-model-sample-engine-design.md`

## Global Constraints

- 시간 단위는 `PPQ = 480` 정수 틱이다. `Clip.start`·`Clip.length`·`Note.start`·`Note.length`는 정수다. `Note.start`는 **클립 시작 기준 상대 틱**이다.
- `bars`는 정수, 상한 500마디(`MAX_BARS`). 곡 길이는 `bars × ticksPerBar`로 파생한다(`lengthTicks` 필드는 없다).
- `InstrumentId`는 `"piano" | "guitar" | "bass" | "drums"`. `Chord.quality`는 `"maj" | "min" | "dom7" | "maj7" | "min7"`(닫힌 열거형, 추가만 허용).
- **같은 트랙의 클립은 시간상 겹치지 않는다.** 화음(같은 시각의 여러 음)은 `notes` 클립 안에서 항상 허용된다.
- **패턴 id는 불변이다.** 고치려면 새 id를 만든다. 패턴을 펼친 결과는 스냅샷 테스트로 지킨다.
- **재생과 내보내기는 같은 `expandSong`을 쓴다.**
- `Instrument.play(pitch, when, dur, velocity)` 시그니처는 샘플 악기로 바꿔도 유지한다.
- 스키마 정책: 구조 오류·알 수 없는 id/열거값·클립 겹침·클립이 곡 밖은 **거부**. 정렬·소수 틱(반올림)·범위를 넘은 velocity(클램프)·클립 밖으로 나간 음(끝에서 자름)은 **복구하고 알린다**.
- AudioContext는 앱 전체에 하나, **첫 사용자 제스처 뒤에 지연 생성**한다. 모듈 스코프에서 `new AudioContext()`를 부르지 않는다. 오디오를 만지는 파일에는 `"use client"`를 붙인다.
- 노트는 `setTimeout`/`rAF`로 울리지 않는다. look-ahead 스케줄러(25ms 타이머, 100ms lookahead)로 `ctx.currentTime` 절대 시각에 예약한다.
- 재생 중 매 프레임 값(플레이헤드)은 `useState`에 넣지 않는다.
- 샘플은 CC0·퍼블릭 도메인만. 첫 재생에 필요한 총량 약 5MB 이내.
- 샘플 파일 형식은 Task 15에서 Safari 디코드를 직접 확인한 뒤 확정한다. 그 전까지 코드는 형식에 무관해야 한다(`decodeAudioData`에 위임).
- 파일 내용을 정규식으로 파싱하는 테스트는 `\r?\n`을 쓴다(Windows CRLF 체크아웃).
- 패키지 매니저는 pnpm. 커밋 메시지는 `<type>(<scope>): <한국어 설명>`. 푸시하지 않는다.
- 이 머신에서는 git이 소유권 경고(`dubious ownership`)를 낸다. 전역 설정을 바꾸지 않고 명령마다 `git -c safe.directory=C:/Users/USER/Desktop/music <명령>`으로 쓴다. 아래 명령의 `git`은 모두 이 형태를 뜻한다.
- 프레임워크 레벨 코드(라우트·`app/`)를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 문서를 읽는다(`AGENTS.md`).
- `pnpm build`는 `next/font/google`이 폰트를 받으므로 네트워크가 막힌 환경에서는 실패할 수 있다. 그 경우 실패 원인을 그대로 기록하고 넘어간다(코드 문제로 오인하지 않는다).

## 작업 순서와 그 이유

모든 Task는 끝날 때 `pnpm lint`, `pnpm check-types`, `pnpm test`가 통과해야 한다(빌드는 표시된 Task에서).

```text
1  테스트 인프라 ─ 2  히스토리 규칙 이식 ─ 3  옛 UI·편집 계층 철거        ← 옛 모델과의 결합을 먼저 끊는다
4  새 모델 ─ 5  코드·패턴 ─ 6  검증 ─ 7  펼치기 ─ 8  스키마 ─ 9  데모 곡   ← lib/score 새로 짓기 (옛 types.ts와 공존)
10 Scheduler + Engine 이식 (원자적)                                       ← v2 모델 위로 옮기고 옛 fixture 삭제
11 SampleBank ─ 12 샘플 악기 + 엔진 게이팅                                ← 신스 제거, 샘플 준비 보장
13 검증 화면 + 개발용 톤 ─ 14 정리·문서                                   ← 사람이 귀로 확인할 화면
15 실제 샘플 팩 조달 (사용자 필요)
```

옛 `lib/score/types.ts`(옛 `Song`)는 Task 12 끝까지 남아 있다. 옛 신스 악기가 거기서 `InstrumentId`와 `DRUM_*`를 읽기 때문이다. 새 모델은 `lib/score/model.ts`에 만들어 이름이 겹치지 않는다.

---

### Task 1: 테스트 인프라 — node/jsdom 환경 분리

**Files:**
- Modify: `vitest.config.mts`
- Modify: `package.json` (devDependencies — pnpm이 갱신)
- Create: `components/dom-env.test.tsx` (스모크, Task 13에서 삭제)

**Interfaces:**
- Produces: `lib/**/*.test.ts`는 `node`, `state/**`·`components/**`의 `*.test.ts(x)`는 `jsdom`에서 돈다.

- [ ] **Step 1: vitest 4의 `projects` API를 설치된 버전에서 확인한다**

Run: `grep -n "projects?:" node_modules/vitest/dist/chunks/reporters.d.DtoKVV2s.d.ts`
Expected: `projects?: TestProjectConfiguration[];`가 한 줄 이상 나온다. (`environmentMatchGlobs`는 쓰지 않는다.)

- [ ] **Step 2: 의존성을 설치한다**

Run: `pnpm add -D jsdom @testing-library/react @testing-library/dom`
Expected: 세 패키지가 `devDependencies`에 추가되고 `pnpm-lock.yaml`이 갱신된다.

- [ ] **Step 3: 실패하는 스모크 테스트를 쓴다**

Create `components/dom-env.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

describe("dom 환경", () => {
  it("jsdom에서 컴포넌트를 렌더한다", () => {
    render(<p>hello</p>);
    expect(screen.getByText("hello")).toBeTruthy();
    expect(typeof document).toBe("object");
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `pnpm test components/dom-env.test.tsx`
Expected: FAIL — 현재 `include`에 `components/**`가 없어 "No test files found"가 난다.

- [ ] **Step 5: 설정을 나눈다**

Replace the whole of `vitest.config.mts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": rootDir },
  },
  // tsconfig의 jsx가 react-jsx여도 vite의 esbuild가 못 읽는 환경이 있어 명시한다.
  esbuild: { jsx: "automatic" },
  test: {
    projects: [
      {
        // lib/**는 브라우저 없이 돌아야 한다 — 그게 이 레이어의 계약이다.
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["lib/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: [
            "state/**/*.test.{ts,tsx}",
            "components/**/*.test.{ts,tsx}",
          ],
        },
      },
    ],
  },
});
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm test`
Expected: 기존 테스트가 전부 통과하고 `dom-env.test.tsx` 1개가 추가된다. (이 브랜치의 시작점 기준으로 12개 파일 186개 테스트 + 1개 파일 1개 테스트 = 13개 파일 187개 테스트. 숫자가 다르면 브랜치가 `main` 기준인지부터 확인한다 — `feat/piano-editor-page`에서는 237개다.)

- [ ] **Step 7: 전체 검사 후 커밋한다**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 모두 통과.

```bash
git add vitest.config.mts package.json pnpm-lock.yaml components/dom-env.test.tsx
git commit -m "chore(config): vitest를 node/jsdom 프로젝트로 나눈다"
```

---

### Task 2: 히스토리 순수 규칙을 `lib/score/history.ts`로 옮긴다

옛 `useSongHistory` 훅에 묻혀 있던 규칙(제자리 편집은 기록하지 않음, 곡 전체 설정은 과거 스냅샷에도 적용, 한도)을 훅 밖 순수 함수로 꺼낸다. 훅 본체는 Task 3에서 철거하고 하위 프로젝트 2가 새로 짠다.

**Files:**
- Create: `lib/score/history.ts`
- Create: `lib/score/history.test.ts`

**Interfaces:**
- Produces:
  - `HISTORY_LIMIT: 50`
  - `type History<T> = { readonly past: readonly T[]; readonly present: T }`
  - `createHistory<T>(present: T): History<T>`
  - `pushHistory<T>(past: readonly T[], item: T, limit?: number): T[]`
  - `commit<T>(h: History<T>, updater: (v: T) => T): History<T>`
  - `replaceWithoutHistory<T>(h: History<T>, updater: (v: T) => T): History<T>`
  - `undo<T>(h: History<T>): History<T> | null`
  - `canUndo<T>(h: History<T>): boolean`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `lib/score/history.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  HISTORY_LIMIT,
  canUndo,
  commit,
  createHistory,
  pushHistory,
  replaceWithoutHistory,
  undo,
} from "@/lib/score/history";

type Doc = { tempo: number; edits: string[] };
const doc = (tempo: number, edits: string[] = []): Doc => ({ tempo, edits });

describe("pushHistory", () => {
  it("뒤에 쌓는다", () => {
    const past = pushHistory(pushHistory([], 1), 2);
    expect(past).toEqual([1, 2]);
  });

  it("상한을 넘으면 오래된 것부터 버린다", () => {
    let past: number[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) past = pushHistory(past, i);
    expect(past).toHaveLength(HISTORY_LIMIT);
    expect(past[0]).toBe(10);
    expect(past.at(-1)).toBe(HISTORY_LIMIT + 9);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const past: number[] = [];
    pushHistory(past, 1);
    expect(past).toHaveLength(0);
  });

  it("상한은 50이다", () => {
    expect(HISTORY_LIMIT).toBe(50);
  });
});

describe("commit", () => {
  it("이전 값을 쌓고 새 값을 현재로 만든다", () => {
    const h = commit(createHistory(doc(120)), (d) => ({ ...d, edits: ["a"] }));
    expect(h.present.edits).toEqual(["a"]);
    expect(h.past).toEqual([doc(120)]);
  });

  it("updater가 같은 참조를 돌려주면 히스토리에 빈 항목을 쌓지 않는다", () => {
    // 타일을 끌었다 제자리에 놓으면 편집 함수가 곡을 그대로 돌려준다.
    // 여기서 기록하면 Ctrl+Z가 아무것도 바꾸지 않는 칸을 소비한다.
    const start = createHistory(doc(120));
    const h = commit(start, (d) => d);
    expect(h).toBe(start);
    expect(canUndo(h)).toBe(false);
  });
});

describe("replaceWithoutHistory", () => {
  it("새 항목을 쌓지 않는다", () => {
    const h = replaceWithoutHistory(createHistory(doc(120)), (d) => ({
      ...d,
      tempo: 90,
    }));
    expect(h.present.tempo).toBe(90);
    expect(h.past).toHaveLength(0);
  });

  it("이미 쌓인 과거 스냅샷에도 같은 updater를 적용한다", () => {
    // 곡 전체 설정(템포)은 어느 스냅샷을 봐도 '지금 값'이어야 한다.
    // 안 그러면 편집을 되돌릴 때마다 템포가 옛 값으로 슬쩍 돌아간다.
    let h = createHistory(doc(120));
    h = commit(h, (d) => ({ ...d, edits: ["a"] }));
    h = commit(h, (d) => ({ ...d, edits: ["a", "b"] }));
    h = replaceWithoutHistory(h, (d) => ({ ...d, tempo: 90 }));

    expect(h.past.map((d) => d.tempo)).toEqual([90, 90]);
    const back = undo(h)!;
    expect(back.present.tempo).toBe(90);
    expect(back.present.edits).toEqual(["a"]);
  });

  it("원본 과거 배열을 변형하지 않는다", () => {
    let h = createHistory(doc(120));
    h = commit(h, (d) => ({ ...d, edits: ["a"] }));
    const before = h.past;
    replaceWithoutHistory(h, (d) => ({ ...d, tempo: 90 }));
    expect(before[0].tempo).toBe(120);
  });

  it("updater가 같은 참조를 돌려주면 아무것도 바꾸지 않는다", () => {
    const start = createHistory(doc(120));
    expect(replaceWithoutHistory(start, (d) => d)).toBe(start);
  });
});

describe("undo", () => {
  it("되돌릴 게 없으면 null이다", () => {
    expect(undo(createHistory(doc(120)))).toBeNull();
  });

  it("마지막 항목으로 되돌린다", () => {
    let h = createHistory(doc(120));
    h = commit(h, (d) => ({ ...d, edits: ["a"] }));
    h = commit(h, (d) => ({ ...d, edits: ["a", "b"] }));
    const back = undo(h)!;
    expect(back.present.edits).toEqual(["a"]);
    expect(canUndo(back)).toBe(true);
    expect(canUndo(undo(back)!)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test lib/score/history.test.ts`
Expected: FAIL — `@/lib/score/history`를 찾을 수 없다.

- [ ] **Step 3: 구현한다**

Create `lib/score/history.ts`:

```ts
/**
 * 곡 하나가 수백 클립이라 스냅샷 자체는 싸지만, 무한히 쌓을 이유도 없다.
 */
export const HISTORY_LIMIT = 50;

export type History<T> = {
  readonly past: readonly T[];
  readonly present: T;
};

export function createHistory<T>(present: T): History<T> {
  return { past: [], present };
}

/** 뒤에 쌓고 상한을 넘으면 앞에서 버린다. 원본 배열은 건드리지 않는다. */
export function pushHistory<T>(
  past: readonly T[],
  item: T,
  limit: number = HISTORY_LIMIT,
): T[] {
  const next = [...past, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * 현재 값에 updater를 적용해 교체하고, 이전 값을 과거에 쌓는다.
 * updater가 같은 참조를 돌려주면(제자리 편집) 아무것도 기록하지 않는다.
 */
export function commit<T>(
  history: History<T>,
  updater: (value: T) => T,
): History<T> {
  const next = updater(history.present);
  if (next === history.present) return history;
  return { past: pushHistory(history.past, history.present), present: next };
}

/**
 * 히스토리에 쌓지 않고 값을 교체하며, 이미 쌓인 과거에도 같은 updater를
 * 적용한다.
 *
 * 템포처럼 **곡 전체에 적용되는 설정**에서만 맞다. 그 값은 어느 스냅샷을
 * 봐도 "당시의 값"이 아니라 "지금의 값"이어야 하기 때문이다. 클립 추가·삭제
 * 같은 **구조적 편집**에는 절대 쓰면 안 된다 — 과거의 구성까지 지금 값으로
 * 덮으면 "그 시점으로 되돌아간다"는 실행취소의 의미가 사라진다.
 */
export function replaceWithoutHistory<T>(
  history: History<T>,
  updater: (value: T) => T,
): History<T> {
  const next = updater(history.present);
  if (next === history.present) return history;
  return { past: history.past.map(updater), present: next };
}

/** 되돌린 히스토리를 돌려준다. 되돌릴 게 없으면 null. */
export function undo<T>(history: History<T>): History<T> | null {
  if (history.past.length === 0) return null;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test lib/score/history.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: 전체 검사 후 커밋한다**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 통과.

```bash
git add lib/score/history.ts lib/score/history.test.ts
git commit -m "feat(score): 실행취소 규칙을 훅 밖 순수 함수로 옮긴다"
```

---

### Task 3: 옛 UI·상태·편집 계층을 철거한다

옛 곡 모델(`Tile`/`Line`)에 묶인 것들을 한 번에 지운다. 이 Task가 끝나면 앱의 화면은 빈 스텁뿐이다(spec 2절이 허용한 상태). 스케줄러·엔진·악기와 그 테스트는 옛 모델 그대로 남아 컴파일된다.

**Files:**
- Delete: `components/` 전체 (단 `components/dom-env.test.tsx`는 남긴다)
- Delete: `state/` 전체
- Delete: `lib/score/edit.ts`, `edit.test.ts`, `schema.ts`, `schema.test.ts`, `serialize.ts`, `serialize.test.ts`, `notes.ts`, `notes.test.ts`, `format-doc.test.ts`
- Delete: `docs/song-file-format.md`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: Task 2의 `lib/score/history.ts`가 `state/useSongHistory.ts`의 규칙을 대신한다.
- Produces: 남는 옛 모델 파일은 `lib/score/{types,time,fixture}.ts`(+테스트)뿐이다.

- [ ] **Step 1: 지울 파일을 참조하는 남길 파일이 없는지 확인한다**

Run:
```bash
grep -rnE "score/(edit|schema|serialize|notes)\b|from \"@/(components|state)" lib app --include=*.ts --include=*.tsx | grep -vE "^lib/score/(edit|schema|serialize|notes)(\.test)?\.ts|format-doc"
```
Expected: 출력 없음. 있으면 그 파일을 먼저 확인하고 이 Task의 삭제 목록에 추가한다.

- [ ] **Step 2: 삭제한다**

```bash
git rm -r components/timeline components/transport state
git rm lib/score/edit.ts lib/score/edit.test.ts lib/score/schema.ts lib/score/schema.test.ts \
  lib/score/serialize.ts lib/score/serialize.test.ts lib/score/notes.ts lib/score/notes.test.ts \
  lib/score/format-doc.test.ts docs/song-file-format.md
```
Expected: 파일들이 삭제 스테이징된다. `components/dom-env.test.tsx`는 남는다.

- [ ] **Step 3: 홈 화면을 스텁으로 바꾼다**

Replace the whole of `app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-lg font-semibold text-zinc-100">Bandline</h1>
      <p className="mt-2 text-sm text-zinc-400">
        재설계 중입니다. 소리를 확인하는 검증 화면이 곧 이 자리에 들어옵니다.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: 남은 것이 컴파일되고 통과하는지 확인한다**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 통과. 테스트 파일 수가 줄어든다(`edit`/`schema`/`serialize`/`notes`/`format-doc`/`useSongHistory` 테스트가 사라짐). `scheduler`/`engine`/`voices`/`instruments`/`time`/`fixture`/`history`/`dom-env` 테스트는 남아 통과해야 한다.

- [ ] **Step 5: 빌드를 확인한다**

Run: `pnpm build`
Expected: 성공. (네트워크가 막혀 폰트 다운로드에서 실패하면 그 원인을 기록하고 넘어간다.)

- [ ] **Step 6: 커밋한다**

```bash
git add -A
git commit -m "refactor(app): 옛 곡 모델에 묶인 UI·상태·편집 계층을 철거한다"
```

---

### Task 4: 새 곡 모델 `lib/score/model.ts`

**Files:**
- Create: `lib/score/model.ts`
- Modify: `lib/score/time.ts` (PPQ를 model에서 읽고 `songLengthTicks` 추가)
- Modify: `lib/score/types.ts` (PPQ를 model에서 재수출)
- Modify: `lib/score/time.test.ts` (`songLengthTicks` 테스트 추가)

**Interfaces:**
- Produces (`lib/score/model.ts`):
  ```ts
  export const PPQ = 480;
  export const SONG_VERSION = 2;
  export const MIN_TEMPO = 40; export const MAX_TEMPO = 240; export const MAX_BARS = 500;
  export const DRUM_KICK = 36; export const DRUM_SNARE = 38; export const DRUM_HIHAT = 42;
  export const INSTRUMENT_IDS: readonly ["piano","guitar","bass","drums"];
  export type InstrumentId;
  export const CHORD_QUALITIES: readonly ["maj","min","dom7","maj7","min7"];
  export type ChordQuality; export type Chord = { root: number; quality: ChordQuality };
  export type PatternId = string;
  export type Note = { start: number; length: number; pitch: number; velocity: number };
  export type ChordBody = { type: "chord"; chord: Chord; pattern: PatternId };
  export type NotesBody = { type: "notes"; notes: Note[] };
  export type ClipBody = ChordBody | NotesBody;
  export type Clip = { id: string; start: number; length: number; body: ClipBody };
  export type Track = { id: string; instrument: InstrumentId; clips: Clip[] };
  export type Author = { name: string; publicKey: string };
  export type SongMeta = { title: string; author?: Author; editors: Author[]; signature?: string };
  export type Song = { v: 2; tempo: number; timeSignature: [number, number]; bars: number; tracks: Track[]; meta: SongMeta };
  ```
- Produces (`lib/score/time.ts`): `songLengthTicks(song: Pick<Song, "bars" | "timeSignature">): number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Append to `lib/score/time.test.ts` (맨 위 import 블록에 `songLengthTicks`를 추가하고, 파일 끝에 아래 describe를 붙인다):

```ts
import { songLengthTicks } from "@/lib/score/time";

describe("songLengthTicks", () => {
  it("bars × ticksPerBar다", () => {
    expect(songLengthTicks({ bars: 8, timeSignature: [4, 4] })).toBe(8 * 1920);
    expect(songLengthTicks({ bars: 4, timeSignature: [3, 4] })).toBe(4 * 1440);
    expect(songLengthTicks({ bars: 2, timeSignature: [6, 8] })).toBe(2 * 1440);
  });
});
```

(이미 `@/lib/score/time`에서 import하는 블록이 있으면 그 `import { … }`에 `songLengthTicks`를 합친다. 중복 import 문을 만들지 않는다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test lib/score/time.test.ts`
Expected: FAIL — `songLengthTicks`가 export되지 않았다.

- [ ] **Step 3: 모델을 만든다**

Create `lib/score/model.ts`:

```ts
/**
 * 곡 데이터 모델 v2. 순수 타입과 상수만 둔다 — Web Audio도 React도 모른다.
 *
 * 시간은 전부 PPQ 정수 틱이다. 초로 저장하지 않는다(템포를 바꾸면 곡이 어긋난다).
 */

/** 4분음표 하나에 해당하는 틱 수. 모든 음악적 시간의 기준 단위. */
export const PPQ = 480;

/** 곡 파일 형식 버전. 이 값이 아니면 열지 않는다. */
export const SONG_VERSION = 2;

export const MIN_TEMPO = 40;
export const MAX_TEMPO = 240;

/**
 * 곡 길이 상한(마디). 음악적 제한이 아니라 렌더 비용 가드다 — 손으로 고친
 * 파일이 `bars: 1e9`를 담고 들어와도 화면이 멈추지 않게 한다.
 */
export const MAX_BARS = 500;

/** GM 관행에 따른 드럼 번호. */
export const DRUM_KICK = 36;
export const DRUM_SNARE = 38;
export const DRUM_HIHAT = 42;

export const INSTRUMENT_IDS = ["piano", "guitar", "bass", "drums"] as const;
export type InstrumentId = (typeof INSTRUMENT_IDS)[number];

/** 닫힌 열거형이다. 값은 추가만 한다. 옛 앱이 모르는 값을 만나면 거부한다. */
export const CHORD_QUALITIES = ["maj", "min", "dom7", "maj7", "min7"] as const;
export type ChordQuality = (typeof CHORD_QUALITIES)[number];

export type Chord = {
  /** 0=C … 11=B */
  root: number;
  quality: ChordQuality;
};

/** 패턴 카탈로그(`patterns.ts`)의 id. 패턴 id는 불변이다. */
export type PatternId = string;

export type Note = {
  /** 클립 시작 기준 상대 틱. 정수. */
  start: number;
  /** 틱. 정수, 1 이상. */
  length: number;
  /** MIDI 번호. 드럼 트랙에서는 GM 드럼 번호. */
  pitch: number;
  /** 0..1 */
  velocity: number;
};

export type ChordBody = {
  type: "chord";
  chord: Chord;
  pattern: PatternId;
};

export type NotesBody = {
  type: "notes";
  /** start 오름차순. 같은 start의 음은 몇 개든 가질 수 있다(화음). */
  notes: Note[];
};

export type ClipBody = ChordBody | NotesBody;

export type Clip = {
  id: string;
  /** 곡 시작 기준 절대 틱. 정수. */
  start: number;
  /** 틱. 정수, 1 이상. */
  length: number;
  body: ClipBody;
};

export type Track = {
  id: string;
  instrument: InstrumentId;
  /** start 오름차순이고 서로 겹치지 않는 것이 불변식이다. */
  clips: Clip[];
};

export type Author = {
  name: string;
  /** 서명 검증용 공개키. 형식과 검증 로직은 공유 하위 프로젝트에서 정한다. */
  publicKey: string;
};

export type SongMeta = {
  title: string;
  author?: Author;
  /** 작업자 이후에 곡을 고친 사람들. 원 작업자는 `author`에 그대로 남는다. */
  editors: Author[];
  signature?: string;
};

export type Song = {
  v: typeof SONG_VERSION;
  tempo: number;
  timeSignature: [number, number];
  /** 마디 수. 곡 길이는 `bars × ticksPerBar`로 파생한다. */
  bars: number;
  tracks: Track[];
  meta: SongMeta;
};
```

- [ ] **Step 4: `time.ts`를 연결한다**

In `lib/score/time.ts`, replace the first line `import { PPQ } from "./types";` with:

```ts
import { PPQ, type Song } from "./model";
```

And append at the end of the file:

```ts
/** 곡 전체 길이(틱). `lengthTicks` 필드는 없고 마디 수에서 파생한다. */
export function songLengthTicks(
  song: Pick<Song, "bars" | "timeSignature">,
): number {
  return song.bars * ticksPerBar(song.timeSignature);
}
```

- [ ] **Step 5: 옛 `types.ts`가 PPQ를 새 모델에서 읽게 한다**

In `lib/score/types.ts`, replace

```ts
/** 4분음표 하나에 해당하는 틱 수. 모든 음악적 시간의 기준 단위. */
export const PPQ = 480;
```

with:

```ts
/** 옛 모델이 살아 있는 동안만 둔다. 값이 갈라지지 않게 새 모델에서 재수출한다. */
export { PPQ } from "./model";
```

- [ ] **Step 6: 통과를 확인하고 커밋한다**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 통과.

```bash
git add lib/score/model.ts lib/score/time.ts lib/score/types.ts lib/score/time.test.ts
git commit -m "feat(score): 클립 기반 곡 모델 v2 타입을 추가한다"
```

---

### Task 5: 코드 음정과 패턴 카탈로그

**Files:**
- Create: `lib/score/chords.ts`, `lib/score/chords.test.ts`
- Create: `lib/score/patterns.ts`, `lib/score/patterns.test.ts`
- Create (테스트 실행이 생성): `lib/score/__snapshots__/patterns.test.ts.snap`

**Interfaces:**
- Produces:
  - `chordPitch(chord: Chord, degree: number, octave: number): number` — `octave`는 C4=60 규약(`12*(octave+1)+root+tone`). `degree`가 코드 구성음 수를 넘으면 한 옥타브 위로 감는다.
  - `type HarmonicStep = { at; length; degree; octave; velocity }`, `type DrumStep = { at; length; pitch; velocity }`
  - `type Pattern = { id: string; kind: "harmonic"; length: number; steps: HarmonicStep[] } | { id: string; kind: "drum"; length: number; steps: DrumStep[] }`
  - `PATTERNS: readonly Pattern[]`, `getPattern(id: string): Pattern | undefined`, `patternsFor(instrument: InstrumentId): Pattern[]`, `BAR_4_4 = 1920`

- [ ] **Step 1: `chordPitch`의 실패하는 테스트를 쓴다**

Create `lib/score/chords.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { chordPitch } from "@/lib/score/chords";
import type { Chord } from "@/lib/score/model";

const C_MAJ: Chord = { root: 0, quality: "maj" };
const A_MIN: Chord = { root: 9, quality: "min" };
const G_DOM7: Chord = { root: 7, quality: "dom7" };

describe("chordPitch", () => {
  it("C장조 3화음은 옥타브 4에서 60, 64, 67이다", () => {
    expect(chordPitch(C_MAJ, 0, 4)).toBe(60);
    expect(chordPitch(C_MAJ, 1, 4)).toBe(64);
    expect(chordPitch(C_MAJ, 2, 4)).toBe(67);
  });

  it("3화음에서 degree 3은 한 옥타브 위 근음이다", () => {
    expect(chordPitch(C_MAJ, 3, 4)).toBe(72);
    expect(chordPitch(C_MAJ, 4, 4)).toBe(76);
  });

  it("단3화음은 3음이 반음 낮다", () => {
    // A minor: A4=69, C5=72, E5=76
    expect(chordPitch(A_MIN, 0, 4)).toBe(69);
    expect(chordPitch(A_MIN, 1, 4)).toBe(72);
    expect(chordPitch(A_MIN, 2, 4)).toBe(76);
  });

  it("7화음은 degree 3이 7음이다", () => {
    // G7 옥타브 3: G3=55, B3=59, D4=62, F4=65
    expect(chordPitch(G_DOM7, 0, 3)).toBe(55);
    expect(chordPitch(G_DOM7, 1, 3)).toBe(59);
    expect(chordPitch(G_DOM7, 2, 3)).toBe(62);
    expect(chordPitch(G_DOM7, 3, 3)).toBe(65);
  });

  it("maj7과 min7의 7음", () => {
    expect(chordPitch({ root: 0, quality: "maj7" }, 3, 4)).toBe(71);
    expect(chordPitch({ root: 0, quality: "min7" }, 3, 4)).toBe(70);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test lib/score/chords.test.ts`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 3: `chords.ts`를 구현한다**

Create `lib/score/chords.ts`:

```ts
import type { Chord, ChordQuality } from "./model";

/** 근음에서 각 구성음까지의 반음 간격. */
const INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
};

/**
 * 코드의 `degree`번째 구성음을 MIDI 번호로 바꾼다.
 *
 * `octave`는 C4=60 규약이다(`12 * (octave + 1) + root + 간격`).
 * `degree`가 구성음 수를 넘으면 한 옥타브씩 올려 감는다 — 3화음에서
 * degree 3은 한 옥타브 위 근음이다. 그래서 패턴 하나가 3화음과 7화음에
 * 모두 쓰인다.
 */
export function chordPitch(chord: Chord, degree: number, octave: number): number {
  const tones = INTERVALS[chord.quality];
  const wraps = Math.floor(degree / tones.length);
  const tone = tones[degree % tones.length];
  return 12 * (octave + 1) + chord.root + tone + 12 * wraps;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test lib/score/chords.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: 패턴 카탈로그의 실패하는 테스트를 쓴다**

Create `lib/score/patterns.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { chordPitch } from "@/lib/score/chords";
import { CHORD_QUALITIES } from "@/lib/score/model";
import {
  BAR_4_4,
  PATTERNS,
  getPattern,
  patternsFor,
} from "@/lib/score/patterns";

describe("패턴 카탈로그", () => {
  it("패턴 id는 불변이다 — 스냅샷이 바뀌면 옛 링크의 소리가 달라진다", () => {
    // 이 테스트가 실패하면 패턴을 '고친' 것이다. 고치지 말고 새 id로 추가하라.
    // 의도한 추가라면 스냅샷 파일에 새 항목이 생길 뿐 기존 항목은 그대로여야 한다.
    expect(PATTERNS).toMatchSnapshot();
  });

  it("id가 유일하다", () => {
    const ids = PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getPattern은 id로 찾고 없으면 undefined다", () => {
    expect(getPattern("piano-block")?.id).toBe("piano-block");
    expect(getPattern("nope")).toBeUndefined();
  });

  it("patternsFor는 악기에 맞는 종류만 돌려준다", () => {
    expect(patternsFor("drums").every((p) => p.kind === "drum")).toBe(true);
    for (const inst of ["piano", "guitar", "bass"] as const) {
      const list = patternsFor(inst);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((p) => p.kind === "harmonic")).toBe(true);
    }
    expect(patternsFor("drums").length).toBeGreaterThan(0);
  });

  it("모든 스텝이 패턴 길이 안에서 시작하고 양수 길이를 가진다", () => {
    for (const p of PATTERNS) {
      expect(p.length).toBeGreaterThan(0);
      for (const s of p.steps) {
        expect(s.at).toBeGreaterThanOrEqual(0);
        expect(s.at).toBeLessThan(p.length);
        expect(s.length).toBeGreaterThan(0);
        expect(Number.isInteger(s.at) && Number.isInteger(s.length)).toBe(true);
        expect(s.velocity).toBeGreaterThan(0);
        expect(s.velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("모든 화음 패턴이 12개 근음 × 모든 코드 종류에서 MIDI 범위 안의 음을 만든다", () => {
    for (const p of PATTERNS) {
      if (p.kind !== "harmonic") continue;
      for (let root = 0; root < 12; root++) {
        for (const quality of CHORD_QUALITIES) {
          for (const s of p.steps) {
            const pitch = chordPitch({ root, quality }, s.degree, s.octave);
            expect(pitch).toBeGreaterThanOrEqual(0);
            expect(pitch).toBeLessThanOrEqual(127);
          }
        }
      }
    }
  });

  it("4/4 한 마디는 1920틱이다", () => {
    expect(BAR_4_4).toBe(1920);
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `pnpm test lib/score/patterns.test.ts`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 7: 카탈로그를 구현한다**

Create `lib/score/patterns.ts`:

```ts
import {
  DRUM_HIHAT,
  DRUM_KICK,
  DRUM_SNARE,
  PPQ,
  type InstrumentId,
} from "./model";

/**
 * 패턴 카탈로그. 곡 파일에는 id만 들어가므로 공유 URL이 작다.
 *
 * **패턴 id는 불변이다.** 이미 공유된 링크가 같은 소리로 재생되려면 한 번
 * 낸 id의 내용을 바꿀 수 없다. 고치고 싶으면 새 id를 만들고, 옛 것은
 * 그대로 둔다. `patterns.test.ts`의 스냅샷이 이를 지킨다.
 *
 * 시간은 틱이고 4/4 한 마디(1920)를 기준으로 만들었다. 다른 박자에서는
 * 패턴이 자기 길이로 반복되어 마디선과 어긋날 수 있다 — 편집 UI가 4/4만
 * 제공하는 동안은 문제가 되지 않는다.
 */
export const BAR_4_4 = PPQ * 4;

export type HarmonicStep = {
  /** 패턴 시작 기준 틱. */
  at: number;
  length: number;
  /** 코드 구성음 순번. 0=근음, 1=3음, 2=5음, 3=7음(3화음이면 한 옥타브 위 근음). */
  degree: number;
  octave: number;
  velocity: number;
};

export type DrumStep = {
  at: number;
  length: number;
  /** GM 드럼 번호. */
  pitch: number;
  velocity: number;
};

export type Pattern =
  | { id: string; kind: "harmonic"; length: number; steps: HarmonicStep[] }
  | { id: string; kind: "drum"; length: number; steps: DrumStep[] };

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export const PATTERNS: readonly Pattern[] = [
  {
    id: "piano-block",
    kind: "harmonic",
    length: BAR_4_4,
    steps: [0, 1, 2].map((degree) => ({
      at: 0,
      length: BAR_4_4,
      degree,
      octave: 4,
      velocity: 0.7,
    })),
  },
  {
    id: "piano-arpeggio-8th",
    kind: "harmonic",
    length: BAR_4_4,
    steps: [0, 1, 2, 1, 0, 1, 2, 1].map((degree, i) => ({
      at: i * (PPQ / 2),
      length: PPQ / 2,
      degree,
      octave: 4,
      velocity: 0.6,
    })),
  },
  {
    id: "guitar-strum-quarter",
    kind: "harmonic",
    length: BAR_4_4,
    // 네 박마다 낮은 현부터 15틱씩 어긋나게 친다
    steps: range(4).flatMap((beat) =>
      [0, 1, 2].map((degree) => ({
        at: beat * PPQ + degree * 15,
        length: 450,
        degree,
        octave: 3,
        velocity: 0.6,
      })),
    ),
  },
  {
    id: "bass-root-quarter",
    kind: "harmonic",
    length: BAR_4_4,
    steps: range(4).map((beat) => ({
      at: beat * PPQ,
      length: 420,
      degree: 0,
      octave: 2,
      velocity: 0.8,
    })),
  },
  {
    id: "bass-root-fifth",
    kind: "harmonic",
    length: BAR_4_4,
    steps: [
      { at: 0, length: 900, degree: 0, octave: 2, velocity: 0.8 },
      { at: 960, length: 900, degree: 2, octave: 2, velocity: 0.8 },
    ],
  },
  {
    id: "drum-basic-rock",
    kind: "drum",
    length: BAR_4_4,
    steps: [
      { at: 0, length: 240, pitch: DRUM_KICK, velocity: 0.9 },
      { at: 960, length: 240, pitch: DRUM_KICK, velocity: 0.9 },
      { at: 480, length: 240, pitch: DRUM_SNARE, velocity: 0.8 },
      { at: 1440, length: 240, pitch: DRUM_SNARE, velocity: 0.8 },
      ...range(8).map((i) => ({
        at: i * 240,
        length: 120,
        pitch: DRUM_HIHAT,
        velocity: 0.5,
      })),
    ],
  },
  {
    id: "drum-four-on-floor",
    kind: "drum",
    length: BAR_4_4,
    steps: [
      ...range(4).map((beat) => ({
        at: beat * PPQ,
        length: 240,
        pitch: DRUM_KICK,
        velocity: 0.9,
      })),
      { at: 480, length: 240, pitch: DRUM_SNARE, velocity: 0.7 },
      { at: 1440, length: 240, pitch: DRUM_SNARE, velocity: 0.7 },
      ...range(4).map((beat) => ({
        at: beat * PPQ + 240,
        length: 120,
        pitch: DRUM_HIHAT,
        velocity: 0.5,
      })),
    ],
  },
];

const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));

export function getPattern(id: string): Pattern | undefined {
  return BY_ID.get(id);
}

/** 악기에 쓸 수 있는 패턴. 드럼은 드럼 패턴만, 나머지는 화음 패턴만이다. */
export function patternsFor(instrument: InstrumentId): Pattern[] {
  const kind = instrument === "drums" ? "drum" : "harmonic";
  return PATTERNS.filter((p) => p.kind === kind);
}
```

- [ ] **Step 8: 통과를 확인한다 (스냅샷이 처음 생성된다)**

Run: `pnpm test lib/score/patterns.test.ts`
Expected: PASS. `lib/score/__snapshots__/patterns.test.ts.snap`이 새로 만들어졌다는 메시지가 나온다. 한 번 더 실행해 스냅샷이 안정적인지 확인한다: `pnpm test lib/score/patterns.test.ts` → PASS, "written" 메시지 없음.

- [ ] **Step 9: 전체 검사 후 커밋한다 (스냅샷 파일 포함)**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 통과.

```bash
git add lib/score/chords.ts lib/score/chords.test.ts lib/score/patterns.ts lib/score/patterns.test.ts lib/score/__snapshots__
git commit -m "feat(score): 코드 음정 계산과 패턴 카탈로그를 추가한다"
```

---

### Task 6: 불변식 검증 `validate.ts`와 테스트 빌더

**Files:**
- Create: `lib/score/testing/builders.ts`
- Create: `lib/score/validate.ts`, `lib/score/validate.test.ts`

**Interfaces:**
- Consumes: Task 4 모델, Task 5 `getPattern`.
- Produces:
  - `songWithNotes(opts: { trackId?: string; instrument?: InstrumentId; notes: Note[]; bars?: number; tempo?: number }): Song` — 4/4, 트랙 하나에 `start:0`·곡 전체 길이의 `notes` 클립 하나. (`lib/score/testing/builders.ts`, 테스트 전용 지원 모듈)
  - `type ScoreIssueCode = "bars-out-of-range" | "duplicate-id" | "non-integer-tick" | "non-positive-length" | "clip-out-of-range" | "clip-unsorted" | "clip-overlap" | "unknown-pattern" | "pattern-instrument-mismatch" | "note-unsorted" | "note-out-of-clip" | "pitch-out-of-range" | "velocity-out-of-range"`
  - `type ScoreIssue = { code: ScoreIssueCode; path: string; message: string }`
  - `validateSong(song: Song): ScoreIssue[]` — 빈 배열이면 불변식을 모두 만족한다.

- [ ] **Step 1: 테스트 빌더를 만든다**

Create `lib/score/testing/builders.ts`:

```ts
import type { InstrumentId, Note, Song } from "@/lib/score/model";
import { ticksPerBar } from "@/lib/score/time";

/**
 * 테스트 전용 곡 조립 도구. 4/4, 트랙 하나, 곡 전체를 덮는 `notes` 클립 하나.
 * 편집 로직이 아니라 "이런 곡이 있다"를 한 줄로 말하기 위한 것이다.
 */
export function songWithNotes(opts: {
  trackId?: string;
  instrument?: InstrumentId;
  notes: Note[];
  bars?: number;
  tempo?: number;
}): Song {
  const bars = opts.bars ?? 1;
  return {
    v: 2,
    tempo: opts.tempo ?? 120,
    timeSignature: [4, 4],
    bars,
    tracks: [
      {
        id: opts.trackId ?? "track-1",
        instrument: opts.instrument ?? "piano",
        clips: [
          {
            id: "clip-1",
            start: 0,
            length: bars * ticksPerBar([4, 4]),
            body: { type: "notes", notes: opts.notes },
          },
        ],
      },
    ],
    meta: { title: "test", editors: [] },
  };
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

Create `lib/score/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Clip, Song } from "@/lib/score/model";
import { songWithNotes } from "@/lib/score/testing/builders";
import { validateSong, type ScoreIssueCode } from "@/lib/score/validate";

const note = (start: number, length: number, pitch = 60, velocity = 0.5) => ({
  start,
  length,
  pitch,
  velocity,
});

const emptyClip = (id: string, start: number, length: number): Clip => ({
  id,
  start,
  length,
  body: { type: "notes", notes: [] },
});

/** 2마디(3840틱) 곡에 주어진 클립들을 넣는다. */
function withClips(clips: Clip[]): Song {
  const song = songWithNotes({ notes: [], bars: 2 });
  song.tracks[0].clips = clips;
  return song;
}

function codes(song: Song): ScoreIssueCode[] {
  return validateSong(song).map((i) => i.code);
}

describe("validateSong — 통과", () => {
  it("올바른 곡은 이슈가 없다", () => {
    expect(
      validateSong(songWithNotes({ notes: [note(0, 480), note(0, 480, 64)] })),
    ).toEqual([]);
  });

  it("같은 시각의 음(화음)은 허용한다", () => {
    const song = songWithNotes({
      notes: [note(0, 480, 60), note(0, 480, 64), note(0, 480, 67)],
    });
    expect(validateSong(song)).toEqual([]);
  });

  it("맞닿은 클립은 겹침이 아니다", () => {
    expect(
      validateSong(withClips([emptyClip("a", 0, 1920), emptyClip("b", 1920, 1920)])),
    ).toEqual([]);
  });

  it("클립 사이에 빈 구간이 있어도 된다", () => {
    expect(
      validateSong(withClips([emptyClip("a", 0, 480), emptyClip("b", 1920, 480)])),
    ).toEqual([]);
  });
});

describe("validateSong — 클립 불변식", () => {
  it("같은 트랙의 클립이 겹치면 clip-overlap", () => {
    expect(
      codes(withClips([emptyClip("a", 0, 1920), emptyClip("b", 960, 1920)])),
    ).toContain("clip-overlap");
  });

  it("start 순서가 어긋나면 clip-unsorted", () => {
    expect(
      codes(withClips([emptyClip("a", 1920, 480), emptyClip("b", 0, 480)])),
    ).toContain("clip-unsorted");
  });

  it("곡 끝을 넘는 클립은 clip-out-of-range", () => {
    expect(codes(withClips([emptyClip("a", 3000, 1000)]))).toContain(
      "clip-out-of-range",
    );
  });

  it("start가 음수인 클립은 clip-out-of-range", () => {
    expect(codes(withClips([emptyClip("a", -1, 480)]))).toContain(
      "clip-out-of-range",
    );
  });

  it("클립 id가 트랙 안에서 겹치면 duplicate-id", () => {
    expect(
      codes(withClips([emptyClip("a", 0, 480), emptyClip("a", 480, 480)])),
    ).toContain("duplicate-id");
  });

  it("트랙 id가 곡 안에서 겹치면 duplicate-id", () => {
    const song = withClips([]);
    song.tracks.push({ ...song.tracks[0] });
    expect(codes(song)).toContain("duplicate-id");
  });

  it("소수 틱은 non-integer-tick", () => {
    expect(codes(withClips([emptyClip("a", 0.5, 480)]))).toContain(
      "non-integer-tick",
    );
  });

  it("길이 0 클립은 non-positive-length", () => {
    expect(codes(withClips([emptyClip("a", 0, 0)]))).toContain(
      "non-positive-length",
    );
  });
});

describe("validateSong — 음 불변식", () => {
  it("클립 밖으로 나간 음은 note-out-of-clip", () => {
    expect(codes(songWithNotes({ notes: [note(1800, 480)] }))).toContain(
      "note-out-of-clip",
    );
  });

  it("start가 음수인 음은 note-out-of-clip", () => {
    expect(codes(songWithNotes({ notes: [note(-1, 480)] }))).toContain(
      "note-out-of-clip",
    );
  });

  it("start 순서가 어긋나면 note-unsorted", () => {
    expect(
      codes(songWithNotes({ notes: [note(480, 240), note(0, 240)] })),
    ).toContain("note-unsorted");
  });

  it("길이 0 음은 non-positive-length", () => {
    expect(codes(songWithNotes({ notes: [note(0, 0)] }))).toContain(
      "non-positive-length",
    );
  });

  it("소수 틱 음은 non-integer-tick", () => {
    expect(codes(songWithNotes({ notes: [note(0.5, 240)] }))).toContain(
      "non-integer-tick",
    );
  });

  it("MIDI 범위를 벗어난 pitch는 pitch-out-of-range", () => {
    expect(codes(songWithNotes({ notes: [note(0, 240, 128)] }))).toContain(
      "pitch-out-of-range",
    );
    expect(codes(songWithNotes({ notes: [note(0, 240, 60.5)] }))).toContain(
      "pitch-out-of-range",
    );
  });

  it("범위를 벗어난 velocity는 velocity-out-of-range", () => {
    expect(codes(songWithNotes({ notes: [note(0, 240, 60, 1.2)] }))).toContain(
      "velocity-out-of-range",
    );
    expect(
      codes(songWithNotes({ notes: [note(0, 240, 60, Number.NaN)] })),
    ).toContain("velocity-out-of-range");
  });
});

describe("validateSong — 곡과 패턴", () => {
  it("bars가 0이거나 상한을 넘으면 bars-out-of-range", () => {
    expect(codes(songWithNotes({ notes: [], bars: 0 }))).toContain(
      "bars-out-of-range",
    );
    expect(codes(songWithNotes({ notes: [], bars: 501 }))).toContain(
      "bars-out-of-range",
    );
  });

  it("알 수 없는 패턴 id는 unknown-pattern", () => {
    const song = withClips([
      {
        id: "a",
        start: 0,
        length: 1920,
        body: { type: "chord", chord: { root: 0, quality: "maj" }, pattern: "nope" },
      },
    ]);
    expect(codes(song)).toContain("unknown-pattern");
  });

  it("드럼 트랙에 화음 패턴을 쓰면 pattern-instrument-mismatch", () => {
    const song = withClips([
      {
        id: "a",
        start: 0,
        length: 1920,
        body: {
          type: "chord",
          chord: { root: 0, quality: "maj" },
          pattern: "piano-block",
        },
      },
    ]);
    song.tracks[0].instrument = "drums";
    expect(codes(song)).toContain("pattern-instrument-mismatch");
  });

  it("피아노 트랙에 드럼 패턴을 쓰면 pattern-instrument-mismatch", () => {
    const song = withClips([
      {
        id: "a",
        start: 0,
        length: 1920,
        body: {
          type: "chord",
          chord: { root: 0, quality: "maj" },
          pattern: "drum-basic-rock",
        },
      },
    ]);
    expect(codes(song)).toContain("pattern-instrument-mismatch");
  });

  it("이슈에는 위치를 가리키는 path가 있다", () => {
    const issues = validateSong(
      withClips([emptyClip("a", 0, 1920), emptyClip("b", 960, 1920)]),
    );
    expect(issues[0].path).toBe("tracks[0].clips[1]");
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm test lib/score/validate.test.ts`
Expected: FAIL — `@/lib/score/validate`가 없다.

- [ ] **Step 4: 구현한다**

Create `lib/score/validate.ts`:

```ts
import { MAX_BARS, type Clip, type Song, type Track } from "./model";
import { getPattern } from "./patterns";
import { songLengthTicks } from "./time";

export type ScoreIssueCode =
  | "bars-out-of-range"
  | "duplicate-id"
  | "non-integer-tick"
  | "non-positive-length"
  | "clip-out-of-range"
  | "clip-unsorted"
  | "clip-overlap"
  | "unknown-pattern"
  | "pattern-instrument-mismatch"
  | "note-unsorted"
  | "note-out-of-clip"
  | "pitch-out-of-range"
  | "velocity-out-of-range";

export type ScoreIssue = {
  code: ScoreIssueCode;
  /** `tracks[0].clips[2]` 같은 위치 표기. */
  path: string;
  message: string;
};

/**
 * 곡의 불변식을 전부 검사한다. 빈 배열이면 통과다.
 *
 * 순서나 범위처럼 복구할 수 있는 문제도 여기서는 이슈로 센다 — 복구는
 * 스키마 계층(`song-schema.ts`)이 이 함수를 부르기 전에 한다. 편집 함수가
 * 만든 곡은 항상 이 함수를 통과해야 한다.
 */
export function validateSong(song: Song): ScoreIssue[] {
  const issues: ScoreIssue[] = [];
  const add = (code: ScoreIssueCode, path: string, message: string) =>
    issues.push({ code, path, message });

  if (!Number.isInteger(song.bars) || song.bars < 1 || song.bars > MAX_BARS) {
    add("bars-out-of-range", "bars", `마디 수는 1~${MAX_BARS}의 정수여야 합니다`);
  }

  const songLength = songLengthTicks(song);
  const trackIds = new Set<string>();

  song.tracks.forEach((track, ti) => {
    const trackPath = `tracks[${ti}]`;
    if (trackIds.has(track.id)) {
      add("duplicate-id", trackPath, `트랙 id가 중복됩니다: ${track.id}`);
    }
    trackIds.add(track.id);

    const clipIds = new Set<string>();
    track.clips.forEach((clip, ci) => {
      const path = `${trackPath}.clips[${ci}]`;
      if (clipIds.has(clip.id)) {
        add("duplicate-id", path, `클립 id가 중복됩니다: ${clip.id}`);
      }
      clipIds.add(clip.id);

      checkClipShape(clip, songLength, path, add);
      if (ci > 0) {
        const prev = track.clips[ci - 1];
        if (clip.start < prev.start) {
          add("clip-unsorted", path, "클립이 start 오름차순이 아닙니다");
        } else if (clip.start < prev.start + prev.length) {
          add("clip-overlap", path, "같은 트랙의 클립이 시간상 겹칩니다");
        }
      }
      checkBody(track, clip, path, add);
    });
  });

  return issues;
}

type Add = (code: ScoreIssueCode, path: string, message: string) => void;

function checkClipShape(
  clip: Clip,
  songLength: number,
  path: string,
  add: Add,
): void {
  if (!Number.isInteger(clip.start) || !Number.isInteger(clip.length)) {
    add("non-integer-tick", path, "클립의 start와 length는 정수 틱이어야 합니다");
  }
  if (!(clip.length >= 1)) {
    add("non-positive-length", path, "클립 길이는 1틱 이상이어야 합니다");
  }
  if (clip.start < 0 || clip.start + clip.length > songLength) {
    add("clip-out-of-range", path, "클립이 곡 길이 안에 들어가지 않습니다");
  }
}

function checkBody(track: Track, clip: Clip, path: string, add: Add): void {
  const { body } = clip;

  if (body.type === "chord") {
    const pattern = getPattern(body.pattern);
    if (!pattern) {
      add("unknown-pattern", path, `알 수 없는 패턴입니다: ${body.pattern}`);
    } else if ((pattern.kind === "drum") !== (track.instrument === "drums")) {
      add(
        "pattern-instrument-mismatch",
        path,
        `${track.instrument} 트랙에 쓸 수 없는 패턴입니다: ${body.pattern}`,
      );
    }
    return;
  }

  body.notes.forEach((n, ni) => {
    const notePath = `${path}.notes[${ni}]`;
    if (!Number.isInteger(n.start) || !Number.isInteger(n.length)) {
      add("non-integer-tick", notePath, "음의 start와 length는 정수 틱이어야 합니다");
    }
    if (!(n.length >= 1)) {
      add("non-positive-length", notePath, "음 길이는 1틱 이상이어야 합니다");
    }
    if (n.start < 0 || n.start + n.length > clip.length) {
      add("note-out-of-clip", notePath, "음이 클립 안에 들어가지 않습니다");
    }
    if (ni > 0 && n.start < body.notes[ni - 1].start) {
      add("note-unsorted", notePath, "음이 start 오름차순이 아닙니다");
    }
    if (!Number.isInteger(n.pitch) || n.pitch < 0 || n.pitch > 127) {
      add("pitch-out-of-range", notePath, "pitch는 0~127의 정수여야 합니다");
    }
    if (!(n.velocity >= 0 && n.velocity <= 1)) {
      add("velocity-out-of-range", notePath, "velocity는 0~1이어야 합니다");
    }
  });
}
```

- [ ] **Step 5: 통과를 확인하고 커밋한다**

Run: `pnpm test lib/score/validate.test.ts`
Expected: PASS.

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 통과.

```bash
git add lib/score/testing/builders.ts lib/score/validate.ts lib/score/validate.test.ts
git commit -m "feat(score): 곡 불변식 검증 함수를 추가한다"
```

---

### Task 7: 펼치기와 베이크 `expand.ts`

**Files:**
- Create: `lib/score/expand.ts`, `lib/score/expand.test.ts`

**Interfaces:**
- Consumes: `chordPitch`, `getPattern`, 모델.
- Produces:
  - `type ScheduledNote = { tick: number; length: number; pitch: number; velocity: number }` — `tick`은 곡 시작 기준 절대 틱.
  - `type TrackEvents = { trackId: string; instrument: InstrumentId; events: ScheduledNote[] }`
  - `clipNotes(body: ClipBody, instrument: InstrumentId, clipLength: number): Note[]` — 클립 상대 틱, start 오름차순(안정). 알 수 없는 패턴·악기 불일치는 `Error`.
  - `expandSong(song: Song): TrackEvents[]` — 트랙 순서 유지, `events`는 `tick` 오름차순(안정).
  - `bakeClip(clip: Clip, instrument: InstrumentId): Clip` — `chord` → `notes`(같은 id·start·length). `notes` 클립은 같은 참조를 돌려준다.
  - `bakeClipInSong(song: Song, trackId: string, clipId: string): Song` — 그 클립만 바꾼 새 곡. 못 찾으면 `Error`.
  - `instrumentsOf(song: Song): InstrumentId[]` — 곡에 쓰인 악기(중복 없이, 처음 등장 순서).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `lib/score/expand.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  bakeClip,
  bakeClipInSong,
  clipNotes,
  expandSong,
  instrumentsOf,
} from "@/lib/score/expand";
import type { Chord, Clip, Song } from "@/lib/score/model";
import { songWithNotes } from "@/lib/score/testing/builders";
import { validateSong } from "@/lib/score/validate";

const C_MAJ: Chord = { root: 0, quality: "maj" };
const G_MAJ: Chord = { root: 7, quality: "maj" };

function chordClip(
  id: string,
  start: number,
  length: number,
  chord: Chord,
  pattern: string,
): Clip {
  return { id, start, length, body: { type: "chord", chord, pattern } };
}

function songWith(
  instrument: "piano" | "bass" | "drums",
  clips: Clip[],
  bars = 4,
): Song {
  const song = songWithNotes({ notes: [], bars, instrument });
  song.tracks[0].clips = clips;
  return song;
}

describe("expandSong — notes 클립", () => {
  it("클립 상대 틱을 곡 절대 틱으로 바꾼다", () => {
    const song = songWithNotes({ notes: [], bars: 2 });
    song.tracks[0].clips = [
      {
        id: "a",
        start: 1920,
        length: 1920,
        body: {
          type: "notes",
          notes: [
            { start: 0, length: 480, pitch: 60, velocity: 0.5 },
            { start: 480, length: 480, pitch: 64, velocity: 0.5 },
          ],
        },
      },
    ];
    const [track] = expandSong(song);
    expect(track.events.map((e) => e.tick)).toEqual([1920, 2400]);
    expect(track.events.map((e) => e.pitch)).toEqual([60, 64]);
  });

  it("트랙 id와 악기를 그대로 싣는다", () => {
    const [track] = expandSong(
      songWithNotes({ trackId: "t-9", instrument: "bass", notes: [] }),
    );
    expect(track.trackId).toBe("t-9");
    expect(track.instrument).toBe("bass");
    expect(track.events).toEqual([]);
  });
});

describe("expandSong — 코드 클립", () => {
  it("piano-block은 C장조 3화음을 한 마디 길이로 낸다", () => {
    const song = songWith("piano", [
      chordClip("a", 1920, 1920, C_MAJ, "piano-block"),
    ]);
    const [track] = expandSong(song);
    expect(track.events).toEqual([
      { tick: 1920, length: 1920, pitch: 60, velocity: 0.7 },
      { tick: 1920, length: 1920, pitch: 64, velocity: 0.7 },
      { tick: 1920, length: 1920, pitch: 67, velocity: 0.7 },
    ]);
  });

  it("패턴은 클립 길이만큼 반복된다", () => {
    // bass-root-quarter(한 마디, 4박) × 2마디, G장조 근음 옥타브 2 = 43
    const song = songWith("bass", [
      chordClip("a", 0, 3840, G_MAJ, "bass-root-quarter"),
    ]);
    const [track] = expandSong(song);
    expect(track.events.map((e) => e.tick)).toEqual([
      0, 480, 960, 1440, 1920, 2400, 2880, 3360,
    ]);
    expect(track.events.every((e) => e.pitch === 43 && e.length === 420)).toBe(
      true,
    );
  });

  it("클립 끝을 넘는 음은 끝에서 잘리고 그 뒤 스텝은 버린다", () => {
    // piano-arpeggio-8th 스텝은 240틱 간격. 클립 길이 600이면 0, 240, 480만 남고
    // 480에서 시작하는 음은 120틱(600-480)으로 잘린다.
    const song = songWith("piano", [
      chordClip("a", 0, 600, C_MAJ, "piano-arpeggio-8th"),
    ]);
    const [track] = expandSong(song);
    expect(track.events.map((e) => [e.tick, e.length])).toEqual([
      [0, 240],
      [240, 240],
      [480, 120],
    ]);
  });

  it("같은 시각의 음은 패턴에 적힌 순서를 유지한다(안정 정렬)", () => {
    const [track] = expandSong(
      songWith("piano", [chordClip("a", 0, 1920, C_MAJ, "piano-block")]),
    );
    expect(track.events.map((e) => e.pitch)).toEqual([60, 64, 67]);
  });

  it("드럼 패턴은 코드를 읽지 않고 GM 번호를 그대로 쓴다", () => {
    const [track] = expandSong(
      songWith("drums", [chordClip("a", 0, 1920, C_MAJ, "drum-basic-rock")]),
    );
    // 킥 2 + 스네어 2 + 하이햇 8
    expect(track.events).toHaveLength(12);
    // 같은 틱 0에서는 카탈로그에 먼저 적힌 킥(36)이 하이햇(42)보다 앞선다
    expect(track.events.slice(0, 2).map((e) => e.pitch)).toEqual([36, 42]);
  });

  it("events는 여러 클립에 걸쳐서도 tick 오름차순이다", () => {
    const song = songWith("piano", [
      chordClip("a", 0, 1920, C_MAJ, "piano-arpeggio-8th"),
      chordClip("b", 1920, 1920, G_MAJ, "piano-arpeggio-8th"),
    ]);
    const ticks = expandSong(song)[0].events.map((e) => e.tick);
    expect(ticks).toEqual([...ticks].sort((x, y) => x - y));
    expect(ticks).toHaveLength(16);
  });
});

describe("clipNotes — 오류", () => {
  it("알 수 없는 패턴은 던진다", () => {
    expect(() =>
      clipNotes({ type: "chord", chord: C_MAJ, pattern: "nope" }, "piano", 1920),
    ).toThrow("알 수 없는 패턴");
  });

  it("악기와 맞지 않는 패턴은 던진다", () => {
    expect(() =>
      clipNotes(
        { type: "chord", chord: C_MAJ, pattern: "drum-basic-rock" },
        "piano",
        1920,
      ),
    ).toThrow("맞지 않는 패턴");
  });
});

describe("bake", () => {
  it("chord 클립을 같은 id·start·length의 notes 클립으로 바꾼다", () => {
    const clip = chordClip("a", 1920, 1920, C_MAJ, "piano-block");
    const baked = bakeClip(clip, "piano");
    expect(baked.id).toBe("a");
    expect(baked.start).toBe(1920);
    expect(baked.length).toBe(1920);
    expect(baked.body.type).toBe("notes");
    if (baked.body.type === "notes") {
      expect(baked.body.notes.map((n) => [n.start, n.pitch])).toEqual([
        [0, 60],
        [0, 64],
        [0, 67],
      ]);
    }
  });

  it("notes 클립은 같은 참조를 돌려준다(멱등)", () => {
    const clip: Clip = {
      id: "a",
      start: 0,
      length: 480,
      body: { type: "notes", notes: [] },
    };
    expect(bakeClip(clip, "piano")).toBe(clip);
  });

  it("베이크해도 재생되는 소리는 같다", () => {
    const song = songWith("piano", [
      chordClip("a", 0, 1920, C_MAJ, "piano-arpeggio-8th"),
      chordClip("b", 1920, 1920, G_MAJ, "piano-block"),
    ]);
    const baked = bakeClipInSong(song, "track-1", "a");
    expect(expandSong(baked)).toEqual(expandSong(song));
    expect(validateSong(baked)).toEqual([]);
  });

  it("bakeClipInSong은 그 클립만 바꾸고 원본을 변형하지 않는다", () => {
    const song = songWith("piano", [
      chordClip("a", 0, 1920, C_MAJ, "piano-block"),
      chordClip("b", 1920, 1920, G_MAJ, "piano-block"),
    ]);
    const baked = bakeClipInSong(song, "track-1", "a");
    expect(baked.tracks[0].clips[0].body.type).toBe("notes");
    expect(baked.tracks[0].clips[1]).toBe(song.tracks[0].clips[1]);
    expect(song.tracks[0].clips[0].body.type).toBe("chord");
  });

  it("없는 트랙·클립은 던진다", () => {
    const song = songWith("piano", [chordClip("a", 0, 1920, C_MAJ, "piano-block")]);
    expect(() => bakeClipInSong(song, "nope", "a")).toThrow();
    expect(() => bakeClipInSong(song, "track-1", "nope")).toThrow();
  });
});

describe("instrumentsOf", () => {
  it("곡에 쓰인 악기를 중복 없이 처음 등장 순서로 돌려준다", () => {
    const song = songWithNotes({ notes: [], instrument: "piano" });
    song.tracks.push(
      { id: "t2", instrument: "drums", clips: [] },
      { id: "t3", instrument: "piano", clips: [] },
      { id: "t4", instrument: "bass", clips: [] },
    );
    expect(instrumentsOf(song)).toEqual(["piano", "drums", "bass"]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test lib/score/expand.test.ts`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 3: 구현한다**

Create `lib/score/expand.ts`:

```ts
import { chordPitch } from "./chords";
import type { Clip, ClipBody, InstrumentId, Note, Song } from "./model";
import { getPattern } from "./patterns";

/** 스케줄러가 읽는 음 하나. `tick`은 곡 시작 기준 절대 틱이다. */
export type ScheduledNote = {
  tick: number;
  length: number;
  pitch: number;
  velocity: number;
};

export type TrackEvents = {
  trackId: string;
  instrument: InstrumentId;
  /** tick 오름차순. 같은 tick은 입력 순서를 유지한다. */
  events: ScheduledNote[];
};

/**
 * 클립 하나를 음 목록으로 편다. 반환은 **클립 상대 틱**이고 start 오름차순이다.
 *
 * - `notes` 클립은 이미 음이므로 그대로 돌려준다.
 * - `chord` 클립은 패턴을 클립 길이만큼 반복해 만든다. 클립 끝을 넘는 음은
 *   끝에서 자르고, 끝 이후에 시작하는 스텝은 버린다.
 */
export function clipNotes(
  body: ClipBody,
  instrument: InstrumentId,
  clipLength: number,
): Note[] {
  if (body.type === "notes") return body.notes;

  const pattern = getPattern(body.pattern);
  if (!pattern) throw new Error(`알 수 없는 패턴: ${body.pattern}`);
  if ((pattern.kind === "drum") !== (instrument === "drums")) {
    throw new Error(`${instrument} 트랙에 맞지 않는 패턴: ${body.pattern}`);
  }

  const notes: Note[] = [];
  for (let base = 0; base < clipLength; base += pattern.length) {
    const emit = (at: number, length: number, pitch: number, velocity: number) => {
      const start = base + at;
      if (start >= clipLength) return;
      notes.push({
        start,
        length: Math.min(length, clipLength - start),
        pitch,
        velocity,
      });
    };

    if (pattern.kind === "drum") {
      for (const step of pattern.steps) {
        emit(step.at, step.length, step.pitch, step.velocity);
      }
    } else {
      for (const step of pattern.steps) {
        emit(
          step.at,
          step.length,
          chordPitch(body.chord, step.degree, step.octave),
          step.velocity,
        );
      }
    }
  }

  // Array.prototype.sort는 안정 정렬이다 — 같은 start는 패턴에 적힌 순서를 유지한다.
  return notes.sort((a, b) => a.start - b.start);
}

/**
 * 곡 전체를 트랙별 시간순 이벤트로 편다. **재생과 내보내기가 같은 함수를 쓴다.**
 * 들은 것과 내보낸 것이 다를 수 없게 하는 구조다.
 */
export function expandSong(song: Song): TrackEvents[] {
  return song.tracks.map((track) => {
    const events: ScheduledNote[] = [];
    for (const clip of track.clips) {
      for (const note of clipNotes(clip.body, track.instrument, clip.length)) {
        events.push({
          tick: clip.start + note.start,
          length: note.length,
          pitch: note.pitch,
          velocity: note.velocity,
        });
      }
    }
    events.sort((a, b) => a.tick - b.tick);
    return { trackId: track.id, instrument: track.instrument, events };
  });
}

/**
 * `chord` 클립을 같은 id·start·length의 `notes` 클립으로 바꾼다. 한 방향이다.
 * 음 단위 편집을 시작할 때 쓰고, 실행취소 스택에서는 이 변환이 한 칸이다.
 */
export function bakeClip(clip: Clip, instrument: InstrumentId): Clip {
  if (clip.body.type === "notes") return clip;
  return {
    ...clip,
    body: {
      type: "notes",
      notes: clipNotes(clip.body, instrument, clip.length),
    },
  };
}

export function bakeClipInSong(
  song: Song,
  trackId: string,
  clipId: string,
): Song {
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`트랙을 찾을 수 없습니다: ${trackId}`);
  if (!track.clips.some((c) => c.id === clipId)) {
    throw new Error(`클립을 찾을 수 없습니다: ${clipId}`);
  }
  return {
    ...song,
    tracks: song.tracks.map((t) =>
      t.id !== trackId
        ? t
        : {
            ...t,
            clips: t.clips.map((c) =>
              c.id === clipId ? bakeClip(c, t.instrument) : c,
            ),
          },
    ),
  };
}

/** 곡에 쓰인 악기. 중복 없이 처음 등장한 순서다. 샘플 로딩 대상을 정할 때 쓴다. */
export function instrumentsOf(song: Song): InstrumentId[] {
  return [...new Set(song.tracks.map((t) => t.instrument))];
}
```

- [ ] **Step 4: 통과를 확인하고 커밋한다**

Run: `pnpm test lib/score/expand.test.ts`
Expected: PASS.

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 통과.

```bash
git add lib/score/expand.ts lib/score/expand.test.ts
git commit -m "feat(score): 곡 펼치기와 클립 베이크를 추가한다"
```

---

### Task 8: 스키마와 복구 `song-schema.ts`

**Files:**
- Create: `lib/score/song-schema.ts`, `lib/score/song-schema.test.ts`

**Interfaces:**
- Consumes: Task 4 모델, Task 5 `getPattern`(검증을 통해), Task 6 `validateSong`.
- Produces:
  - `type ParseResult = { ok: true; song: Song; repairs: string[] } | { ok: false; errors: string[] }`
  - `parseSong(input: unknown): ParseResult` — 구조 검증(zod) → 복구 → 불변식 검증(`validateSong`) 순서.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `lib/score/song-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Song } from "@/lib/score/model";
import { parseSong } from "@/lib/score/song-schema";
import { songWithNotes } from "@/lib/score/testing/builders";

const note = (start: number, length: number, pitch = 60, velocity = 0.5) => ({
  start,
  length,
  pitch,
  velocity,
});

/** 매 테스트마다 새 객체를 준다. JSON을 거치므로 파일에서 읽은 것과 같은 모양이다. */
function raw(song: Song = songWithNotes({ notes: [note(0, 480)] })): any {
  return JSON.parse(JSON.stringify(song));
}

describe("parseSong — 통과", () => {
  it("올바른 곡은 그대로 통과하고 복구 기록이 없다", () => {
    const result = parseSong(raw());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repairs).toEqual([]);
      expect(result.song.tracks[0].clips[0].body.type).toBe("notes");
    }
  });

  it("meta의 작업자·편집자·서명 필드를 받는다", () => {
    const input = raw();
    input.meta = {
      title: "내 곡",
      author: { name: "민수", publicKey: "pk-1" },
      editors: [{ name: "지연", publicKey: "pk-2" }],
      signature: "sig",
    };
    const result = parseSong(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.song.meta.author?.name).toBe("민수");
  });

  it("코드 클립을 받는다", () => {
    const input = raw();
    input.tracks[0].clips[0].body = {
      type: "chord",
      chord: { root: 0, quality: "maj" },
      pattern: "piano-block",
    };
    expect(parseSong(input).ok).toBe(true);
  });
});

describe("parseSong — 거부", () => {
  function expectRejected(input: unknown, fragment?: string) {
    const result = parseSong(input);
    expect(result.ok).toBe(false);
    if (!result.ok && fragment) {
      expect(result.errors.join("\n")).toContain(fragment);
    }
  }

  it("객체가 아니면 거부한다", () => {
    expectRejected(null);
    expectRejected("song");
  });

  it("알 수 없는 버전은 거부한다", () => {
    const input = raw();
    input.v = 3;
    expectRejected(input);
  });

  it("알 수 없는 악기는 거부한다", () => {
    const input = raw();
    input.tracks[0].instrument = "violin";
    expectRejected(input);
  });

  it("알 수 없는 코드 종류는 조용히 바꾸지 않고 거부한다", () => {
    const input = raw();
    input.tracks[0].clips[0].body = {
      type: "chord",
      chord: { root: 0, quality: "aug" },
      pattern: "piano-block",
    };
    expectRejected(input);
  });

  it("알 수 없는 패턴 id는 거부한다", () => {
    const input = raw();
    input.tracks[0].clips[0].body = {
      type: "chord",
      chord: { root: 0, quality: "maj" },
      pattern: "no-such-pattern",
    };
    expectRejected(input, "패턴");
  });

  it("같은 트랙의 클립 겹침은 복구하지 않고 거부한다", () => {
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.tracks[0].clips = [
      { id: "a", start: 0, length: 1920, body: { type: "notes", notes: [] } },
      { id: "b", start: 960, length: 1920, body: { type: "notes", notes: [] } },
    ];
    expectRejected(input, "겹칩니다");
  });

  it("곡 밖으로 나간 클립은 거부한다", () => {
    const input = raw();
    input.tracks[0].clips[0].length = 99999;
    expectRejected(input, "곡 길이");
  });

  it("트랙이 하나도 없으면 거부한다", () => {
    const input = raw();
    input.tracks = [];
    expectRejected(input);
  });

  it("Infinity·NaN은 거부한다", () => {
    const a = raw();
    a.tempo = Infinity;
    expectRejected(a);
    const b = raw();
    b.tracks[0].clips[0].body.notes[0].start = Number.NaN;
    expectRejected(b);
  });

  it("bars가 소수거나 상한을 넘으면 거부한다", () => {
    const a = raw();
    a.bars = 1.5;
    expectRejected(a);
    const b = raw();
    b.bars = 501;
    expectRejected(b);
  });

  it("id가 중복되면 거부한다", () => {
    const input = raw();
    input.tracks.push({ ...input.tracks[0] });
    expectRejected(input, "중복");
  });

  it("너무 긴 작업자 이름은 거부한다", () => {
    const input = raw();
    input.meta.author = { name: "가".repeat(51), publicKey: "pk" };
    expectRejected(input);
  });
});

describe("parseSong — 복구", () => {
  function expectRepaired(input: unknown, fragment: string): Song {
    const result = parseSong(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.repairs.join("\n")).toContain(fragment);
    return result.song;
  }

  it("범위를 벗어난 템포는 클램프한다", () => {
    const a = raw();
    a.tempo = 500;
    expect(expectRepaired(a, "템포").tempo).toBe(240);
    const b = raw();
    b.tempo = 10;
    expect(expectRepaired(b, "템포").tempo).toBe(40);
  });

  it("소수 틱은 반올림한다", () => {
    const input = raw(songWithNotes({ notes: [note(0, 480)], bars: 2 }));
    input.tracks[0].clips[0] = {
      id: "a",
      start: 480.4,
      length: 960.6,
      body: { type: "notes", notes: [{ start: 0.4, length: 100.6, pitch: 60, velocity: 0.5 }] },
    };
    const song = expectRepaired(input, "반올림");
    const clip = song.tracks[0].clips[0];
    expect(clip.start).toBe(480);
    expect(clip.length).toBe(961);
    if (clip.body.type === "notes") {
      expect(clip.body.notes[0]).toMatchObject({ start: 0, length: 101 });
    }
  });

  it("범위를 넘은 velocity는 클램프한다", () => {
    const input = raw(songWithNotes({ notes: [note(0, 480, 60, 1.5), note(480, 480, 60, -0.2)] }));
    const song = expectRepaired(input, "velocity");
    const body = song.tracks[0].clips[0].body;
    if (body.type === "notes") {
      expect(body.notes.map((n) => n.velocity)).toEqual([1, 0]);
    }
  });

  it("어긋난 클립 순서를 정렬한다", () => {
    const input = raw(songWithNotes({ notes: [], bars: 2 }));
    input.tracks[0].clips = [
      { id: "b", start: 1920, length: 480, body: { type: "notes", notes: [] } },
      { id: "a", start: 0, length: 480, body: { type: "notes", notes: [] } },
    ];
    const song = expectRepaired(input, "정렬");
    expect(song.tracks[0].clips.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("어긋난 음 순서를 안정 정렬한다", () => {
    const input = raw(
      songWithNotes({
        notes: [note(480, 240, 62), note(0, 240, 60), note(0, 240, 64)],
      }),
    );
    const song = expectRepaired(input, "정렬");
    const body = song.tracks[0].clips[0].body;
    if (body.type === "notes") {
      expect(body.notes.map((n) => n.pitch)).toEqual([60, 64, 62]);
    }
  });

  it("클립 끝을 넘은 음은 끝에서 자른다", () => {
    const input = raw(songWithNotes({ notes: [note(1800, 480)] }));
    const song = expectRepaired(input, "잘랐습니다");
    const body = song.tracks[0].clips[0].body;
    if (body.type === "notes") expect(body.notes[0].length).toBe(120);
  });

  it("클립 끝 이후에 시작하는 음은 버린다", () => {
    const input = raw(songWithNotes({ notes: [note(0, 480), note(1920, 480)] }));
    const song = expectRepaired(input, "버렸습니다");
    const body = song.tracks[0].clips[0].body;
    if (body.type === "notes") expect(body.notes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test lib/score/song-schema.test.ts`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 3: 구현한다**

Create `lib/score/song-schema.ts`:

```ts
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm test lib/score/song-schema.test.ts`
Expected: PASS.

테스트가 실패하면 원인을 먼저 읽는다. 자주 나는 후보 두 가지:
- `parsed.data as Song`에서 타입 불일치(`check-types` 실패) → zod 추론 타입과 `Song`의 차이를 보고 캐스트를 `as unknown as Song`으로 바꾸지 말고 스키마 쪽 타입을 맞춘다.
- 정렬 복구 테스트가 "순서 변경 없음"으로 나옴 → `sorted.some((n, i) => n !== notes[i])`는 참조 비교다. 이미 정렬된 입력에서는 `false`여야 정상이다.
- `Infinity`/`NaN` 거부 테스트가 실패함 → 설치된 zod가 `z.number()`에서 무한대를 통과시키는 것이다(zod 3 동작). 그때는 `noteSchema`·`songSchema`의 숫자를 `z.number().refine(Number.isFinite, { message: "유한한 수가 아닙니다" })`로 바꾼다. 4.4.3에서는 필요 없을 것으로 본다.

- [ ] **Step 5: 전체 검사 후 커밋한다**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 통과. (`raw(): any`가 lint의 `no-explicit-any`에 걸리면 테스트 파일 맨 위에 `/* eslint-disable @typescript-eslint/no-explicit-any -- 파일에서 읽은 값을 흉내내는 테스트 입력 */`를 한 줄 추가한다.)

```bash
git add lib/score/song-schema.ts lib/score/song-schema.test.ts
git commit -m "feat(score): 곡 스키마 검증과 복구를 추가한다"
```

---

### Task 9: 데모 곡 `demo-song.ts`

**Files:**
- Create: `lib/score/demo-song.ts`, `lib/score/demo-song.test.ts`

**Interfaces:**
- Produces: `buildDemoSong(): Song` — 8마디, 120BPM, 4/4. 트랙 5개: `track-piano`(arpeggio 코드 클립 4개), `track-guitar`(strum 코드 클립 4개), `track-bass`(root-quarter 코드 클립 4개), `track-drums`(basic-rock 클립 1개, 8마디), `track-melody`(piano, `notes` 클립 1개). `DEMO_BARS = 8`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Create `lib/score/demo-song.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { DEMO_BARS, buildDemoSong } from "@/lib/score/demo-song";
import { expandSong, instrumentsOf } from "@/lib/score/expand";
import { parseSong } from "@/lib/score/song-schema";
import { validateSong } from "@/lib/score/validate";

describe("데모 곡", () => {
  it("불변식을 모두 만족한다", () => {
    expect(validateSong(buildDemoSong())).toEqual([]);
  });

  it("JSON을 거쳐도 그대로 열린다(복구 없이)", () => {
    const result = parseSong(JSON.parse(JSON.stringify(buildDemoSong())));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repairs).toEqual([]);
  });

  it("8마디, 120BPM, 4/4다", () => {
    const song = buildDemoSong();
    expect(DEMO_BARS).toBe(8);
    expect(song.bars).toBe(8);
    expect(song.tempo).toBe(120);
    expect(song.timeSignature).toEqual([4, 4]);
  });

  it("악기 4종을 모두 쓰고 코드 클립과 음 클립이 섞여 있다", () => {
    const song = buildDemoSong();
    expect(instrumentsOf(song).sort()).toEqual(
      ["bass", "drums", "guitar", "piano"].sort(),
    );
    const bodies = song.tracks.flatMap((t) => t.clips.map((c) => c.body.type));
    expect(bodies).toContain("chord");
    expect(bodies).toContain("notes");
  });

  it("모든 트랙이 소리를 낸다", () => {
    for (const track of expandSong(buildDemoSong())) {
      expect(track.events.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test lib/score/demo-song.test.ts`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 3: 구현한다**

Create `lib/score/demo-song.ts`:

```ts
import type { Chord, Clip, Song, Track } from "./model";
import { ticksPerBar } from "./time";

export const DEMO_BARS = 8;

const BAR = ticksPerBar([4, 4]);

/** C - Am - F - G7, 각 2마디. */
const PROGRESSION: Chord[] = [
  { root: 0, quality: "maj" },
  { root: 9, quality: "min" },
  { root: 5, quality: "maj" },
  { root: 7, quality: "dom7" },
];

function chordClips(prefix: string, pattern: string): Clip[] {
  return PROGRESSION.map((chord, i) => ({
    id: `${prefix}-${i}`,
    start: i * 2 * BAR,
    length: 2 * BAR,
    body: { type: "chord", chord, pattern },
  }));
}

/**
 * 소리 검증 화면이 쓰는 데모 곡. 코드·패턴 클립과 음 클립, 악기 4종을 모두 쓴다.
 * 매 호출마다 새 객체를 돌려준다.
 */
export function buildDemoSong(): Song {
  const tracks: Track[] = [
    {
      id: "track-piano",
      instrument: "piano",
      clips: chordClips("piano", "piano-arpeggio-8th"),
    },
    {
      id: "track-guitar",
      instrument: "guitar",
      clips: chordClips("guitar", "guitar-strum-quarter"),
    },
    {
      id: "track-bass",
      instrument: "bass",
      clips: chordClips("bass", "bass-root-quarter"),
    },
    {
      id: "track-drums",
      instrument: "drums",
      clips: [
        {
          id: "drums-0",
          start: 0,
          length: DEMO_BARS * BAR,
          body: {
            type: "chord",
            // 드럼 패턴은 코드를 읽지 않는다. 스키마가 코드를 요구하므로 자리만 채운다.
            chord: { root: 0, quality: "maj" },
            pattern: "drum-basic-rock",
          },
        },
      ],
    },
    {
      id: "track-melody",
      instrument: "piano",
      clips: [
        {
          id: "melody-0",
          start: 4 * BAR,
          length: 2 * BAR,
          body: {
            type: "notes",
            notes: [
              { start: 0, length: 480, pitch: 72, velocity: 0.7 },
              { start: 480, length: 480, pitch: 76, velocity: 0.7 },
              { start: 960, length: 480, pitch: 79, velocity: 0.7 },
              { start: 1440, length: 480, pitch: 76, velocity: 0.7 },
              { start: 1920, length: 960, pitch: 77, velocity: 0.7 },
              { start: 2880, length: 960, pitch: 74, velocity: 0.7 },
            ],
          },
        },
      ],
    },
  ];

  return {
    v: 2,
    tempo: 120,
    timeSignature: [4, 4],
    bars: DEMO_BARS,
    tracks,
    meta: { title: "데모 곡", editors: [] },
  };
}
```

- [ ] **Step 4: 통과를 확인하고 커밋한다**

Run: `pnpm test lib/score/demo-song.test.ts`
Expected: PASS.

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 통과.

```bash
git add lib/score/demo-song.ts lib/score/demo-song.test.ts
git commit -m "feat(score): 소리 검증용 v2 데모 곡을 추가한다"
```

### Task 10: Scheduler와 Engine을 v2 모델 위로 옮긴다 (원자적)

스케줄러와 엔진은 서로 물려 있어서 한 Task로 옮긴다. 이 Task 안에서는 중간에 `check-types`가 깨지는 구간이 있고, **끝에서 한 번 통과해야 한다.** 악기는 아직 옛 신스 그대로다(Task 12에서 샘플로 바꾼다). 편집은 줄 번호가 아니라 아래 인용 텍스트로 위치를 찾는다.

**Files:**
- Modify: `lib/audio/types.ts`, `lib/audio/scheduler.ts`, `lib/audio/engine.ts`
- Rewrite: `lib/audio/scheduler.test.ts`
- Modify: `lib/audio/engine.test.ts`
- Delete: `lib/score/fixture.ts`, `lib/score/fixture.test.ts`

**Interfaces:**
- Consumes: `TrackEvents`/`expandSong`(Task 7), `Song`/`PPQ`(Task 4), `songLengthTicks`(Task 4), `songWithNotes`(Task 6).
- Produces:
  - `NoteSink.schedule(trackId: string, pitch: number, when: number, dur: number, vel: number): void`
  - `Instrument.play(pitch: number, when: number, dur: number, vel: number): void`
  - `new Scheduler(tracks: readonly TrackEvents[], tempo: number, clock: AudioClock, sink: NoteSink, lookaheadSeconds?: number)`. `setTempo`·`start`·`advance`·`currentTick`·`isDone`·`tempo`는 그대로.
  - `Engine.setSong(song: Song): boolean` — 재생 중이면 거부하고 `false`, 아니면 곡·이벤트·**템포**·악기 맵을 한 번에 갱신하고 `true`.
  - `Engine.getTempo(): number`

#### Part A — Scheduler

- [ ] **Step 1: 스케줄러 테스트를 새 입력으로 다시 쓴다**

Replace the whole of `lib/audio/scheduler.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { Scheduler } from "@/lib/audio/scheduler";
import type { AudioClock, NoteSink } from "@/lib/audio/types";
import type { ScheduledNote, TrackEvents } from "@/lib/score/expand";
import { DRUM_HIHAT, DRUM_KICK, PPQ } from "@/lib/score/model";
import { ticksToSeconds } from "@/lib/score/time";

class FakeClock implements AudioClock {
  currentTime = 0;
  advanceBy(seconds: number): void {
    this.currentTime += seconds;
  }
}

type Recorded = {
  trackId: string;
  pitch: number;
  when: number;
  dur: number;
  vel: number;
};

class RecordingSink implements NoteSink {
  readonly events: Recorded[] = [];
  schedule(
    trackId: string,
    pitch: number,
    when: number,
    dur: number,
    vel: number,
  ): void {
    this.events.push({ trackId, pitch, when, dur, vel });
  }
}

const TEMPO = 120;
const BARS = 16;

/**
 * 16마디(120BPM에서 32초) 곡의 이벤트.
 * 피아노: 마디마다 3화음(60·64·67), 길이 한 마디.
 * 드럼: 8분음표(240틱)마다 하이햇, 마디 첫 박에 킥.
 * 스케줄러는 곡의 내용을 모른다 — 이벤트가 시간순이라는 것만 믿는다.
 */
function demoEvents(): TrackEvents[] {
  const piano: ScheduledNote[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    for (const pitch of [60, 64, 67]) {
      piano.push({ tick: bar * 1920, length: 1920, pitch, velocity: 0.7 });
    }
  }
  const drums: ScheduledNote[] = [];
  for (let i = 0; i < BARS * 8; i++) {
    drums.push({ tick: i * 240, length: 120, pitch: DRUM_HIHAT, velocity: 0.5 });
    if (i % 8 === 0) {
      drums.push({ tick: i * 240, length: 240, pitch: DRUM_KICK, velocity: 0.9 });
    }
  }
  return [
    { trackId: "track-piano", instrument: "piano", events: piano },
    { trackId: "track-drums", instrument: "drums", events: drums },
  ];
}

function totalCount(tracks: TrackEvents[]): number {
  return tracks.reduce((sum, t) => sum + t.events.length, 0);
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
  let tracks: TrackEvents[];
  let clock: FakeClock;
  let sink: RecordingSink;
  let scheduler: Scheduler;

  beforeEach(() => {
    tracks = demoEvents();
    clock = new FakeClock();
    sink = new RecordingSink();
    scheduler = new Scheduler(tracks, TEMPO, clock, sink);
    scheduler.start(0);
  });

  it("곡을 끝까지 굴리면 모든 음이 정확히 한 번씩 예약된다", () => {
    run(scheduler, clock, 33);
    expect(sink.events).toHaveLength(totalCount(tracks));
    expect(scheduler.isDone()).toBe(true);
  });

  it("예약 시각이 음악적 시간과 일치한다", () => {
    run(scheduler, clock, 5);
    const piano = sink.events.filter((e) => e.trackId === "track-piano");
    // 피아노는 마디마다 3화음 하나 — 첫 마디는 0초, 둘째 마디는 2초
    expect(piano[0].when).toBeCloseTo(0, 9);
    expect(piano[3].when).toBeCloseTo(ticksToSeconds(1920, TEMPO), 9);
    expect(piano[3].when).toBeCloseTo(2, 9);
  });

  it("예약 길이가 이벤트 길이와 일치한다", () => {
    run(scheduler, clock, 3);
    const piano = sink.events.find((e) => e.trackId === "track-piano")!;
    // 한 마디(1920틱) = 120BPM에서 2초
    expect(piano.dur).toBeCloseTo(2, 9);
  });

  it("pitch와 velocity를 그대로 넘긴다", () => {
    run(scheduler, clock, 0.05);
    const first = sink.events.find((e) => e.trackId === "track-piano")!;
    expect(first.pitch).toBe(60);
    expect(first.vel).toBe(0.7);
  });

  it("같은 이벤트를 두 번 예약하지 않는다", () => {
    run(scheduler, clock, 33);
    const keys = sink.events.map((e) => `${e.trackId}:${e.pitch}:${e.when}`);
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

  it("horizon 경계에 정확히 걸친 이벤트는 다음 틱으로 넘어간다", () => {
    const boundarySink = new RecordingSink();
    // 피아노 둘째 마디는 1920틱(120BPM에서 2.0초)이므로
    // lookahead를 2초로 잡아 그 경계에 정확히 걸리게 한다
    const s = new Scheduler(demoEvents(), TEMPO, new FakeClock(), boundarySink, 2);
    s.start(0);
    s.advance();
    const pianoWhens = boundarySink.events
      .filter((e) => e.trackId === "track-piano")
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
    const sch = new Scheduler(demoEvents(), TEMPO, c, s2);
    sch.start(10.5);
    sch.advance();
    expect(s2.events.every((e) => e.when >= 10.5)).toBe(true);
  });

  it("이벤트가 없는 트랙만 있어도 바로 끝난 상태다", () => {
    const empty = new Scheduler(
      [{ trackId: "t", instrument: "piano", events: [] }],
      TEMPO,
      new FakeClock(),
      new RecordingSink(),
    );
    empty.start(0);
    expect(empty.isDone()).toBe(true);
  });
});

describe("Scheduler.setTempo", () => {
  function setup() {
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(demoEvents(), TEMPO, clock, sink);
    scheduler.start(0);
    return { clock, sink, scheduler };
  }

  it("템포를 바꿔도 이미 예약된 구간과 새 구간 사이에 틈이나 겹침이 없다", () => {
    const { clock, sink, scheduler } = setup();

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

    // 순서만 보면 "현재 위치(3840틱)에 재앵커"처럼 잘못 구현해도 통과한다.
    // 하이햇은 3840틱과 4080틱에 있어 setTempo가 옮기는 경계(scheduledUntilTick
    // = 3936틱)를 사이에 두고 걸친다. 3840틱은 경계 이전이라 120BPM으로 이미
    // 예약됐고(when=4.0), 4080틱은 경계 이후라 240BPM으로 예약된다:
    // 4.1 + (4080 - 3936) / 480 * (60 / 240) = 4.175.
    // 틀린 앵커(3840@4.0)로 계산하면 간격이 0.125가 되어 이 값과 어긋난다.
    const hihatWhens = sink.events
      .filter((e) => e.trackId === "track-drums" && e.pitch === DRUM_HIHAT)
      .map((e) => e.when);
    const beforeBoundary = hihatWhens.find((w) => Math.abs(w - 4.0) < 1e-9);
    const afterBoundary = hihatWhens.find((w) => Math.abs(w - 4.175) < 1e-9);
    expect(beforeBoundary).toBeDefined();
    expect(afterBoundary).toBeDefined();
    expect(afterBoundary! - beforeBoundary!).toBeCloseTo(0.175, 9);
  });

  it("템포를 바꾸면 이후 간격이 새 템포를 따른다", () => {
    const { clock, sink, scheduler } = setup();
    scheduler.setTempo(240);
    run(scheduler, clock, 5);

    const piano = sink.events
      .filter((e) => e.trackId === "track-piano")
      .map((e) => e.when);
    // 240BPM에서 한 마디(1920틱)는 1초
    const uniqueStarts = [...new Set(piano)].sort((a, b) => a - b);
    expect(uniqueStarts[1] - uniqueStarts[0]).toBeCloseTo(1, 6);
  });

  it("tempo 프로퍼티가 현재 값을 돌려준다", () => {
    const { scheduler } = setup();
    expect(scheduler.tempo).toBe(TEMPO);
    scheduler.setTempo(90);
    expect(scheduler.tempo).toBe(90);
  });

  it("템포를 바꿔도 currentTick이 뒤로 가지 않고, lookahead 구간 안에서는 옛 템포를 따른다", () => {
    const { clock, scheduler } = setup();

    // 4초까지 120BPM으로 굴린다. scheduledUntilTick은 timeToTick(4.1) = 3936.
    run(scheduler, clock, 4);
    const beforeTempoChange = scheduler.currentTick();
    expect(beforeTempoChange).toBeCloseTo(3840, 6);

    scheduler.setTempo(240);

    // 시계는 그대로인데 새 앵커(3936@4.1)에서 새 템포로 역산하면 뒤로
    // 튄다 — 3840에서 그대로 이어져야 한다.
    expect(scheduler.currentTick()).toBeCloseTo(beforeTempoChange, 6);
    expect(scheduler.currentTick()).toBeGreaterThanOrEqual(
      beforeTempoChange - 1e-9,
    );

    // t=4.05: 아직 새 앵커 시각(4.1) 이전이므로 옛 템포(120BPM)로 계속
    // 전진해야 한다. 실제로 예약된 소리도 옛 템포로 울리는 구간이다.
    clock.advanceBy(0.05);
    expect(scheduler.currentTick()).toBeCloseTo(3888, 6);
    expect(scheduler.currentTick()).toBeGreaterThan(beforeTempoChange);

    // t=4.1: 새 앵커 시각에 도달 — 옛 앵커와 새 앵커 양쪽으로 계산해도
    // 같은 값(3936)으로 수렴해야 틈이나 겹침이 없다.
    clock.advanceBy(0.05);
    expect(scheduler.currentTick()).toBeCloseTo(3936, 6);
  });

  it("한 lookahead 구간 안에서 템포를 연달아 바꿔도 currentTick이 뒤로 가지 않는다", () => {
    // 슬라이더 드래그는 pointermove마다 setTempo를 부른다. 두 번째 호출이
    // 아직 살아 있는 prevAnchor를 덮어쓰면, 지금 울리고 있는 구간을 중간
    // 템포로 역산해 재생 위치가 다시 뒤로 튄다.
    const { clock, scheduler } = setup();

    run(scheduler, clock, 4);
    const before = scheduler.currentTick();
    expect(before).toBeCloseTo(3840, 6);

    // 시계를 전혀 전진시키지 않고 연달아 두 번 — 드래그의 최악 사례
    scheduler.setTempo(240);
    scheduler.setTempo(300);

    // 이 구간의 소리는 여전히 120BPM으로 예약돼 있으므로 위치도 그대로다
    expect(scheduler.currentTick()).toBeCloseTo(before, 6);

    // 새 앵커 시각(4.1) 이전까지는 옛 템포(120BPM)로 전진한다
    clock.advanceBy(0.05);
    expect(scheduler.currentTick()).toBeCloseTo(3888, 6);
    expect(scheduler.currentTick()).toBeGreaterThan(before);
  });
});

describe("Scheduler 커서", () => {
  it("커서는 뒤로 가지 않는다", () => {
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(demoEvents(), TEMPO, clock, sink);
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
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const scheduler = new Scheduler(demoEvents(), TEMPO, clock, sink);
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

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test lib/audio/scheduler.test.ts`
Expected: FAIL — 새 생성자 시그니처와 `NoteSink`의 맞지 않는 타입 때문에 타입/런타임 오류가 난다.

- [ ] **Step 3: `lib/audio/types.ts`를 바꾼다**

Replace the whole `NoteSink` and `Instrument` interfaces in `lib/audio/types.ts` (the `AudioClock` interface stays). The file becomes:

```ts
/** 스케줄러가 시간을 읽는 통로. 실제 실행에서는 AudioContext가 이 모양을 만족한다. */
export interface AudioClock {
  readonly currentTime: number;
}

/** 스케줄러가 예약을 내보내는 통로. 실제 실행에서는 악기 디스패처가 받는다. */
export interface NoteSink {
  schedule(
    trackId: string,
    pitch: number,
    when: number,
    dur: number,
    vel: number,
  ): void;
}

/** 하나의 악기. when은 audioContext.currentTime 기준 절대 초. */
export interface Instrument {
  play(pitch: number, when: number, dur: number, vel: number): void;
}
```

- [ ] **Step 4: `lib/audio/scheduler.ts`를 고친다**

(1) 첫 줄 import를 교체한다.

old:
```ts
import { PPQ, type Song } from "@/lib/score/types";
```
new:
```ts
import type { TrackEvents } from "@/lib/score/expand";
import { PPQ } from "@/lib/score/model";
```

(2) 필드 두 곳을 교체한다.

old:
```ts
  private readonly song: Song;
```
new:
```ts
  private readonly tracks: readonly TrackEvents[];
```

old:
```ts
  /** 라인별 "다음에 예약할 타일" 인덱스. 전체 스캔을 피하는 장치. */
```
new:
```ts
  /** 트랙별 "다음에 예약할 이벤트" 인덱스. 전체 스캔을 피하는 장치. */
```

(3) 생성자를 교체한다. old (생성자 전체):
```ts
  constructor(
    song: Song,
    clock: AudioClock,
    sink: NoteSink,
    lookaheadSeconds = LOOKAHEAD_SECONDS,
  ) {
    this.song = song;
    this.clock = clock;
    this.sink = sink;
    this.lookahead = lookaheadSeconds;
    this.bpm = song.tempo;
    // start() 전에 advance()가 불려도 undefined 커서로 조용히 no-op하지
    // 않도록 라인 수만큼 0으로 채워 둔다.
    this.cursors = song.lines.map(() => 0);
  }
```
new:
```ts
  constructor(
    tracks: readonly TrackEvents[],
    tempo: number,
    clock: AudioClock,
    sink: NoteSink,
    lookaheadSeconds = LOOKAHEAD_SECONDS,
  ) {
    this.tracks = tracks;
    this.clock = clock;
    this.sink = sink;
    this.lookahead = lookaheadSeconds;
    this.bpm = tempo;
    // start() 전에 advance()가 불려도 undefined 커서로 조용히 no-op하지
    // 않도록 트랙 수만큼 0으로 채워 둔다.
    this.cursors = tracks.map(() => 0);
  }
```

(4) `start()` 안의 한 줄을 교체한다.

old: `    this.cursors = this.song.lines.map(() => 0);`
new: `    this.cursors = this.tracks.map(() => 0);`

(5) `isDone()`을 교체한다.

old:
```ts
    return this.song.lines.every(
      (line, i) => this.cursors[i] >= line.tiles.length,
    );
```
new:
```ts
    return this.tracks.every(
      (track, i) => this.cursors[i] >= track.events.length,
    );
```

(6) `advance()`의 라인 루프를 교체한다. old:
```ts
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
```
new:
```ts
    this.tracks.forEach((track, i) => {
      let cursor = this.cursors[i];

      while (cursor < track.events.length) {
        const event = track.events[cursor];
        // 경계에 정확히 걸친 이벤트는 다음 틱으로 넘긴다
        if (event.tick >= horizonTick) break;

        const when = this.tickToTime(event.tick);
        const dur = (event.length / PPQ) * (60 / this.bpm);
        this.sink.schedule(track.trackId, event.pitch, when, dur, event.velocity);
        cursor++;
      }

      this.cursors[i] = cursor;
    });
```

- [ ] **Step 5: 스케줄러 테스트 통과를 확인한다**

Run: `pnpm test lib/audio/scheduler.test.ts`
Expected: PASS (스케줄러 파일 자체는 엔진과 독립적으로 컴파일되어 vitest가 돈다. `check-types`는 엔진을 고칠 때까지 실패해도 된다.)

#### Part B — Engine

- [ ] **Step 6: 엔진 테스트를 새 곡 모델로 옮기고 새 동작을 추가한다**

In `lib/audio/engine.test.ts`:

(1) import를 바꾼다. 아래 두 줄을 삭제한다:
```ts
import { ticksPerBar } from "@/lib/score/time";
import type { Song } from "@/lib/score/types";
```
그리고 그 자리에 넣는다:
```ts
import type { Song } from "@/lib/score/model";
import { songWithNotes } from "@/lib/score/testing/builders";
```

(2) `songWithLongTail` 함수(그 위의 `/** 마지막 박에 짧은 타일 하나만 있는 1마디 곡. … */` 주석 포함)를 통째로 아래로 교체한다:

```ts
/**
 * 마지막 박에 짧은 음 하나만 있는 1마디 곡.
 *
 * 악기는 음 길이보다 오래 울린다(피아노는 최소 0.3초). 음이 짧을수록
 * 곡 끝을 넘어 남는 여운이 길어져서, auto-stop이 그 여운을 기다리는지
 * 확인하기 좋다. 데모 곡으로는 여운이 5ms밖에 안 남아 판별이 안 된다.
 */
function songWithLongTail(): Song {
  return songWithNotes({
    notes: [
      // 마디 거의 끝. 16분음표 길이 — 엔벨로프 하한(0.3초)보다 훨씬 짧다.
      { start: 1800, length: 120, velocity: 0.7, pitch: 60 },
    ],
  });
}
```

(3) `songWithLine` 함수(위의 `/** 라인 하나짜리 1마디 곡. … */` 주석 포함)와 `describe("Engine setSong — 악기 맵 동기화", …)` 블록 전체를 아래로 교체한다:

```ts
/** 트랙 하나짜리 1마디 곡. 트랙 id와 음을 인자로 받아 setSong 전후 곡을 쉽게 만든다. */
function songWithTrack(trackId: string, pitch: number): Song {
  return songWithNotes({
    trackId,
    // 재생 시작 즉시(첫 onTimer) 예약되도록 곡 맨 앞
    notes: [{ start: 0, length: 480, velocity: 0.7, pitch }],
  });
}

describe("Engine setSong — 악기 맵 동기화", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("불러온 곡의 트랙 id가 바뀌면 새 트랙도 소리가 난다", async () => {
    // 재현: 재생 한 번으로 악기 맵을 만들고(buildGraph는 최초 1회만 돈다),
    // 정지 후 트랙 id가 다른 곡을 setSong으로 갈아끼운다. 맵을 다시 채우지
    // 않으면 sink.schedule의 `this.instruments.get(trackId)?.play(...)`가
    // 새 id를 찾지 못해 예외도 로그도 없이 그 트랙 전체가 무음이 된다.
    const ctx = new FakeAudioContext();
    const engine = new Engine(
      songWithTrack("track-old", 60),
      immediateProvider(ctx),
    );

    await engine.play();
    tick(ctx); // tick 0의 음이 예약되며 오실레이터 3개(부분음)가 생긴다
    const oscillatorsAfterFirstPlay = ctx.created.filter(
      (n) => n.kind === "oscillator",
    ).length;
    expect(oscillatorsAfterFirstPlay).toBeGreaterThan(0);

    engine.stop();

    engine.setSong(songWithTrack("track-new", 67));

    await engine.play();
    tick(ctx);

    const oscillatorsAfterSecondPlay = ctx.created.filter(
      (n) => n.kind === "oscillator",
    ).length;

    // 두 번째 재생에서도 새 트랙의 음이 실제로 악기까지 도달해 오실레이터가
    // 새로 생겨야 한다. 맵이 갱신되지 않으면 이 수가 늘지 않는다.
    expect(oscillatorsAfterSecondPlay).toBeGreaterThan(
      oscillatorsAfterFirstPlay,
    );
  });
});

describe("Engine setSong — 템포와 재생 중 거부", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("정지 중 setSong은 곡의 템포를 엔진에 함께 적용하고 true를 돌려준다", () => {
    // song.tempo가 유일한 진실이다. 호출부가 setTempo를 따로 부르는 것에
    // 기대면 빠뜨리는 순간 화면과 재생 속도가 영구히 갈라진다.
    const engine = new Engine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
    );
    expect(engine.getTempo()).toBe(120);

    const applied = engine.setSong({ ...songWithTrack("t", 60), tempo: 90 });

    expect(applied).toBe(true);
    expect(engine.getTempo()).toBe(90);
  });

  it("재생 중 setSong은 거부하고 곡도 템포도 바꾸지 않는다", async () => {
    const engine = new Engine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
    );
    await engine.play();

    const applied = engine.setSong({ ...songWithTrack("t", 60), tempo: 90 });

    expect(applied).toBe(false);
    expect(engine.getTempo()).toBe(120);
    engine.stop();
  });

  it("재생 중에도 setTempo는 허용된다", async () => {
    const engine = new Engine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
    );
    await engine.play();

    engine.setTempo(100);

    expect(engine.getTempo()).toBe(100);
    engine.stop();
  });
});
```

(4) `describe("Engine 자동 정지", …)`는 그대로 둔다(옛 신스 피아노로 같은 의미가 유지된다).

- [ ] **Step 7: 실패를 확인한다**

Run: `pnpm test lib/audio/engine.test.ts`
Expected: FAIL — 엔진이 아직 `lengthTicks`·`lines`를 읽고 `getTempo`·새 `setSong`이 없다.

- [ ] **Step 8: `lib/audio/engine.ts`를 고친다**

(1) import 두 줄을 교체한다.

old:
```ts
import { ticksPerBar, ticksPerBeat } from "@/lib/score/time";
import type { Song } from "@/lib/score/types";
```
new:
```ts
import { expandSong, type TrackEvents } from "@/lib/score/expand";
import type { Song } from "@/lib/score/model";
import { songLengthTicks, ticksPerBar, ticksPerBeat } from "@/lib/score/time";
```

(2) 필드를 추가한다. old:
```ts
  private song: Song;

  private ctx: AudioContext | null = null;
```
new:
```ts
  private song: Song;
  /** `expandSong`으로 편 이벤트. 재생과 내보내기가 같은 함수를 쓴다. */
  private events: TrackEvents[];

  private ctx: AudioContext | null = null;
```

(3) 생성자 본문을 교체한다. old:
```ts
    this.song = song;
    this.bpm = song.tempo;
    this.contextProvider = contextProvider;
```
new:
```ts
    this.song = song;
    this.events = expandSong(song);
    this.bpm = song.tempo;
    this.contextProvider = contextProvider;
```

(4) `isPlaying()` 바로 아래에 추가한다:
```ts
  getTempo(): number {
    return this.bpm;
  }
```

(5) `play()` 안의 예약 부분을 교체한다. old:
```ts
      const sink: NoteSink = {
        schedule: (lineId, note, when, dur, vel) => {
          this.instruments.get(lineId)?.play(note, when, dur, vel);
        },
      };

      const startTime = ctx.currentTime + START_DELAY;
      this.scheduler = new Scheduler(this.song, ctx, sink);
      this.scheduler.setTempo(this.bpm);
      this.scheduler.start(startTime);
```
new:
```ts
      const sink: NoteSink = {
        schedule: (trackId, pitch, when, dur, vel) => {
          this.instruments.get(trackId)?.play(pitch, when, dur, vel);
        },
      };

      const startTime = ctx.currentTime + START_DELAY;
      this.scheduler = new Scheduler(this.events, this.bpm, ctx, sink);
      this.scheduler.start(startTime);
```

(6) `setSong` 메서드 전체(`곡을 갈아끼운다.`로 시작하는 `/** … */` 주석부터 메서드의 닫는 `}`까지)를 교체한다:

```ts
  /**
   * 곡을 갈아끼운다. 편집은 정지 중에만 일어나므로 다음 play()부터 반영된다.
   *
   * 재생 중에는 거부하고 false를 돌려준다. 트랙별 커서가 이벤트 인덱스라,
   * 재생 중 이벤트가 바뀌면 노트가 조용히 누락되기 때문이다.
   *
   * 곡·이벤트·템포·악기 맵을 **한 번에** 맞춘다. `song.tempo`가 템포의
   * 유일한 진실이므로 호출부가 setTempo를 따로 부를 필요가 없다 — 옛
   * 설계에서는 그 책임이 호출부에 있어서, 빠뜨리면 화면과 재생 속도가
   * 영구히 갈라졌다. 재생 중 템포 변경은 setTempo가 맡는다.
   *
   * 트랙 구성(id·instrument 순서)이 바뀌면 악기 맵을 다시 채운다. 파일을
   * 불러오면 트랙 id나 악기가 다른 곡이 통째로 들어올 수 있고, 맵을 그대로
   * 두면 sink.schedule의 `this.instruments.get(trackId)`가 못 찾은 트랙을
   * 조용히 무시하거나(무음) 옛 악기로 재생한다. ctx/pool이 아직 없으면(한 번도
   * play()하지 않았거나 dispose된 뒤라면) 다시 채울 그래프 자체가 없다 —
   * 다음 buildGraph()가 새 곡의 트랙으로 정확히 채운다.
   */
  setSong(song: Song): boolean {
    if (this.playing) return false;

    if (this.ctx && this.pool && !sameTrackComposition(this.song, song)) {
      this.instruments.clear();
      for (const track of song.tracks) {
        this.instruments.set(
          track.id,
          createInstrument(track.instrument, this.ctx, this.pool),
        );
      }
    }

    this.song = song;
    this.events = expandSong(song);
    this.bpm = song.tempo;
    return true;
  }
```

(7) `buildGraph`의 악기 채우기 루프를 교체한다. old:
```ts
    for (const line of this.song.lines) {
      this.instruments.set(line.id, createInstrument(line.instrument, ctx, pool));
    }
```
new:
```ts
    for (const track of this.song.tracks) {
      this.instruments.set(
        track.id,
        createInstrument(track.instrument, ctx, pool),
      );
    }
```
그리고 그 위 주석 블록 안의 `라인`이라는 단어를 `트랙`으로, `this.instruments.get(lineId)`를 `this.instruments.get(trackId)`로 바꾼다.

(8) `onTimer`의 곡 끝 판정을 교체한다. old:
```ts
    const pastEnd = scheduler.currentTick() > this.song.lengthTicks;
```
new:
```ts
    const pastEnd = scheduler.currentTick() > songLengthTicks(this.song);
```

(9) `scheduleClicks`의 루프 조건을 교체한다. old:
```ts
    while (this.nextClickTick <= this.song.lengthTicks) {
```
new:
```ts
    while (this.nextClickTick <= songLengthTicks(this.song)) {
```

(10) 파일 맨 아래 `sameLineComposition` 함수(주석 포함)를 교체한다:

```ts
/**
 * 두 곡의 트랙 구성(순서·id·instrument)이 같은지 본다.
 *
 * 클립 내용(음, 세기, 길이 등)은 보지 않는다 — 그건 expandSong이 매번
 * 새로 펴므로 악기 맵과 무관하다. 여기서 보는 것은 오직 "sink.schedule이
 * trackId로 인스트루먼트를 찾을 수 있는가"에 영향을 주는 두 가지, id와
 * instrument뿐이다.
 */
function sameTrackComposition(a: Song, b: Song): boolean {
  if (a.tracks.length !== b.tracks.length) return false;
  return a.tracks.every(
    (track, i) =>
      track.id === b.tracks[i].id && track.instrument === b.tracks[i].instrument,
  );
}
```

- [ ] **Step 9: 옛 fixture를 지운다**

```bash
grep -rn "score/fixture" lib app components 2>/dev/null
```
Expected: 출력 없음(스케줄러·엔진 테스트가 더 이상 쓰지 않는다).

```bash
git rm lib/score/fixture.ts lib/score/fixture.test.ts
```

- [ ] **Step 10: 전체 검사를 통과시킨다**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 전부 통과. 엔진 테스트의 기존 케이스(시작 레이스 5, 자동 정지 2)가 그대로 통과해야 한다 — 실패하면 세션 번호 로직을 건드린 것이다.

- [ ] **Step 11: 커밋한다**

```bash
git add -A
git commit -m "refactor(audio): 스케줄러와 엔진을 v2 곡 모델 위로 옮긴다"
```

---

### Task 11: SampleBank — 컨텍스트 없는 fetch와 컨텍스트 뒤의 decode

**Files:**
- Create: `lib/audio/samples/manifest.ts`, `lib/audio/samples/manifest.test.ts`
- Create: `lib/audio/samples/bank.ts`, `lib/audio/samples/bank.test.ts`
- Modify: `lib/audio/testing/fake-audio.ts`

**Interfaces:**
- Produces (`manifest.ts`):
  - `type SampleZone = { file: string; centerPitch: number; loPitch: number; hiPitch: number }`
  - `type SampleManifest = { instrument: InstrumentId; zones: SampleZone[] }`
  - `parseManifest(input: unknown, expected: InstrumentId): SampleManifest` — 실패하면 `Error`.
  - `findZone(zones: readonly SampleZone[], pitch: number): SampleZone` — pitch를 덮는 존, 없으면 범위까지 거리가 가장 가까운 존(무음으로 떨어지지 않는다).
  - `playbackRateFor(pitch: number, centerPitch: number): number` — `2 ** ((pitch - centerPitch) / 12)`
- Produces (`bank.ts`, `"use client"` 불필요 — 모듈 스코프에서 `fetch`/`AudioContext`를 부르지 않는다):
  - `type SampleStatus = "idle" | "loading" | "downloaded" | "ready" | "error"` (spec 4.3의 4상태에 `downloaded`를 더했다 — 받았지만 컨텍스트가 없어 디코드를 못 한 상태. 화면이 "불러오는 중"으로 거짓말하지 않게 한다.)
  - `type SampleReadiness = { ok: true } | { ok: false; failed: InstrumentId[] }`
  - `type Decoder = { decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> }`
  - `type SampleHit = { buffer: AudioBuffer; rate: number }`
  - `interface SamplePort { prefetch(instruments: readonly InstrumentId[]): void; ensureReady(ctx: Decoder, instruments: readonly InstrumentId[]): Promise<SampleReadiness>; zoneFor(instrument: InstrumentId, pitch: number): SampleHit | null }`
  - `class SampleBank implements SamplePort` — `constructor(opts: { baseUrl: string; fetchBytes: (url: string) => Promise<ArrayBuffer>; enabled?: boolean })`, `status(i)`, `getSnapshot()`, `subscribe(listener)`. `enabled: false`면 `prefetch`가 아무것도 받지 않는다(`ensureReady`는 그대로 받는다 — 그건 사용자 제스처 뒤 클라이언트에서만 불린다). 기본값은 `true`다.
  - `browserFetchBytes(url: string): Promise<ArrayBuffer>`, `defaultSampleBank(): SampleBank`

- [ ] **Step 1: 가짜 오디오를 확장한다**

In `lib/audio/testing/fake-audio.ts`:

(1) `FakeBufferSourceNode`에 `playbackRate`를 추가한다. old:
```ts
class FakeBufferSourceNode extends FakeScheduledSource {
  buffer: unknown = null;
```
new:
```ts
class FakeBufferSourceNode extends FakeScheduledSource {
  buffer: unknown = null;
  readonly playbackRate = new FakeAudioParam();
```

(2) `FakeAudioContext`에 `decodeAudioData`를 추가한다. `async resume()` 메서드 바로 위에 넣는다:
```ts
  /** decodeAudioData에 들어온 바이트. 몇 번, 무엇을 디코드했는지 검사한다. */
  readonly decoded: ArrayBuffer[] = [];
  /** true면 decodeAudioData가 실패한다. */
  failDecode = false;

  async decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    this.decoded.push(data);
    if (this.failDecode) throw new Error("decode 실패");
    return {
      duration: 1,
      length: 48000,
      sampleRate: 48000,
      numberOfChannels: 1,
    } as unknown as AudioBuffer;
  }

```

- [ ] **Step 2: 매니페스트의 실패하는 테스트를 쓴다**

Create `lib/audio/samples/manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  findZone,
  parseManifest,
  playbackRateFor,
  type SampleZone,
} from "@/lib/audio/samples/manifest";

const ZONES: SampleZone[] = [
  { file: "low.wav", centerPitch: 48, loPitch: 40, hiPitch: 55 },
  { file: "high.wav", centerPitch: 72, loPitch: 65, hiPitch: 79 },
];

describe("parseManifest", () => {
  it("올바른 매니페스트를 받는다", () => {
    const m = parseManifest({ instrument: "piano", zones: ZONES }, "piano");
    expect(m.zones).toHaveLength(2);
  });

  it("기대한 악기와 다르면 던진다", () => {
    expect(() =>
      parseManifest({ instrument: "bass", zones: ZONES }, "piano"),
    ).toThrow("piano");
  });

  it("존이 없으면 던진다", () => {
    expect(() => parseManifest({ instrument: "piano", zones: [] }, "piano")).toThrow();
  });

  it("lo <= center <= hi가 아니면 던진다", () => {
    expect(() =>
      parseManifest(
        {
          instrument: "piano",
          zones: [{ file: "a.wav", centerPitch: 60, loPitch: 61, hiPitch: 70 }],
        },
        "piano",
      ),
    ).toThrow();
  });

  it("구조가 틀리면 던진다", () => {
    expect(() => parseManifest("nope", "piano")).toThrow();
    expect(() => parseManifest({ instrument: "piano" }, "piano")).toThrow();
  });
});

describe("findZone", () => {
  it("pitch를 덮는 존을 고른다", () => {
    expect(findZone(ZONES, 50).file).toBe("low.wav");
    expect(findZone(ZONES, 70).file).toBe("high.wav");
    expect(findZone(ZONES, 55).file).toBe("low.wav"); // 경계 포함
    expect(findZone(ZONES, 65).file).toBe("high.wav");
  });

  it("어느 존도 덮지 않는 pitch는 범위가 가장 가까운 존을 고른다(무음으로 떨어지지 않는다)", () => {
    expect(findZone(ZONES, 10).file).toBe("low.wav"); // 아래쪽 바깥
    expect(findZone(ZONES, 120).file).toBe("high.wav"); // 위쪽 바깥
    expect(findZone(ZONES, 57).file).toBe("low.wav"); // 틈: low와 2, high와 8
    expect(findZone(ZONES, 63).file).toBe("high.wav"); // 틈: low와 8, high와 2
  });
});

describe("playbackRateFor", () => {
  it("같은 음이면 1, 한 옥타브 위면 2, 아래면 0.5다", () => {
    expect(playbackRateFor(60, 60)).toBe(1);
    expect(playbackRateFor(72, 60)).toBeCloseTo(2, 12);
    expect(playbackRateFor(48, 60)).toBeCloseTo(0.5, 12);
  });

  it("반음은 2의 12제곱근이다", () => {
    expect(playbackRateFor(61, 60)).toBeCloseTo(2 ** (1 / 12), 12);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm test lib/audio/samples/manifest.test.ts`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 4: 매니페스트를 구현한다**

Create `lib/audio/samples/manifest.ts`:

```ts
import { z } from "zod";

import { INSTRUMENT_IDS, type InstrumentId } from "@/lib/score/model";

/**
 * 악기 하나의 샘플 목록. `public/samples/<instrument>/manifest.json`이 이
 * 모양이다. 건반마다 샘플을 두지 않고 몇 음 간격으로만 두고, 사이 음은
 * 재생 속도로 음높이를 보정한다.
 */
export type SampleZone = {
  /** manifest.json 기준 상대 경로. */
  file: string;
  /** 샘플이 녹음된 음(MIDI). 이 음에서는 재생 속도가 1이다. */
  centerPitch: number;
  loPitch: number;
  hiPitch: number;
};

export type SampleManifest = {
  instrument: InstrumentId;
  zones: SampleZone[];
};

const midi = z.number().int().min(0).max(127);

const zoneSchema = z
  .object({
    file: z.string().min(1),
    centerPitch: midi,
    loPitch: midi,
    hiPitch: midi,
  })
  .refine((z) => z.loPitch <= z.centerPitch && z.centerPitch <= z.hiPitch, {
    message: "loPitch <= centerPitch <= hiPitch 여야 합니다",
  });

const manifestSchema = z.object({
  instrument: z.enum(INSTRUMENT_IDS),
  zones: z.array(zoneSchema).min(1),
});

export function parseManifest(
  input: unknown,
  expected: InstrumentId,
): SampleManifest {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `${expected} 매니페스트가 올바르지 않습니다: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  if (parsed.data.instrument !== expected) {
    throw new Error(
      `매니페스트의 악기(${parsed.data.instrument})가 요청한 악기(${expected})와 다릅니다`,
    );
  }
  return parsed.data;
}

/**
 * pitch를 덮는 존을 고른다. 어느 존도 덮지 않으면 존의 범위까지 거리가
 * 가장 가까운 존을 돌려준다 — 범위 밖의 음이 조용히 무음이 되는 일이 없게
 * 한다. 거리가 같으면 목록에서 앞선 존이다.
 */
export function findZone(
  zones: readonly SampleZone[],
  pitch: number,
): SampleZone {
  let best = zones[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const zone of zones) {
    const distance =
      pitch < zone.loPitch
        ? zone.loPitch - pitch
        : pitch > zone.hiPitch
          ? pitch - zone.hiPitch
          : 0;
    if (distance < bestDistance) {
      best = zone;
      bestDistance = distance;
    }
  }
  return best;
}

export function playbackRateFor(pitch: number, centerPitch: number): number {
  return 2 ** ((pitch - centerPitch) / 12);
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm test lib/audio/samples/manifest.test.ts`
Expected: PASS.

- [ ] **Step 6: 뱅크의 실패하는 테스트를 쓴다**

Create `lib/audio/samples/bank.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { SampleBank } from "@/lib/audio/samples/bank";
import { FakeAudioContext, asAudioContext } from "@/lib/audio/testing/fake-audio";

const enc = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

const manifestFor = (instrument: string) =>
  JSON.stringify({
    instrument,
    zones: [
      { file: "c4.wav", centerPitch: 60, loPitch: 55, hiPitch: 64 },
      { file: "c5.wav", centerPitch: 72, loPitch: 65, hiPitch: 79 },
    ],
  });

/** 실제 네트워크 없이 url → 바이트를 돌려주는 fetch. failing에 든 url은 실패한다. */
function makeBank(failingUrls: string[] = []) {
  const calls: string[] = [];
  const failing = new Set(failingUrls);
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    calls.push(url);
    if (failing.has(url)) throw new Error(`404 ${url}`);
    const match = /^\/samples\/([a-z]+)\/(.+)$/.exec(url)!;
    return match[2] === "manifest.json"
      ? enc(manifestFor(match[1]))
      : enc(`bytes:${url}`);
  };
  return {
    bank: new SampleBank({ baseUrl: "/samples", fetchBytes }),
    calls,
    failing,
  };
}

/** 이미 끝난 약속들이 마저 정리되도록 한 번 양보한다. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("SampleBank — 컨텍스트 없는 fetch", () => {
  it("prefetch는 컨텍스트 없이 매니페스트와 모든 존 파일을 받는다", async () => {
    const { bank, calls } = makeBank();
    bank.prefetch(["piano"]);

    expect(bank.status("piano")).toBe("loading");
    await settle();

    expect(calls).toEqual([
      "/samples/piano/manifest.json",
      "/samples/piano/c4.wav",
      "/samples/piano/c5.wav",
    ]);
    // 컨텍스트가 없어 디코드는 못 했다 — 받았다는 사실만 알린다
    expect(bank.status("piano")).toBe("downloaded");
  });

  it("같은 악기를 두 번 prefetch해도 한 번만 받는다", async () => {
    const { bank, calls } = makeBank();
    bank.prefetch(["piano"]);
    bank.prefetch(["piano"]);
    await settle();
    expect(calls.filter((u) => u.endsWith("manifest.json"))).toHaveLength(1);
  });

  it("enabled: false면 prefetch는 아무것도 받지 않고 상태도 바꾸지 않는다 (서버 렌더링)", async () => {
    const calls: string[] = [];
    const bank = new SampleBank({
      baseUrl: "/samples",
      fetchBytes: async (url) => {
        calls.push(url);
        return enc("x");
      },
      enabled: false,
    });

    bank.prefetch(["piano", "drums"]);
    await settle();

    expect(calls).toEqual([]);
    expect(bank.status("piano")).toBe("idle");
  });

  it("enabled: false여도 ensureReady는 받는다 (클라이언트의 재생 시점)", async () => {
    const calls: string[] = [];
    const bank = new SampleBank({
      baseUrl: "/samples",
      fetchBytes: async (url) => {
        calls.push(url);
        const m = /^\/samples\/([a-z]+)\/(.+)$/.exec(url)!;
        return m[2] === "manifest.json" ? enc(manifestFor(m[1])) : enc("x");
      },
      enabled: false,
    });

    const result = await bank.ensureReady(
      asAudioContext(new FakeAudioContext()),
      ["piano"],
    );

    expect(result).toEqual({ ok: true });
    expect(calls.length).toBeGreaterThan(0);
  });

  it("받기 전에는 zoneFor가 null이다", async () => {
    const { bank } = makeBank();
    expect(bank.zoneFor("piano", 60)).toBeNull();
    bank.prefetch(["piano"]);
    await settle();
    expect(bank.zoneFor("piano", 60)).toBeNull(); // downloaded는 아직 소리를 못 낸다
  });
});

describe("SampleBank — decode와 준비", () => {
  it("ensureReady가 존 파일마다 한 번씩 디코드하고 ready가 된다", async () => {
    const { bank } = makeBank();
    const ctx = new FakeAudioContext();

    const result = await bank.ensureReady(asAudioContext(ctx), ["piano"]);

    expect(result).toEqual({ ok: true });
    expect(ctx.decoded).toHaveLength(2);
    expect(bank.status("piano")).toBe("ready");
  });

  it("prefetch 없이 ensureReady만 불러도 받고 디코드한다", async () => {
    const { bank, calls } = makeBank();
    const ctx = new FakeAudioContext();
    await bank.ensureReady(asAudioContext(ctx), ["drums"]);
    expect(calls[0]).toBe("/samples/drums/manifest.json");
    expect(bank.status("drums")).toBe("ready");
  });

  it("zoneFor가 존을 고르고 재생 속도를 계산한다", async () => {
    const { bank } = makeBank();
    await bank.ensureReady(asAudioContext(new FakeAudioContext()), ["piano"]);

    expect(bank.zoneFor("piano", 60)?.rate).toBe(1);
    expect(bank.zoneFor("piano", 72)?.rate).toBe(1);
    // 66은 c5 존(65~79) — 중심 72에서 6반음 아래
    expect(bank.zoneFor("piano", 66)?.rate).toBeCloseTo(2 ** (-6 / 12), 12);
    expect(bank.zoneFor("piano", 60)?.buffer).toBeDefined();
  });

  it("동시에 두 번 불러도 디코드는 한 번만 한다", async () => {
    const { bank } = makeBank();
    const ctx = new FakeAudioContext();
    const dec = asAudioContext(ctx);

    await Promise.all([
      bank.ensureReady(dec, ["piano"]),
      bank.ensureReady(dec, ["piano"]),
    ]);
    await bank.ensureReady(dec, ["piano"]); // 이미 ready

    expect(ctx.decoded).toHaveLength(2);
  });

  it("decodeAudioData에 넘기는 바이트는 사본이다(디코드가 원본을 분리하므로)", async () => {
    const { bank } = makeBank();
    const ctx = new FakeAudioContext();
    await bank.ensureReady(asAudioContext(ctx), ["piano"]);
    // 사본이라 같은 바이트가 다시 필요할 때(재시도) 원본이 살아 있다
    expect(ctx.decoded.every((d) => d.byteLength > 0)).toBe(true);
  });
});

describe("SampleBank — 실패와 재시도", () => {
  it("파일 하나가 실패하면 그 악기만 failed이고 error 상태다", async () => {
    const { bank } = makeBank(["/samples/piano/c5.wav"]);
    const ctx = asAudioContext(new FakeAudioContext());

    const result = await bank.ensureReady(ctx, ["piano", "drums"]);

    expect(result).toEqual({ ok: false, failed: ["piano"] });
    expect(bank.status("piano")).toBe("error");
    expect(bank.status("drums")).toBe("ready"); // 다른 악기는 영향받지 않는다
  });

  it("실패 뒤 다시 부르면 실제로 재시도된다", async () => {
    const { bank, failing } = makeBank(["/samples/piano/c5.wav"]);
    const ctx = asAudioContext(new FakeAudioContext());

    expect((await bank.ensureReady(ctx, ["piano"])).ok).toBe(false);
    failing.clear();

    expect(await bank.ensureReady(ctx, ["piano"])).toEqual({ ok: true });
    expect(bank.status("piano")).toBe("ready");
  });

  it("prefetch도 error 상태에서 다시 받는다", async () => {
    const { bank, failing, calls } = makeBank(["/samples/piano/manifest.json"]);
    bank.prefetch(["piano"]);
    await settle();
    expect(bank.status("piano")).toBe("error");

    failing.clear();
    bank.prefetch(["piano"]);
    await settle();

    expect(bank.status("piano")).toBe("downloaded");
    expect(calls.filter((u) => u.endsWith("manifest.json"))).toHaveLength(2);
  });

  it("디코드가 실패하면 failed이고, 고친 뒤 다시 부르면 된다", async () => {
    const { bank } = makeBank();
    const ctx = new FakeAudioContext();
    ctx.failDecode = true;

    expect(await bank.ensureReady(asAudioContext(ctx), ["piano"])).toEqual({
      ok: false,
      failed: ["piano"],
    });
    expect(bank.status("piano")).toBe("error");

    ctx.failDecode = false;
    expect(await bank.ensureReady(asAudioContext(ctx), ["piano"])).toEqual({
      ok: true,
    });
  });

  it("깨진 매니페스트는 error다", async () => {
    const bank = new SampleBank({
      baseUrl: "/samples",
      fetchBytes: async () => enc("not json"),
    });
    const result = await bank.ensureReady(
      asAudioContext(new FakeAudioContext()),
      ["piano"],
    );
    expect(result).toEqual({ ok: false, failed: ["piano"] });
  });
});

describe("SampleBank — 구독", () => {
  it("상태가 바뀌면 구독자를 부르고 스냅샷을 새로 만든다", async () => {
    const { bank } = makeBank();
    let calls = 0;
    const unsubscribe = bank.subscribe(() => {
      calls += 1;
    });
    const before = bank.getSnapshot();
    expect(before.piano).toBe("idle");

    await bank.ensureReady(asAudioContext(new FakeAudioContext()), ["piano"]);

    const after = bank.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.piano).toBe("ready");
    expect(calls).toBeGreaterThan(0);

    unsubscribe();
    const callsAtUnsubscribe = calls;
    bank.prefetch(["drums"]);
    expect(calls).toBe(callsAtUnsubscribe);
  });

  it("상태가 안 바뀌면 같은 스냅샷 참조를 돌려준다(useSyncExternalStore 계약)", () => {
    const { bank } = makeBank();
    expect(bank.getSnapshot()).toBe(bank.getSnapshot());
  });
});
```

- [ ] **Step 7: 실패를 확인한다**

Run: `pnpm test lib/audio/samples/bank.test.ts`
Expected: FAIL — `bank.ts`가 없다.

- [ ] **Step 8: 뱅크를 구현한다**

Create `lib/audio/samples/bank.ts`:

```ts
import { INSTRUMENT_IDS, type InstrumentId } from "@/lib/score/model";

import {
  findZone,
  parseManifest,
  playbackRateFor,
  type SampleManifest,
} from "./manifest";

/**
 * - `idle`: 아직 시작하지 않음
 * - `loading`: 파일을 받는 중
 * - `downloaded`: 다 받았지만 AudioContext가 없어 디코드는 아직 못 함
 * - `ready`: 디코드까지 끝나 소리를 낼 수 있음
 * - `error`: 받기 또는 디코드 실패. 다시 부르면 재시도한다
 */
export type SampleStatus =
  | "idle"
  | "loading"
  | "downloaded"
  | "ready"
  | "error";

export type SampleReadiness =
  | { ok: true }
  | { ok: false; failed: InstrumentId[] };

/** `AudioContext`가 이 모양을 만족한다. 테스트는 가짜를 넣는다. */
export type Decoder = {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
};

export type SampleHit = { buffer: AudioBuffer; rate: number };

/** 엔진과 샘플 악기가 뱅크에서 쓰는 부분. 테스트가 가짜를 끼운다. */
export interface SamplePort {
  /** AudioContext 없이 파일만 받는다. 사용자 제스처 밖(곡을 열 때)에 불러도 된다. */
  prefetch(instruments: readonly InstrumentId[]): void;
  /**
   * 디코드까지 끝내 소리를 낼 수 있게 한다. **AudioContext가 있어야 하므로
   * 컨텍스트를 만든 뒤에 부른다.** 실패한 악기는 `failed`에 담긴다.
   */
  ensureReady(
    ctx: Decoder,
    instruments: readonly InstrumentId[],
  ): Promise<SampleReadiness>;
  /** ready가 아니면 null. */
  zoneFor(instrument: InstrumentId, pitch: number): SampleHit | null;
}

type Entry = {
  status: SampleStatus;
  manifest: SampleManifest | null;
  fetched: Promise<Map<string, ArrayBuffer>> | null;
  decoding: Promise<void> | null;
  buffers: Map<string, AudioBuffer> | null;
};

const IDLE: Readonly<Record<InstrumentId, SampleStatus>> = Object.fromEntries(
  INSTRUMENT_IDS.map((id) => [id, "idle"]),
) as Record<InstrumentId, SampleStatus>;

export class SampleBank implements SamplePort {
  private readonly entries = new Map<InstrumentId, Entry>();
  private readonly listeners = new Set<() => void>();
  private snapshot = IDLE;

  constructor(
    private readonly opts: {
      baseUrl: string;
      fetchBytes: (url: string) => Promise<ArrayBuffer>;
      /**
       * false면 prefetch가 아무것도 받지 않는다. 서버 렌더링 중에는 상대 URL
       * fetch가 실패하고, 서버 HTML과 클라이언트 상태가 달라져 하이드레이션이
       * 어긋날 수 있다. ensureReady는 영향받지 않는다 — 클라이언트의 사용자
       * 제스처 뒤에서만 불린다.
       */
      enabled?: boolean;
    },
  ) {}

  status(instrument: InstrumentId): SampleStatus {
    return this.snapshot[instrument];
  }

  /** useSyncExternalStore용. 상태가 안 바뀌면 같은 참조를 돌려준다. */
  readonly getSnapshot = (): Readonly<Record<InstrumentId, SampleStatus>> =>
    this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  prefetch(instruments: readonly InstrumentId[]): void {
    if (this.opts.enabled === false) return;
    for (const instrument of instruments) {
      // 실패는 상태(error)로 드러난다. 여기서 던지면 처리되지 않은 거부가 된다.
      this.startFetch(instrument).catch(() => {});
    }
  }

  async ensureReady(
    ctx: Decoder,
    instruments: readonly InstrumentId[],
  ): Promise<SampleReadiness> {
    const unique = [...new Set(instruments)];
    const failed = new Set<InstrumentId>();
    await Promise.all(
      unique.map(async (instrument) => {
        try {
          await this.decode(ctx, instrument);
        } catch {
          failed.add(instrument);
        }
      }),
    );
    return failed.size === 0
      ? { ok: true }
      : { ok: false, failed: unique.filter((i) => failed.has(i)) };
  }

  zoneFor(instrument: InstrumentId, pitch: number): SampleHit | null {
    const entry = this.entries.get(instrument);
    if (!entry || entry.status !== "ready" || !entry.manifest || !entry.buffers) {
      return null;
    }
    const zone = findZone(entry.manifest.zones, pitch);
    const buffer = entry.buffers.get(zone.file);
    return buffer
      ? { buffer, rate: playbackRateFor(pitch, zone.centerPitch) }
      : null;
  }

  /** 옛 시도의 늦게 도착한 결과는 버린다 — 지금 항목이 아니면 아무것도 하지 않는다. */
  private publish(
    instrument: InstrumentId,
    entry: Entry,
    status: SampleStatus,
  ): void {
    if (this.entries.get(instrument) !== entry) return;
    entry.status = status;
    if (this.snapshot[instrument] === status) return;
    this.snapshot = { ...this.snapshot, [instrument]: status };
    for (const listener of this.listeners) listener();
  }

  private startFetch(
    instrument: InstrumentId,
  ): Promise<Map<string, ArrayBuffer>> {
    const current = this.entries.get(instrument);
    if (current && current.status !== "error" && current.fetched) {
      return current.fetched;
    }

    const entry: Entry = {
      status: "idle",
      manifest: null,
      fetched: null,
      decoding: null,
      buffers: null,
    };
    this.entries.set(instrument, entry);
    this.publish(instrument, entry, "loading");

    const dir = `${this.opts.baseUrl}/${instrument}`;
    entry.fetched = (async () => {
      const raw = await this.opts.fetchBytes(`${dir}/manifest.json`);
      const manifest = parseManifest(
        JSON.parse(new TextDecoder().decode(raw)),
        instrument,
      );
      entry.manifest = manifest;
      const files = [...new Set(manifest.zones.map((z) => z.file))];
      const bytes = await Promise.all(
        files.map((file) => this.opts.fetchBytes(`${dir}/${file}`)),
      );
      return new Map(files.map((file, i) => [file, bytes[i]]));
    })();

    entry.fetched.then(
      () => this.publish(instrument, entry, "downloaded"),
      () => this.publish(instrument, entry, "error"),
    );
    return entry.fetched;
  }

  private decode(ctx: Decoder, instrument: InstrumentId): Promise<void> {
    const existing = this.entries.get(instrument);
    if (existing?.status === "ready") return Promise.resolve();
    // 이미 디코드 중이면 같은 약속을 돌려준다 — 두 번 디코드하지 않는다.
    if (existing?.decoding) return existing.decoding;

    const fetched = this.startFetch(instrument);
    const entry = this.entries.get(instrument)!;
    entry.decoding = (async () => {
      try {
        const bytes = await fetched;
        const buffers = new Map<string, AudioBuffer>();
        for (const [file, data] of bytes) {
          // decodeAudioData는 넘긴 ArrayBuffer를 분리(detach)한다.
          // 사본을 넘겨야 원본이 남는다.
          buffers.set(file, await ctx.decodeAudioData(data.slice(0)));
        }
        entry.buffers = buffers;
        this.publish(instrument, entry, "ready");
      } catch (error) {
        this.publish(instrument, entry, "error");
        throw error;
      } finally {
        entry.decoding = null;
      }
    })();
    return entry.decoding;
  }
}

export async function browserFetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer();
}

/**
 * 브라우저용 기본 뱅크. 만들 때 아무것도 받지 않는다 — fetch는 prefetch가 시작한다.
 * 서버 렌더링 중(`window`가 없을 때)에는 prefetch도 하지 않는다.
 */
export function defaultSampleBank(): SampleBank {
  return new SampleBank({
    baseUrl: "/samples",
    fetchBytes: browserFetchBytes,
    enabled: typeof window !== "undefined",
  });
}
```

- [ ] **Step 9: 통과를 확인한다**

Run: `pnpm test lib/audio/samples`
Expected: PASS (manifest + bank 전부).

실패 시 먼저 볼 곳: "decodeAudioData에 넘기는 바이트" 테스트는 `byteLength > 0`만 본다. `settle()`로 기다리는 테스트가 불안정하면 `fetchBytes`가 마이크로태스크만 쓰는지 확인한다(타이머를 쓰면 안 된다).

- [ ] **Step 10: 전체 검사 후 커밋한다**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 통과.

```bash
git add lib/audio/samples lib/audio/testing/fake-audio.ts
git commit -m "feat(audio): 샘플 뱅크를 추가한다 (fetch와 decode를 분리)"
```

---

### Task 12: 샘플 악기와 엔진의 재생 전 준비 보장

신스 악기 4종을 지우고 샘플 악기로 바꾼다. 엔진은 샘플이 준비되지 않으면 소리를 시작하지 않고 명시적인 결과를 돌려준다.

**Files:**
- Create: `lib/audio/instruments/sampler.ts`, `lib/audio/instruments/sampler.test.ts`
- Create: `lib/audio/testing/fake-bank.ts`
- Modify: `lib/audio/instruments/index.ts`, `lib/audio/engine.ts`, `lib/audio/engine.test.ts`
- Delete: `lib/audio/instruments/{piano,guitar,bass,drums}.ts`, `lib/audio/instruments/instruments.test.ts`

**Interfaces:**
- Consumes: `SamplePort`/`SampleHit`(Task 11), `instrumentsOf`(Task 7), `VoicePool`.
- Produces:
  - `createSampler(instrument: InstrumentId, ctx: AudioContext, pool: VoicePool, bank: SamplePort): Instrument`
  - `createInstrument(id: InstrumentId, ctx: AudioContext, pool: VoicePool, bank: SamplePort): Instrument`
  - `type PlayResult = { status: "playing" } | { status: "already-playing" } | { status: "superseded" } | { status: "not-ready"; failed: InstrumentId[] }`
  - `Engine.play(): Promise<PlayResult>`
  - `new Engine(song: Song, contextProvider?: AudioContextProvider, bank?: SamplePort)` — 생성자와 `setSong`이 `bank.prefetch(instrumentsOf(song))`를 부른다(AudioContext 없이).
  - `FakeSampleBank implements SamplePort` (`lib/audio/testing/fake-bank.ts`): `prefetched: InstrumentId[][]`, `readyCalls: InstrumentId[][]`, `failing: Set<InstrumentId>`, `gate: Promise<void> | null`.

- [ ] **Step 1: 가짜 뱅크를 만든다**

Create `lib/audio/testing/fake-bank.ts`:

```ts
import type { InstrumentId } from "@/lib/score/model";

import type {
  Decoder,
  SampleHit,
  SamplePort,
  SampleReadiness,
} from "../samples/bank";

/**
 * 엔진 테스트용 뱅크. 네트워크도 디코드도 없이 "준비됨/실패/아직"만 조절한다.
 *
 * - `failing`에 든 악기는 ensureReady가 실패로 돌려준다.
 * - `gate`를 세우면 ensureReady가 그 약속이 풀릴 때까지 기다린다. 샘플을
 *   기다리는 창 안에서 stop()이 끼어드는 레이스를 손으로 재현하는 데 쓴다.
 */
export class FakeSampleBank implements SamplePort {
  readonly prefetched: InstrumentId[][] = [];
  readonly readyCalls: InstrumentId[][] = [];
  readonly failing = new Set<InstrumentId>();
  gate: Promise<void> | null = null;

  prefetch(instruments: readonly InstrumentId[]): void {
    this.prefetched.push([...instruments]);
  }

  async ensureReady(
    _ctx: Decoder,
    instruments: readonly InstrumentId[],
  ): Promise<SampleReadiness> {
    this.readyCalls.push([...instruments]);
    if (this.gate) await this.gate;
    const failed = instruments.filter((i) => this.failing.has(i));
    return failed.length === 0 ? { ok: true } : { ok: false, failed };
  }

  zoneFor(): SampleHit {
    // 샘플 길이는 0.5초로 고정한다. 드럼 한 번 치기의 여운 계산에 쓰인다.
    return { buffer: { duration: 0.5 } as unknown as AudioBuffer, rate: 1 };
  }
}
```

- [ ] **Step 2: 샘플 악기의 실패하는 테스트를 쓴다**

Create `lib/audio/instruments/sampler.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createSampler } from "@/lib/audio/instruments/sampler";
import type { SamplePort } from "@/lib/audio/samples/bank";
import { FakeSampleBank } from "@/lib/audio/testing/fake-bank";
import {
  FakeAudioContext,
  FakeAudioNode,
  FakeScheduledSource,
  asAudioContext,
  asAudioNode,
} from "@/lib/audio/testing/fake-audio";
import { VoicePool } from "@/lib/audio/voices";

function setup(bank: SamplePort = new FakeSampleBank()) {
  const ctx = new FakeAudioContext();
  const out = new FakeAudioNode("out");
  const pool = new VoicePool(asAudioContext(ctx), asAudioNode(out));
  return { ctx, pool, bank };
}

function bufferSources(ctx: FakeAudioContext) {
  return ctx.created.filter((n) => n.kind === "bufferSource") as (FakeScheduledSource & {
    playbackRate: { calls: { method: string; value: number | null; time: number }[] };
  })[];
}

describe("createSampler — 음이 있는 악기", () => {
  it("음마다 새 버퍼 소스를 만들어 정해진 시각에 시작한다", () => {
    const { ctx, pool, bank } = setup();
    const piano = createSampler("piano", asAudioContext(ctx), pool, bank);

    piano.play(60, 1.0, 0.5, 0.8);
    piano.play(64, 1.5, 0.5, 0.8);

    const sources = bufferSources(ctx);
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.startedAt)).toEqual([1.0, 1.5]);
  });

  it("뱅크가 준 재생 속도를 소스에 건다", () => {
    const { ctx, pool } = setup();
    const bank: SamplePort = {
      prefetch() {},
      ensureReady: async () => ({ ok: true }),
      zoneFor: () => ({ buffer: { duration: 2 } as unknown as AudioBuffer, rate: 1.5 }),
    };
    createSampler("guitar", asAudioContext(ctx), pool, bank).play(60, 1, 0.5, 0.8);

    const [source] = bufferSources(ctx);
    expect(source.playbackRate.calls).toContainEqual({
      method: "setValueAtTime",
      value: 1.5,
      time: 1,
    });
  });

  it("음 길이 뒤에 짧게 줄여 끝낸다 — 뚝 자르면 클릭이 난다", () => {
    const { ctx, pool, bank } = setup();
    createSampler("bass", asAudioContext(ctx), pool, bank).play(40, 1.0, 0.5, 0.8);

    const [source] = bufferSources(ctx);
    // 1.0 + 0.5(dur) + 릴리즈(0.08) 이후에 멈춘다
    expect(source.stoppedAt!).toBeGreaterThan(1.58);
    const gain = ctx.created.find((n) => n.kind === "gain") as unknown as {
      gain: { calls: { method: string; value: number | null; time: number }[] };
    };
    const ramp = gain.gain.calls.find((c) => c.method === "linearRampToValueAtTime");
    expect(ramp?.value).toBe(0);
    expect(ramp?.time).toBeCloseTo(1.58, 6);
  });

  it("velocity가 클수록 소리가 크다", () => {
    const { ctx, pool, bank } = setup();
    const piano = createSampler("piano", asAudioContext(ctx), pool, bank);
    piano.play(60, 1, 0.5, 0.2);
    piano.play(60, 2, 0.5, 0.9);

    const gains = ctx.created.filter((n) => n.kind === "gain") as unknown as {
      gain: { calls: { method: string; value: number | null }[] };
    }[];
    const level = (i: number) =>
      gains[i].gain.calls.find((c) => c.method === "setValueAtTime")!.value!;
    expect(level(1)).toBeGreaterThan(level(0));
  });

  it("소리가 끝나면 소스를 끊는다 (노드 누수 방지)", () => {
    const { ctx, pool, bank } = setup();
    createSampler("piano", asAudioContext(ctx), pool, bank).play(60, 1, 0.5, 0.8);
    const [source] = bufferSources(ctx);
    expect(source.isDisconnected).toBe(false);

    ctx.advanceTo(source.stoppedAt! + 0.001);

    expect(source.isDisconnected).toBe(true);
  });

  it("준비되지 않은 음(zoneFor가 null)은 노드를 만들지 않는다", () => {
    const { ctx, pool } = setup();
    const bank: SamplePort = {
      prefetch() {},
      ensureReady: async () => ({ ok: true }),
      zoneFor: () => null,
    };
    createSampler("piano", asAudioContext(ctx), pool, bank).play(60, 1, 0.5, 0.8);
    expect(ctx.created).toHaveLength(0);
  });
});

describe("createSampler — 드럼", () => {
  it("드럼은 음 길이와 무관하게 샘플 길이만큼 울리는 원샷이다", () => {
    const { ctx, pool, bank } = setup(); // 가짜 샘플 길이 0.5초
    createSampler("drums", asAudioContext(ctx), pool, bank).play(38, 1.0, 0.05, 0.8);

    const [source] = bufferSources(ctx);
    expect(source.stoppedAt!).toBeGreaterThanOrEqual(1.5);
    expect(source.stoppedAt!).toBeLessThan(1.6);
  });

  it("드럼은 음 길이 뒤에 릴리즈 램프를 만들지 않는다", () => {
    const { ctx, pool, bank } = setup();
    createSampler("drums", asAudioContext(ctx), pool, bank).play(38, 1.0, 0.05, 0.8);
    const gain = ctx.created.find((n) => n.kind === "gain") as unknown as {
      gain: { calls: { method: string }[] };
    };
    expect(gain.gain.calls.some((c) => c.method === "linearRampToValueAtTime")).toBe(
      false,
    );
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm test lib/audio/instruments/sampler.test.ts`
Expected: FAIL — `sampler.ts`가 없다.

- [ ] **Step 4: 샘플 악기를 구현한다**

Create `lib/audio/instruments/sampler.ts`:

```ts
"use client";

import type { InstrumentId } from "@/lib/score/model";

import type { SamplePort } from "../samples/bank";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";

/** 음 길이가 끝난 뒤 소리를 줄여 끝내는 시간. 뚝 자르면 클릭 노이즈가 난다. */
const RELEASE = 0.08;
/** 소스 정지를 엔벨로프 끝보다 살짝 늦춰 램프가 잘리지 않게 한다. */
const STOP_MARGIN = 0.02;
const SAMPLE_GAIN = 0.8;

/**
 * 샘플 재생 악기. 피아노·기타·베이스·드럼이 모두 이것이다 — 악기마다 다른
 * 것은 뱅크가 가진 샘플뿐이다.
 *
 * - 음이 있는 악기: 가장 가까운 샘플을 `playbackRate`로 음높이 보정해 틀고,
 *   음 길이가 끝나면 RELEASE 동안 줄인다.
 * - 드럼: 샘플이 스스로 끝날 때까지 울리는 원샷이다. 음 길이(격자 칸)가
 *   짧아도 샘플을 자르지 않는다.
 *
 * `AudioBufferSourceNode`는 일회용이다. 음마다 새로 만들고 `onended`에서
 * 끊는다. 준비되지 않은 음은 조용히 건너뛴다 — 엔진이 재생 전에 모든
 * 악기의 준비를 보장하므로 정상 경로에서는 일어나지 않는다.
 */
export function createSampler(
  instrument: InstrumentId,
  ctx: AudioContext,
  pool: VoicePool,
  bank: SamplePort,
): Instrument {
  const oneShot = instrument === "drums";

  return {
    play(pitch, when, dur, vel) {
      const hit = bank.zoneFor(instrument, pitch);
      if (!hit) return;

      const level = vel * SAMPLE_GAIN;
      const endsAt = oneShot ? when + hit.buffer.duration : when + dur + RELEASE;
      const gain = pool.acquire(when, endsAt);
      gain.gain.setValueAtTime(level, when);
      if (!oneShot) {
        gain.gain.setValueAtTime(level, when + dur);
        gain.gain.linearRampToValueAtTime(0, when + dur + RELEASE);
      }

      const source = ctx.createBufferSource();
      source.buffer = hit.buffer;
      source.playbackRate.setValueAtTime(hit.rate, when);
      source.connect(gain);
      source.start(when);
      source.stop(endsAt + STOP_MARGIN);
      source.onended = () => source.disconnect();
    },
  };
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm test lib/audio/instruments/sampler.test.ts`
Expected: PASS.

- [ ] **Step 6: 악기 팩토리를 바꾸고 신스를 지운다**

Replace the whole of `lib/audio/instruments/index.ts`:

```ts
"use client";

import type { InstrumentId } from "@/lib/score/model";

import type { SamplePort } from "../samples/bank";
import type { Instrument } from "../types";
import type { VoicePool } from "../voices";
import { createSampler } from "./sampler";

export function createInstrument(
  id: InstrumentId,
  ctx: AudioContext,
  pool: VoicePool,
  bank: SamplePort,
): Instrument {
  return createSampler(id, ctx, pool, bank);
}
```

```bash
git rm lib/audio/instruments/piano.ts lib/audio/instruments/guitar.ts \
  lib/audio/instruments/bass.ts lib/audio/instruments/drums.ts \
  lib/audio/instruments/instruments.test.ts
```

(`metronome.ts`는 그대로 둔다 — 샘플이 아니라 엔진이 직접 예약하는 짧은 클릭이다.)

- [ ] **Step 7: 엔진 테스트를 샘플 뱅크 기준으로 옮기고 새 동작을 추가한다**

In `lib/audio/engine.test.ts`:

(1) 모든 `new Engine(`를 `makeEngine(`로 바꾼다(파일 안 전부):
```bash
sed -i 's/new Engine(/makeEngine(/g' lib/audio/engine.test.ts
```

(2) import에 추가한다(기존 `import { Engine, type AudioContextProvider } from "@/lib/audio/engine";`는 그대로 두고 그 아래에):
```ts
import { FakeSampleBank } from "@/lib/audio/testing/fake-bank";
import type { SamplePort } from "@/lib/audio/samples/bank";
```

(3) `immediateProvider` 함수 바로 아래에 헬퍼를 추가한다(이 함수 안의 `new Engine(`는 sed가 이미 지나간 뒤 직접 쓰는 것이므로 그대로 둔다):
```ts
/** 가짜 뱅크를 기본으로 끼운 엔진. 샘플 로딩을 신경 쓰지 않는 테스트용. */
function makeEngine(
  song: Song,
  provider: AudioContextProvider,
  bank: SamplePort = new FakeSampleBank(),
): Engine {
  return new Engine(song, provider, bank);
}
```

(4) setSong 테스트의 오실레이터 계수를 버퍼 소스로 바꾼다. `n.kind === "oscillator"`를 `n.kind === "bufferSource"`로 두 곳 모두 바꾸고, 같은 테스트의 주석 `// tick 0의 음이 예약되며 오실레이터 3개(부분음)가 생긴다`를 `// tick 0의 음이 예약되며 버퍼 소스가 생긴다`로 고친다.

(5) 자동 정지의 "여운" 테스트가 샘플 길이를 기준으로 하도록 곡을 바꾼다. `songWithLongTail`을 교체한다:

```ts
/**
 * 마지막 박에 짧은 드럼 한 번만 있는 1마디 곡.
 *
 * 드럼은 음 길이와 무관하게 샘플 길이(가짜 뱅크에서 0.5초)만큼 울린다.
 * 음이 짧을수록 곡 끝을 넘어 남는 여운이 길어져서, auto-stop이 그 여운을
 * 기다리는지 확인하기 좋다. 곡 끝이 2.05초이고 여운은 2.425초까지 간다.
 */
function songWithLongTail(): Song {
  return songWithNotes({
    instrument: "drums",
    notes: [{ start: 1800, length: 120, velocity: 0.7, pitch: 38 }],
  });
}
```
그리고 "곡 끝을 지나도 마지막 음의 여운이 남아 있으면 자르지 않는다" 테스트의 마지막 단언과 그 위 주석을 교체한다. old:
```ts
    // 곡 끝(2.05초)을 지나서 멈춰야 한다. 마지막 타일은 1800틱(1.875초)에
    // 시작해 엔벨로프 하한 0.3초를 타므로 2.2초 언저리까지 울린다.
    expect(stoppedAt!).toBeGreaterThan(2.15);
```
new:
```ts
    // 곡 끝(2.05초)을 지나서도 멈추지 않아야 한다. 마지막 음은 1800틱
    // (시작 지연 0.05 + 1.875초)에 시작해 샘플 길이 0.5초만큼 울리므로
    // 2.425초까지 여운이 남는다.
    expect(stoppedAt!).toBeGreaterThan(2.4);
```

(6) 파일 맨 아래에 새 describe를 추가한다:

```ts
describe("Engine 샘플 준비 보장", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("정상이면 playing 결과를 돌려준다", async () => {
    const engine = makeEngine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
    );
    expect(await engine.play()).toEqual({ status: "playing" });
    engine.stop();
  });

  it("곡이 쓰는 악기가 준비되지 않으면 소리를 시작하지 않고 not-ready를 돌려준다", async () => {
    const bank = new FakeSampleBank();
    bank.failing.add("piano");
    const engine = makeEngine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
      bank,
    );

    const result = await engine.play();

    expect(result).toEqual({ status: "not-ready", failed: ["piano"] });
    expect(engine.isPlaying()).toBe(false);
    // 타이머도 걸리지 않았다
    expect(vi.getTimerCount()).toBe(0);
  });

  it("not-ready 뒤 다시 누르면 실제로 재시도된다", async () => {
    const bank = new FakeSampleBank();
    bank.failing.add("piano");
    const engine = makeEngine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
      bank,
    );
    expect((await engine.play()).status).toBe("not-ready");

    bank.failing.clear();
    expect(await engine.play()).toEqual({ status: "playing" });
    engine.stop();
  });

  it("샘플을 기다리는 동안 stop하면 시작하지 않는다 — ensureRunning 뒤의 두 번째 레이스 창", async () => {
    // play()에는 await가 두 개다. 첫 번째(ensureRunning) 뒤에는 세션을 확인하지만
    // 두 번째(샘플 준비) 뒤에도 확인하지 않으면, 그 사이 stop()이 눌려도
    // 타이머가 걸려 정지한 곡이 되살아난다.
    const bank = new FakeSampleBank();
    let release!: () => void;
    bank.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = makeEngine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
      bank,
    );

    const started = engine.play();
    await vi.waitFor(() => expect(bank.readyCalls).toHaveLength(1));

    engine.stop();
    release();

    expect(await started).toEqual({ status: "superseded" });
    expect(engine.isPlaying()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("이미 재생 중이면 already-playing이다", async () => {
    const engine = makeEngine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
    );
    const first = engine.play();
    expect(await engine.play()).toEqual({ status: "already-playing" });
    await first;
    engine.stop();
  });

  it("재생 전에 곡이 쓰는 악기만 요청한다", async () => {
    const bank = new FakeSampleBank();
    const engine = makeEngine(
      songWithNotes({ instrument: "drums", notes: [] }),
      immediateProvider(new FakeAudioContext()),
      bank,
    );
    await engine.play();
    expect(bank.readyCalls).toEqual([["drums"]]);
    engine.stop();
  });

  it("생성자와 setSong이 AudioContext 없이 곡의 악기를 prefetch한다", () => {
    const bank = new FakeSampleBank();
    const engine = makeEngine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
      bank,
    );
    expect(bank.prefetched).toEqual([["piano"]]);

    engine.setSong(songWithNotes({ instrument: "drums", notes: [] }));
    expect(bank.prefetched.at(-1)).toEqual(["drums"]);
  });

  it("재생 중 거부된 setSong은 prefetch도 하지 않는다", async () => {
    const bank = new FakeSampleBank();
    const engine = makeEngine(
      songWithTrack("t", 60),
      immediateProvider(new FakeAudioContext()),
      bank,
    );
    await engine.play();
    const before = bank.prefetched.length;

    engine.setSong(songWithNotes({ instrument: "drums", notes: [] }));

    expect(bank.prefetched).toHaveLength(before);
    engine.stop();
  });
});
```

(7) 남은 `kind === "oscillator"`가 없는지 확인한다: `grep -n "oscillator" lib/audio/engine.test.ts` → 출력 없음.

- [ ] **Step 8: 실패를 확인한다**

Run: `pnpm test lib/audio/engine.test.ts`
Expected: FAIL — 엔진이 세 번째 인자·`PlayResult`·prefetch를 아직 모른다.

- [ ] **Step 9: `lib/audio/engine.ts`를 고친다**

(1) import를 바꾼다. old:
```ts
import { expandSong, type TrackEvents } from "@/lib/score/expand";
import type { Song } from "@/lib/score/model";
```
new:
```ts
import { expandSong, instrumentsOf, type TrackEvents } from "@/lib/score/expand";
import type { InstrumentId, Song } from "@/lib/score/model";
```
그리고 `import { createMetronome, type Metronome } from "./metronome";` 아래에 추가한다:
```ts
import { defaultSampleBank, type SamplePort } from "./samples/bank";
```

(2) `AudioContextProvider`와 `browserContextProvider` 정의 아래, `export class Engine {` 바로 위에 결과 타입을 추가한다:

```ts
/**
 * `play()`의 결과. "눌렀는데 아무 일도 안 일어남"을 값으로 구분한다.
 *
 * - `playing`: 소리를 시작했다
 * - `already-playing`: 이미 재생 중이라 아무것도 하지 않았다
 * - `superseded`: 기다리는 동안 stop()이나 더 나중의 play()가 주도권을 가져갔다
 * - `not-ready`: 곡이 쓰는 악기 중 샘플이 준비되지 않은 것이 있어 시작하지 않았다
 */
export type PlayResult =
  | { status: "playing" }
  | { status: "already-playing" }
  | { status: "superseded" }
  | { status: "not-ready"; failed: InstrumentId[] };
```

(3) 필드와 생성자를 고친다. 필드 선언 `private readonly contextProvider: AudioContextProvider;` 바로 아래에 추가:
```ts
  private readonly bank: SamplePort;
```
생성자를 교체한다. old:
```ts
  constructor(
    song: Song,
    contextProvider: AudioContextProvider = browserContextProvider,
  ) {
    this.song = song;
    this.events = expandSong(song);
    this.bpm = song.tempo;
    this.contextProvider = contextProvider;
  }
```
new:
```ts
  constructor(
    song: Song,
    contextProvider: AudioContextProvider = browserContextProvider,
    bank: SamplePort = defaultSampleBank(),
  ) {
    this.song = song;
    this.events = expandSong(song);
    this.bpm = song.tempo;
    this.contextProvider = contextProvider;
    this.bank = bank;
    // AudioContext 없이 파일만 받는다. 곡을 여는 시점은 사용자 제스처 밖일 수
    // 있으므로 디코드는 play()에서 컨텍스트가 생긴 뒤에 한다.
    this.bank.prefetch(instrumentsOf(song));
  }
```

(4) `play()` 메서드 전체(`/** 반드시 사용자 제스처 핸들러 안에서 await할 것. */`부터 메서드의 닫는 `}`까지)를 교체한다:

```ts
  /**
   * 반드시 사용자 제스처 핸들러 안에서 await할 것.
   *
   * 결과를 값으로 돌려준다(`PlayResult`). 샘플이 준비되지 않으면 소리를 시작하지
   * 않는다 — 준비 안 된 악기가 조용히 무음이 되는 경로를 만들지 않는다.
   */
  async play(): Promise<PlayResult> {
    if (this.playing) return { status: "already-playing" };

    // 콜드 스타트에서 ensureRunning()은 수십 ms 걸리는 진짜 await이다.
    // 그 창 안에서 play/stop이 어떤 순서로 겹쳐도 살아남을 세션 번호를
    // await 앞에서 동기적으로 발급한다. 불리언 하나로는 부족하다 —
    // play -> stop -> play 순서면 playing이 다시 true라서 먼저 시작한
    // 호출도 통과해 setInterval을 하나 더 걸고, stop()은 마지막 timerId만
    // 지우므로 먼저 걸린 타이머가 고아가 되어 dispose()로도 못 없앤다.
    this.playing = true;
    const session = ++this.session;

    try {
      const ctx = this.contextProvider.get();

      // 사용자 제스처 안의 **첫** await. 샘플 대기는 반드시 이 뒤에 온다 —
      // 순서가 바뀌면 느린 네트워크에서 제스처 창이 지나 resume이 거부된다.
      await this.contextProvider.ensureRunning();
      if (!this.isCurrent(session)) return { status: "superseded" };

      // **두 번째** await. 이 창에서도 stop()이나 더 나중의 play()가 끼어들 수
      // 있으므로 세션을 다시 확인한다. 첫 번째 확인만으로는 막지 못한다.
      const readiness = await this.bank.ensureReady(
        ctx,
        instrumentsOf(this.song),
      );
      if (!this.isCurrent(session)) return { status: "superseded" };
      if (!readiness.ok) {
        // 이 세션이 아직 내 것이므로 playing을 되돌려야 다음 play()가 재시도된다.
        this.playing = false;
        return { status: "not-ready", failed: readiness.failed };
      }

      this.ctx = ctx;
      this.buildGraph(ctx);

      const sink: NoteSink = {
        schedule: (trackId, pitch, when, dur, vel) => {
          this.instruments.get(trackId)?.play(pitch, when, dur, vel);
        },
      };

      const startTime = ctx.currentTime + START_DELAY;
      this.scheduler = new Scheduler(this.events, this.bpm, ctx, sink);
      this.scheduler.start(startTime);
      this.nextClickTick = 0;

      // window.setInterval이 아니라 전역으로 부른다 — 브라우저에서는 같은
      // 함수이고, 테스트가 도는 node 환경에는 window가 없다.
      this.timerId = setInterval(() => this.onTimer(), TIMER_MS);
      this.onTimer();
      return { status: "playing" };
    } catch (err) {
      // resume()이 거부되거나(자동재생 정책) getAudioContext()가 미지원
      // 브라우저에서 던지면, 타이머도 그래프도 없이 playing만 true로 남는다.
      // 그대로 두면 다음 play() 호출이 최상단 가드(if (this.playing) return;)에
      // 걸려 조용히 아무 일도 안 하므로, 재시도가 실제로 다시 시도되도록
      // 여기서 되돌린다. 그사이 stop()이 이미 session을 바꿔놨다면(=이미
      // playing=false) 손대지 않는다 — 이 실패가 그 세션 소유는 아니다.
      if (this.session === session) {
        this.playing = false;
      }
      throw err;
    }
  }

  /** 내가 시작한 세션이 아직 최신인가. 아니면 그 사이 stop()이나 더 나중의 play()가 있었다. */
  private isCurrent(session: number): boolean {
    return this.playing && this.session === session;
  }
```

(5) `setSong`에서 prefetch를 부르고 악기 생성에 뱅크를 넘긴다. 본문을 교체한다. old:
```ts
    if (this.ctx && this.pool && !sameTrackComposition(this.song, song)) {
      this.instruments.clear();
      for (const track of song.tracks) {
        this.instruments.set(
          track.id,
          createInstrument(track.instrument, this.ctx, this.pool),
        );
      }
    }

    this.song = song;
    this.events = expandSong(song);
    this.bpm = song.tempo;
    return true;
```
new:
```ts
    if (this.ctx && this.pool && !sameTrackComposition(this.song, song)) {
      this.instruments.clear();
      for (const track of song.tracks) {
        this.instruments.set(
          track.id,
          createInstrument(track.instrument, this.ctx, this.pool, this.bank),
        );
      }
    }

    this.song = song;
    this.events = expandSong(song);
    this.bpm = song.tempo;
    // 새 곡이 쓰는 악기를 컨텍스트 없이 미리 받는다.
    this.bank.prefetch(instrumentsOf(song));
    return true;
```

(6) `buildGraph`의 악기 생성을 고친다. old:
```ts
      this.instruments.set(
        track.id,
        createInstrument(track.instrument, ctx, pool),
      );
```
new:
```ts
      this.instruments.set(
        track.id,
        createInstrument(track.instrument, ctx, pool, this.bank),
      );
```

- [ ] **Step 10: 전체 검사를 통과시킨다**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 전부 통과. 기존 시작 레이스 5건, 자동 정지 2건이 그대로 통과해야 한다.

`midiToFreq`를 더 이상 쓰는 곳이 없어 lint가 미사용 export를 잡지는 않지만, 확인한다: `grep -rn "midiToFreq" lib` → `lib/audio/env.ts`의 정의만 나오면 Task 14에서 지운다.

- [ ] **Step 11: 커밋한다**

```bash
git add -A
git commit -m "feat(audio): 샘플 악기로 바꾸고 재생 전 준비를 보장한다"
```

---

### Task 13: 소리 검증 화면과 개발용 톤 팩

사람이 귀로 확인할 최소 화면이다. 편집 UI가 아니다. 실제 샘플 팩(Task 15)이 오기 전에 파이프라인(받기 → 디코드 → 음높이 보정 → 스케줄)을 브라우저에서 끝까지 돌려 보도록, **직접 생성한** 개발용 톤을 만든다(라이선스 문제가 없고 저장소에 커밋하지 않는다).

**Files:**
- Create: `components/verify/VerifyScreen.tsx`, `components/verify/VerifyScreen.test.tsx`
- Create: `scripts/gen-dev-samples.mjs`
- Modify: `app/page.tsx`, `package.json` (scripts), `.gitignore`
- Delete: `components/dom-env.test.tsx`

**Interfaces:**
- Consumes: `Engine`/`PlayResult`(Task 12), `SampleBank`(Task 11), `buildDemoSong`(Task 9).
- Produces: `VerifyScreen({ createDeps? })`, `type VerifyDeps = { engine: VerifyEngine; bank: VerifyBank }`.

- [ ] **Step 1: Next.js 문서를 먼저 읽는다 (`AGENTS.md` 규칙)**

Read: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` 와 `public-folder.md`.
확인할 것: (a) `page.tsx`는 서버 컴포넌트로 두고 `"use client"` 컴포넌트를 import해도 되는가, (b) `public/` 아래 파일이 `/samples/...` URL로 서빙되는가. 문서가 이와 다르면 아래 코드를 문서에 맞게 고치고 그 사실을 기록한다.

- [ ] **Step 2: 화면의 실패하는 테스트를 쓴다**

Create `components/verify/VerifyScreen.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VerifyScreen,
  type VerifyDeps,
} from "@/components/verify/VerifyScreen";
import type { PlayResult } from "@/lib/audio/engine";
import type { SampleStatus } from "@/lib/audio/samples/bank";
import type { InstrumentId } from "@/lib/score/model";

type Statuses = Record<InstrumentId, SampleStatus>;

function makeDeps(
  playResult: PlayResult,
  override: Partial<Statuses> = {},
): VerifyDeps {
  const snapshot: Statuses = {
    piano: "ready",
    guitar: "ready",
    bass: "ready",
    drums: "ready",
    ...override,
  };
  return {
    engine: {
      play: vi.fn(async () => playResult),
      stop: vi.fn(),
      setSong: vi.fn(() => true),
      setTempo: vi.fn(),
      setMetronome: vi.fn(),
      currentTick: vi.fn(() => 0),
      dispose: vi.fn(),
      onStop: null,
    },
    bank: {
      prefetch: vi.fn(),
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    },
  };
}

type WindowWithAudio = { AudioContext?: unknown };

beforeEach(() => {
  // jsdom에는 Web Audio가 없다. 지원하는 브라우저인 척한다.
  (window as unknown as WindowWithAudio).AudioContext = class {};
});

afterEach(() => {
  cleanup();
  delete (window as unknown as WindowWithAudio).AudioContext;
});

describe("VerifyScreen", () => {
  it("악기별 샘플 상태를 보여 준다", () => {
    const deps = makeDeps({ status: "playing" }, { drums: "loading", bass: "downloaded" });
    render(<VerifyScreen createDeps={() => deps} />);

    expect(screen.getByText("드럼").parentElement?.textContent).toContain("불러오는 중");
    expect(screen.getByText("베이스").parentElement?.textContent).toContain("받음");
    expect(screen.getByText("피아노").parentElement?.textContent).toContain("준비됨");
  });

  it("재생을 누르면 엔진을 부르고 정지 버튼으로 바뀐다", async () => {
    const deps = makeDeps({ status: "playing" });
    render(<VerifyScreen createDeps={() => deps} />);

    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(deps.engine.play).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "정지" })).toBeTruthy();
  });

  it("샘플이 준비되지 않아 시작하지 못하면 이유를 보여 주고 정지 상태로 남는다", async () => {
    const deps = makeDeps({ status: "not-ready", failed: ["piano"] }, { piano: "error" });
    render(<VerifyScreen createDeps={() => deps} />);

    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(await screen.findByText(/재생하지 않았습니다/)).toBeTruthy();
    expect(screen.getByText(/피아노/, { selector: "[role='alert']" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "재생" })).toBeTruthy();
  });

  it("실패한 악기에는 다시 시도 버튼이 있고 누르면 다시 받는다", () => {
    const deps = makeDeps({ status: "playing" }, { piano: "error" });
    render(<VerifyScreen createDeps={() => deps} />);

    fireEvent.click(screen.getByRole("button", { name: "피아노 다시 시도" }));

    expect(deps.bank.prefetch).toHaveBeenCalledWith(["piano"]);
  });

  it("준비된 악기에는 다시 시도 버튼이 없다", () => {
    render(<VerifyScreen createDeps={() => makeDeps({ status: "playing" })} />);
    expect(screen.queryByRole("button", { name: /다시 시도/ })).toBeNull();
  });

  it("템포를 바꾸면 곡의 템포와 엔진 템포를 함께 바꾼다", () => {
    const deps = makeDeps({ status: "playing" });
    render(<VerifyScreen createDeps={() => deps} />);

    fireEvent.change(screen.getByLabelText(/템포/), { target: { value: "90" } });

    expect(deps.engine.setTempo).toHaveBeenCalledWith(90);
    expect(deps.engine.setSong).toHaveBeenLastCalledWith(
      expect.objectContaining({ tempo: 90 }),
    );
  });

  it("메트로놈 토글을 엔진에 전달한다", () => {
    const deps = makeDeps({ status: "playing" });
    render(<VerifyScreen createDeps={() => deps} />);

    fireEvent.click(screen.getByLabelText("메트로놈"));

    expect(deps.engine.setMetronome).toHaveBeenCalledWith(true);
  });

  it("언마운트하면 엔진을 정리한다", () => {
    const deps = makeDeps({ status: "playing" });
    const { unmount } = render(<VerifyScreen createDeps={() => deps} />);
    unmount();
    expect(deps.engine.dispose).toHaveBeenCalled();
  });

  it("Web Audio를 지원하지 않으면 이유를 보여 주고 재생을 막는다", () => {
    delete (window as unknown as WindowWithAudio).AudioContext;
    render(<VerifyScreen createDeps={() => makeDeps({ status: "playing" })} />);

    expect(screen.getByText(/Web Audio를 지원하지 않습니다/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "재생" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm test components/verify`
Expected: FAIL — `VerifyScreen`이 없다.

- [ ] **Step 4: 화면을 구현한다**

Create `components/verify/VerifyScreen.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { isAudioSupported } from "@/lib/audio/context";
import { Engine, type PlayResult } from "@/lib/audio/engine";
import {
  defaultSampleBank,
  type SamplePort,
  type SampleStatus,
} from "@/lib/audio/samples/bank";
import { buildDemoSong } from "@/lib/score/demo-song";
import {
  INSTRUMENT_IDS,
  MAX_TEMPO,
  MIN_TEMPO,
  type InstrumentId,
  type Song,
} from "@/lib/score/model";
import { ticksToBarBeat } from "@/lib/score/time";

/** 화면이 엔진에서 쓰는 부분. 테스트가 가짜를 끼운다. */
export type VerifyEngine = {
  play(): Promise<PlayResult>;
  stop(): void;
  setSong(song: Song): boolean;
  setTempo(bpm: number): void;
  setMetronome(on: boolean): void;
  currentTick(): number;
  dispose(): void;
  onStop: (() => void) | null;
};

export type VerifyBank = Pick<SamplePort, "prefetch"> & {
  getSnapshot(): Readonly<Record<InstrumentId, SampleStatus>>;
  subscribe(listener: () => void): () => void;
};

export type VerifyDeps = { engine: VerifyEngine; bank: VerifyBank };

function createRealDeps(): VerifyDeps {
  const bank = defaultSampleBank();
  // 두 번째 인자를 undefined로 두면 브라우저용 AudioContext 제공자가 쓰인다.
  return { engine: new Engine(buildDemoSong(), undefined, bank), bank };
}

const POSITION_SAMPLE_MS = 100;

const INSTRUMENT_LABEL: Record<InstrumentId, string> = {
  piano: "피아노",
  guitar: "기타",
  bass: "베이스",
  drums: "드럼",
};

const STATUS_LABEL: Record<SampleStatus, string> = {
  idle: "대기",
  loading: "불러오는 중",
  downloaded: "받음 (재생 때 마무리)",
  ready: "준비됨",
  error: "실패",
};

// isAudioSupported()는 window를 읽으므로 SSR 스냅샷과 다르다.
// SSR에서는 true를, 마운트 후에는 실제 값을 돌려준다.
function subscribeNever() {
  return () => {};
}
const serverSupported = () => true;

/**
 * 소리를 귀로 확인하기 위한 최소 화면. 편집 UI가 아니다.
 *
 * 매 프레임 바뀌는 재생 위치는 엔진 안에만 있다. 여기서는 10Hz로 샘플링한
 * 마디·박만 상태로 둔다.
 */
export function VerifyScreen({
  createDeps = createRealDeps,
}: {
  createDeps?: () => VerifyDeps;
}) {
  const [{ engine, bank }] = useState(createDeps);
  const [song] = useState(buildDemoSong);

  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(song.tempo);
  const [metronome, setMetronome] = useState(false);
  const [position, setPosition] = useState({ bar: 1, beat: 1 });
  const [message, setMessage] = useState<string | null>(null);

  // 정지 때 엔진에 다시 맞출 템포. 핸들러에서만 쓰고 렌더 중에는 읽지 않는다.
  const tempoRef = useRef(tempo);

  const statuses = useSyncExternalStore(
    bank.subscribe,
    bank.getSnapshot,
    bank.getSnapshot,
  );
  const supported = useSyncExternalStore(
    subscribeNever,
    isAudioSupported,
    serverSupported,
  );

  useEffect(() => {
    // 곡 끝 도달로 인한 자동 정지도 사용자가 정지를 누른 것과 같은 결과여야 한다.
    engine.onStop = () => {
      engine.setSong({ ...song, tempo: tempoRef.current });
      setPlaying(false);
      setPosition({ bar: 1, beat: 1 });
    };
    return () => {
      engine.onStop = null;
      engine.dispose();
    };
  }, [engine, song]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const next = ticksToBarBeat(engine.currentTick(), song.timeSignature);
      // 같으면 이전 객체를 유지해 불필요한 리렌더를 막는다.
      setPosition((prev) =>
        prev.bar === next.bar && prev.beat === next.beat ? prev : next,
      );
    }, POSITION_SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [playing, engine, song.timeSignature]);

  async function handlePlay() {
    setMessage(null);
    try {
      const result = await engine.play();
      if (result.status === "playing") {
        setPlaying(true);
      } else if (result.status === "not-ready") {
        const names = result.failed.map((i) => INSTRUMENT_LABEL[i]).join(", ");
        setMessage(
          `샘플을 불러오지 못한 악기가 있어 재생하지 않았습니다: ${names}`,
        );
      }
    } catch {
      setMessage("소리를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.");
    }
  }

  function handleStop() {
    engine.stop();
    // 재생 중 바뀐 템포를 곡에도 반영한다 — song.tempo가 유일한 진실이다.
    engine.setSong({ ...song, tempo: tempoRef.current });
    setPlaying(false);
    setPosition({ bar: 1, beat: 1 });
  }

  function handleTempo(value: number) {
    tempoRef.current = value;
    setTempo(value);
    // 재생 중에는 setTempo만 먹고, 정지 중에는 setSong이 곡과 템포를 함께 맞춘다.
    // 둘 다 부르면 지금 재생 상태를 화면이 추측하지 않아도 된다.
    engine.setTempo(value);
    engine.setSong({ ...song, tempo: value });
  }

  return (
    <main className="mx-auto max-w-xl space-y-6 p-8 text-zinc-100">
      <header>
        <h1 className="text-lg font-semibold">Bandline — 소리 검증</h1>
        <p className="mt-1 text-sm text-zinc-400">
          데모 곡을 재생해 소리를 확인하는 화면입니다. 편집은 아직 없습니다.
        </p>
      </header>

      {!supported && (
        <p role="alert" className="text-sm text-amber-400">
          이 브라우저는 Web Audio를 지원하지 않습니다.
        </p>
      )}

      <section className="flex items-center gap-4">
        {playing ? (
          <button
            type="button"
            onClick={handleStop}
            className="rounded bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900"
          >
            정지
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePlay}
            disabled={!supported}
            className="rounded bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-40"
          >
            재생
          </button>
        )}
        <span className="text-sm tabular-nums text-zinc-300">
          {position.bar}마디 · {position.beat}박
        </span>
      </section>

      {message && (
        <p role="alert" className="text-sm text-amber-400">
          {message}
        </p>
      )}

      <section className="space-y-3">
        <label className="flex items-center gap-3 text-sm">
          <span className="w-12">템포</span>
          <input
            type="range"
            min={MIN_TEMPO}
            max={MAX_TEMPO}
            value={tempo}
            onChange={(e) => handleTempo(Number(e.target.value))}
            aria-label="템포"
            className="flex-1"
          />
          <span className="w-16 tabular-nums">{tempo} BPM</span>
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={metronome}
            onChange={(e) => {
              setMetronome(e.target.checked);
              engine.setMetronome(e.target.checked);
            }}
            aria-label="메트로놈"
          />
          메트로놈
        </label>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">샘플 상태</h2>
        <ul className="space-y-1 text-sm">
          {INSTRUMENT_IDS.map((id) => (
            <li key={id} className="flex items-center gap-3">
              <span className="w-16">{INSTRUMENT_LABEL[id]}</span>
              <span className="text-zinc-400">{STATUS_LABEL[statuses[id]]}</span>
              {statuses[id] === "error" && (
                <button
                  type="button"
                  aria-label={`${INSTRUMENT_LABEL[id]} 다시 시도`}
                  onClick={() => bank.prefetch([id])}
                  className="rounded border border-zinc-600 px-2 py-0.5 text-xs"
                >
                  다시 시도
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: 홈을 검증 화면으로 연결하고 스모크 테스트를 지운다**

Replace the whole of `app/page.tsx`:

```tsx
import { VerifyScreen } from "@/components/verify/VerifyScreen";

export default function Home() {
  return <VerifyScreen />;
}
```

```bash
git rm components/dom-env.test.tsx
```
(이제 `components/verify/VerifyScreen.test.tsx`가 jsdom 환경을 대신 증명한다.)

- [ ] **Step 6: 화면 테스트 통과를 확인한다**

Run: `pnpm test components/verify`
Expected: PASS (9 tests).

실패 시 먼저 볼 곳:
- `getByText("드럼").parentElement` 단언이 깨지면 마크업 구조(`<li>` 안의 `<span>` 순서)와 테스트를 맞춘다.
- `lint`가 `react-hooks/refs`를 낸다면 `tempoRef.current`를 렌더 중에 읽은 곳이 있는지 본다 — 이 파일에서는 핸들러와 effect 콜백 안에서만 읽는다.
- `lint`가 effect 안의 `engine.onStop = …` 대입을 `react-hooks/immutability`로 막으면, 대입을 컴포넌트 밖의 작은 함수 `bindAutoStop(engine, handler)`로 옮겨 그 함수가 대입하게 한다. 동작은 같다.

- [ ] **Step 7: 개발용 톤 생성 스크립트를 만든다**

Create `scripts/gen-dev-samples.mjs`:

```js
// 개발용 임시 톤 팩을 만든다. 직접 생성한 사인파·노이즈이며 저작권 문제가 없다.
// 소리 파이프라인(받기 → 디코드 → 음높이 보정 → 스케줄)을 브라우저에서 끝까지
// 돌려 보기 위한 것이지, 음색 품질을 위한 것이 아니다.
// 실제 샘플 팩은 계획의 Task 15에서 넣고, 그때 이 스크립트의 출력은 지운다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "public", "samples");
const RATE = 22050;

/** 16비트 모노 WAV. */
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => {
    data.writeInt16LE((Math.max(-1, Math.min(1, s)) * 32767) | 0, i * 2);
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const freq = (pitch) => 440 * 2 ** ((pitch - 69) / 12);

/** 배음 목록(비율, 진폭)과 감쇠로 음 하나를 만든다. */
function tone(pitch, seconds, partials, decay) {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.005) * Math.exp(-t * decay);
    let s = 0;
    for (const [ratio, amp] of partials) {
      s += amp * Math.sin(2 * Math.PI * freq(pitch) * ratio * t);
    }
    out[i] = 0.4 * env * s;
  }
  return out;
}

// 결정적인 노이즈(같은 입력이면 같은 파일이 나온다)
function makeNoise() {
  let seed = 12345;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
}

function kick() {
  const n = Math.floor(RATE * 0.35);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = 45 + 95 * Math.exp(-t * 30);
    phase += (2 * Math.PI * f) / RATE;
    out[i] = 0.9 * Math.exp(-t * 9) * Math.sin(phase);
  }
  return out;
}

function noiseHit(seconds, decay, highpass) {
  const rand = makeNoise();
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const x = rand();
    // 단순 1차 고역 통과
    const y = highpass ? x - prev * 0.9 : x;
    prev = x;
    out[i] = 0.5 * Math.exp(-t * decay) * y;
  }
  return out;
}

function write(instrument, zones, build) {
  const dir = path.join(ROOT, instrument);
  mkdirSync(dir, { recursive: true });
  const manifest = { instrument, zones: [] };
  for (const z of zones) {
    const file = `${z.name}.wav`;
    writeFileSync(path.join(dir, file), wav(build(z)));
    manifest.zones.push({
      file,
      centerPitch: z.center,
      loPitch: z.lo,
      hiPitch: z.hi,
    });
  }
  writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

/** center 목록에서 이웃 사이를 반으로 나눠 존 범위를 만든다. */
function pitchedZones(centers) {
  return centers.map((center, i) => ({
    name: `p${center}`,
    center,
    lo: i === 0 ? 0 : Math.ceil((centers[i - 1] + center) / 2),
    hi: i === centers.length - 1 ? 127 : Math.ceil((center + centers[i + 1]) / 2) - 1,
  }));
}

const steps = (from, to, step) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

write("piano", pitchedZones(steps(36, 96, 6)), (z) =>
  tone(z.center, 1.2, [[1, 1], [2, 0.35], [3, 0.12]], 3.5),
);
write("guitar", pitchedZones(steps(36, 84, 6)), (z) =>
  tone(z.center, 1.0, [[1, 1], [2, 0.6], [3, 0.4], [4, 0.25]], 4.5),
);
write("bass", pitchedZones(steps(24, 60, 6)), (z) =>
  tone(z.center, 0.9, [[1, 1], [2, 0.2]], 3.0),
);
write(
  "drums",
  [
    { name: "kick", center: 36, lo: 36, hi: 36 },
    { name: "snare", center: 38, lo: 38, hi: 38 },
    { name: "hihat", center: 42, lo: 42, hi: 42 },
  ],
  (z) =>
    z.name === "kick"
      ? kick()
      : z.name === "snare"
        ? noiseHit(0.25, 14, false)
        : noiseHit(0.08, 60, true),
);

console.log(`개발용 톤 팩을 ${ROOT}에 만들었습니다.`);
```

- [ ] **Step 8: 스크립트를 연결하고 생성물은 커밋하지 않게 한다**

In `package.json` `"scripts"`에 한 줄을 추가한다(`"test": "vitest run"` 다음):
```json
    "gen:dev-samples": "node scripts/gen-dev-samples.mjs"
```
(앞 줄 끝에 쉼표를 붙인다.)

Append to `.gitignore`:
```text

# 개발용 임시 톤 팩(scripts/gen-dev-samples.mjs). 실제 샘플 팩을 넣을 때(계획 Task 15) 이 줄을 지운다.
/public/samples/
```

- [ ] **Step 9: 톤을 만들고 서빙되는지 확인한다**

Run: `pnpm gen:dev-samples`
Expected: `public/samples/{piano,guitar,bass,drums}/`에 `manifest.json`과 `.wav`가 생긴다.

Run: `du -sh public/samples` — Expected: 약 2MB 이하.

Run: `pnpm dev` (백그라운드), 그리고
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/samples/piano/manifest.json
curl -s http://localhost:3000/ | grep -o "소리 검증"
```
Expected: `200`, 그리고 `소리 검증`이 출력된다. 확인 후 dev 서버를 끈다.

- [ ] **Step 10: 전체 검사 후 커밋한다**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: 통과. (빌드가 폰트 다운로드 때문에 실패하면 원인을 기록하고 넘어간다.)

```bash
git add -A
git status --short   # public/samples가 목록에 없어야 한다
git commit -m "feat(app): 소리 검증 화면과 개발용 톤 생성 스크립트를 추가한다"
```

- [ ] **Step 11: 사람이 귀로 확인한다 (에이전트는 할 수 없다)**

이 단계는 에이전트가 **듣지 못하므로** 결과를 보고서에 "미확인 — 사용자 청취 필요"로 적는다. 사용자는 `pnpm gen:dev-samples && pnpm dev` 후 `http://localhost:3000`에서 확인한다.

- [ ] 재생을 누르면 4개 악기 상태가 `준비됨`이 되고 소리가 난다.
- [ ] 재생 중 마디·박이 올라간다. 곡이 끝나면(8마디, 약 16초) 마지막 소리가 뚝 잘리지 않고 자동 정지한다.
- [ ] 재생 중 템포 슬라이더를 움직여도 소리가 끊기지 않고, 위치가 거꾸로 튀지 않는다.
- [ ] 메트로놈을 켜고 **30초 이상**(곡을 두세 번 반복 재생) 들어도 박자가 밀리지 않는다.
- [ ] 개발자 도구에서 `public/samples/piano/c5.wav` 같은 파일을 막으면(Network → Block) 재생이 `not-ready` 문구로 막히고 `다시 시도`가 나온다.

---

### Task 14: 정리와 문서

**Files:**
- Delete: `lib/score/types.ts`
- Modify: `lib/score/time.test.ts`, `lib/audio/env.ts`
- Modify: `AGENTS.md`, `README.md`, `docs/known-gaps.md`, `.claude/rules/frontend-architecture.md`
- Modify: `docs/superpowers/specs/2026-11-20-core-model-sample-engine-design.md`

- [ ] **Step 1: 옛 `types.ts`를 쓰는 곳이 없는지 확인한다**

Run: `grep -rn "score/types\|from \"\./types\"" lib app components --include=*.ts --include=*.tsx`
Expected: `lib/score/time.test.ts`의 `@/lib/score/types` 한 줄만 나온다(`./types`를 쓰는 `lib/audio/types.ts` import는 `lib/audio` 안이므로 제외하고 읽는다). 다른 곳이 나오면 그 import를 `@/lib/score/model`로 옮긴다.

- [ ] **Step 2: 지운다**

In `lib/score/time.test.ts`: `import { PPQ } from "@/lib/score/types";`를 `import { PPQ } from "@/lib/score/model";`로 바꾼다.

```bash
git rm lib/score/types.ts
```

미사용이 된 `midiToFreq`를 확인한다:
Run: `grep -rn "midiToFreq" lib app components`
Expected: `lib/audio/env.ts`의 정의만 나오면, 그 함수(와 바로 위 `/** A4(69) = 440Hz 기준 평균율. */` 주석)를 `lib/audio/env.ts`에서 지운다.

- [ ] **Step 3: 검사를 통과시킨다**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: 통과.

- [ ] **Step 4: `AGENTS.md`의 현재 상태를 사실로 맞춘다**

In `AGENTS.md`, "## 현재 상태" 섹션의 본문(그 제목 아래부터 "설계 근거는 …" 줄 직전까지)을 아래로 교체한다. "## 절대 규칙"과 "## 검증"은 건드리지 않는다.

```markdown
음악 비전공자의 아이디어 스케치 도구로 **재구상 중**이다. 곡은 "코드·패턴 클립"과 "음 클립"으로 만들고, 브라우저에서 샘플 음원으로 재생한다. 재구상은 하위 프로젝트로 나뉘어 있고 설계는 `docs/superpowers/specs/2026-11-20-core-model-sample-engine-design.md`에 있다.

**지금 있는 것:** `lib/score/`(곡 모델 v2 — `Song`/`Track`/`Clip`/`Note`, 코드 음정·패턴 카탈로그, 펼치기 `expandSong`, 베이크, 불변식 검증, zod 스키마, 데모 곡, 실행취소 규칙), `lib/audio/`(AudioContext·look-ahead 스케줄러·`SampleBank`·샘플 악기·엔진), `components/verify/`(소리를 귀로 확인하는 최소 화면). 편집 UI는 **없다.**

**곡 모델의 규칙**
- 음은 클립 시작 기준 **상대 틱**이다. 곡 길이는 `bars × ticksPerBar`로 파생한다(`lengthTicks` 필드는 없다).
- **같은 트랙의 클립은 겹치지 않는다.** 화음(같은 시각의 여러 음)은 `notes` 클립 안에서 항상 된다.
- **패턴 id는 불변이다.** 고치려면 새 id를 만든다 — 이미 공유된 링크의 소리가 달라진다. `lib/score/patterns.test.ts`의 스냅샷이 지킨다.
- 재생과 내보내기는 같은 `expandSong`을 쓴다.

**템포는 `song.tempo`가 유일한 진실이다.** `Engine.setSong`이 곡·이벤트·템포·악기 맵을 한 번에 맞추므로 호출부가 `setTempo`를 따로 부를 필요가 없다. 재생 중에는 `setSong`이 거부되고(`false`) 템포만 `setTempo`로 바꿀 수 있다.

**샘플은 컨텍스트 없이 받고, 컨텍스트가 생긴 뒤에 디코드한다.** `Engine.play()`는 `PlayResult`를 돌려주고, 곡이 쓰는 악기가 준비되지 않으면 소리를 시작하지 않는다(`not-ready`). `play()`에는 await가 둘이고 둘 다 세션 번호를 다시 확인한다.

아직 없는 것: **편집 UI(하위 프로젝트 2), 링크 공유·서명 검증·모바일 재생 뷰(3), 오디오 내보내기(4), 악보 PDF 가져오기(5)**, 다시실행, 루프, 시크, 줌. 실제 샘플 팩은 `public/samples/`에 아직 없다 — 개발용 톤은 `pnpm gen:dev-samples`로 만들고 커밋하지 않는다(계획 Task 15).
```

그리고 "설계 근거는 `docs/superpowers/specs/`에 있다." 줄은 그대로 둔다.

- [ ] **Step 5: `README.md`를 사실로 맞춘다**

Run: `grep -n "" README.md | head -40`로 현재 내용을 읽는다. 이 저장소가 무엇인지, 실행 방법, 현재 상태를 말하는 단락을 아래 내용으로 바꾼다(실행 방법 단락이 있으면 유지하고 `pnpm gen:dev-samples` 한 줄만 추가한다):

````markdown
# Bandline

음악 비전공자가 브라우저에서 곡 아이디어를 스케치하는 도구. 코드·패턴 블록으로 뼈대를 만들고, 필요하면 음 단위로 고친다.

**현재 상태:** 재구상 중이다. 곡 데이터 모델과 샘플 기반 오디오 엔진, 그리고 소리를 확인하는 최소 화면(`/`)만 있다. 편집 UI·링크 공유·오디오 내보내기는 아직 없다. 자세한 범위는 `AGENTS.md`와 `docs/superpowers/specs/`를 본다.

개발용 톤으로 소리를 들어 보려면:

```bash
pnpm install
pnpm gen:dev-samples   # public/samples에 개발용 톤을 만든다 (커밋되지 않음)
pnpm dev
```
````

- [ ] **Step 6: `docs/known-gaps.md`를 다시 쓴다**

Replace the whole of `docs/known-gaps.md`:

```markdown
# 알려진 공백

지금 이 저장소에서 **검증되지 않는 것**과 **미뤄진 작업**을 모아 둔다. 새 세션을 시작하는 사람(또는 에이전트)이 "무엇을 믿어도 되고 무엇을 직접 확인해야 하는지" 알기 위한 문서다.

기능 목록(무엇이 아직 없는지)은 `AGENTS.md`에 있다. 여기는 **품질과 검증**에 대한 것이다.

최종 갱신: 2026-11-20 (코어 모델·샘플 엔진 재구상 직후)

## 1. 정적 검사는 소리를 증명하지 않는다

`pnpm lint` · `check-types` · `test` · `build`가 전부 통과해도 **소리가 나는지는 아무것도 말해주지 않는다.** 재생·타이밍·악기를 건드렸으면 `pnpm dev`로 직접 들어야 한다.

`pnpm build`만은 예외적으로 의미가 있다 — 모듈 스코프에서 `AudioContext`를 만들면 서버 렌더링 중에 평가되어 여기서 깨진다.

## 2. 아직 귀로 확인하지 못한 것

| 항목 | 상태 | 확인 방법 |
| --- | --- | --- |
| 개발용 톤 팩으로 파이프라인 전체 | 미확인 | `pnpm gen:dev-samples && pnpm dev`로 `/`에서 재생. 계획 Task 13의 청취 체크리스트 |
| **장시간 재생 드리프트** | 미확인 | 메트로놈을 켜고 30초 이상 완주시켜 박자가 밀리는지 듣는다 |
| 악기 4종 동시 구간의 끊김 | 미확인 | 데모 곡 전체를 들어 본다 |
| **Safari(데스크톱·모바일)에서 샘플 디코드** | 미확인 | 실제 샘플 파일 형식을 정한 뒤 Safari에서 `/`의 상태가 `준비됨`이 되는지. Chrome은 근거가 되지 않는다 |

## 3. 실제 샘플 팩이 없다

`public/samples/`에는 커밋된 샘플이 없다. 지금 소리는 `scripts/gen-dev-samples.mjs`가 만든 개발용 톤뿐이다(음색 품질을 위한 것이 아니다). CC0·퍼블릭 도메인 팩을 골라 `public/samples/LICENSES.md`에 출처와 라이선스를 적고, 첫 재생 총량 5MB 이내를 `budget.test.ts`로 지키는 작업이 남아 있다(계획 Task 15). 라이선스가 확인되지 않은 파일은 저장소에 넣지 않는다.

## 4. `state/`·`components/`의 자동 테스트는 이제 막 시작이다

`vitest.config.mts`가 `lib/**`는 `node`, `state/**`·`components/**`는 `jsdom`으로 돈다. 지금 컴포넌트 테스트는 `components/verify/` 하나뿐이다. 편집 UI(하위 프로젝트 2)가 들어오면 옛 설계에서 결함이 전부 이 계층에서 나왔다는 점을 기억한다 — **규칙이 든 로직은 훅·컴포넌트에 두지 않고 `lib/`의 순수 함수로 뺀다.**

## 5. CI 초록이 Windows 동작을 보장하지 않는다

저장소는 LF로 커밋하지만 Windows 체크아웃에서는 `core.autocrlf`가 CRLF로 바꾼다. CI는 `ubuntu-latest`라 LF로 받는다.

**파일 내용을 정규식으로 파싱하는 테스트는 `\r?\n`을 써야 한다.** `\n`만 쓰면 CI는 통과하고 Windows 로컬만 깨진다. 새로 만든 파일은 작성 직후에는 LF라 그 세션에서는 통과하고, `git checkout`으로 브랜치를 옮기는 순간 변환되어 깨진다.

## 6. 패턴은 4/4 기준이다

`lib/score/patterns.ts`의 패턴은 틱 단위이고 4/4 한 마디(1920틱)를 기준으로 만들었다. `timeSignature`는 스키마가 다른 박자도 받지만, 그런 곡에서는 패턴이 자기 길이로 반복되어 마디선과 어긋난다. 편집 UI가 4/4만 제공하는 동안은 문제가 되지 않는다. 다른 박자를 지원하려면 패턴 길이를 박 단위로 다시 정의해야 한다(새 패턴 id로).

## 7. 문서가 코드를 따라오지 못한 전례

- `README.md`가 "스캐폴드 단계"라고 말하는 동안 실제로는 편집·재생·저장이 다 되고 있었다
- `AGENTS.md`의 "아직 없는 것" 목록에 방금 만든 기능이 남아 있었다
- 설계 문서의 `file:line` 인용이 리팩터링 후 어긋났다

기능을 하나 끝내면 `AGENTS.md`와 `README.md`가 여전히 사실인지 확인한다. 특히 `AGENTS.md`는 에이전트가 매 세션 자동으로 읽으므로, 틀린 내용이 그대로 다음 작업의 전제가 된다.

곡 파일 형식 문서(`docs/song-file-format.md`)는 v1 모델과 함께 삭제했다. v2의 파일·링크 형식은 공유 하위 프로젝트(3)의 spec에서 새로 쓴다.
```

- [ ] **Step 7: 디렉터리 구조 규칙을 실제와 맞춘다**

In `.claude/rules/frontend-architecture.md`, "## 디렉터리 구조" 섹션 안의 첫 문단("아래 구조는 실제로 존재한다. …")과 코드 블록을 아래로 교체한다. 코드 블록 바로 뒤의 "`src/`, feature/entity 레이어, FSD는 두지 않는다." 이하는 그대로 둔다.

````markdown
아래 구조 중 "(아직 없음)"이 아닌 것은 실제로 존재한다. 옛 타임라인·상태 계층(`components/timeline/`, `components/transport/`, `state/StudioProvider`)은 재구상에서 철거했고 편집 UI 하위 프로젝트에서 새로 만든다.

```text
app/                    Next.js App Router 엔트리포인트
lib/score/              곡 데이터 모델 v2 — Song/Track/Clip/Note, 코드·패턴, 펼치기, 검증, 스키마, 실행취소 규칙. 순수 TS. Web Audio도 React도 import하지 않는다
lib/audio/              오디오 엔진 — AudioContext, look-ahead 스케줄러, 샘플 뱅크, 샘플 악기. 순수 TS. React를 import하지 않는다
components/verify/      소리 검증 화면 (편집 UI가 아니다)
components/editor/      (아직 없음) 클립 조립·음 편집 UI — 하위 프로젝트 2
components/ui/          (아직 없음) 버튼, 슬라이더, 패널 등 공용 컨트롤
state/                  (아직 없음) 편집 UI가 생길 때의 React 상태 (Context)
public/samples/         악기 샘플 — 실제 팩은 계획 Task 15에서 들어온다. 지금은 개발용 톤(gitignore)
```
````

- [ ] **Step 8: spec에 구현 중 바뀐 점을 반영한다**

In `docs/superpowers/specs/2026-11-20-core-model-sample-engine-design.md`, 4.3절 `SampleBank`의 코드 블록과 그 아래 문장을 아래 내용에 맞게 고친다:

- `status(instrument) → "idle" | "loading" | "ready" | "error"`를 `"idle" | "loading" | "downloaded" | "ready" | "error"`로 바꾸고, 블록 바로 아래에 한 줄을 추가한다: `downloaded`는 받았지만 AudioContext가 없어 디코드를 못 한 상태다. 화면이 "불러오는 중"으로 거짓말하지 않게 한다.
- 4.2절에서 "`setSong`을 거부한다"를 "`setSong`은 `false`를 돌려주고 아무것도 바꾸지 않는다"로 구체화한다.
- 4.3절 "재생 전 보장" 문단 끝에 추가한다: `play()`는 `PlayResult`(`playing`/`already-playing`/`superseded`/`not-ready`)를 돌려주고, await가 둘(ensureRunning, 샘플 준비)이며 둘 다 세션을 다시 확인한다. 샘플 받기(fetch)는 컨텍스트 없이 `setSong`/생성자에서 시작하고, 디코드는 컨텍스트가 생긴 `play()`에서 한다.
- 3.3절 패턴 문단 끝에 추가한다: 패턴은 4/4 한 마디(1920틱) 기준이다(`docs/known-gaps.md` 6번).

- [ ] **Step 9: 전체 검사 후 커밋한다**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: 통과.

```bash
git add -A
git commit -m "docs: 재구상 결과를 AGENTS·README·known-gaps·구조 규칙에 반영한다"
```

---

### Task 15: 실제 샘플 팩 조달 — 사용자가 필요하다

**이 Task는 에이전트가 혼자 끝낼 수 없다.** 라이선스 확인, 음색을 귀로 고르기, Safari에서 디코드 확인은 사람이 해야 한다. 에이전트는 팩 이름·URL·라이선스를 기억에서 지어내지 않는다 — 사용자가 고른 팩의 원본 페이지에서 직접 확인한 사실만 기록한다.

**Files:**
- Create: `public/samples/<instrument>/manifest.json`과 샘플 파일(악기 4종)
- Create: `public/samples/LICENSES.md`
- Create: `lib/audio/samples/budget.test.ts`
- Modify: `.gitignore` (개발용 톤 줄 삭제)

- [ ] **Step 1: 후보 팩을 사용자와 함께 고른다**

사용자와 함께 피아노·어쿠스틱 기타·베이스·드럼 각각의 후보를 찾는다(웹 검색). 후보마다 **원본 페이지에서 직접** 다음을 확인해 기록한다: 라이선스 이름(CC0 또는 퍼블릭 도메인만 통과), 라이선스 표기 페이지 URL, 파일 형식·크기. CC-BY 등 출처 표기가 필요한 팩은 이번 범위에서 쓰지 않는다. 확인이 안 되면 그 팩은 쓰지 않는다.

- [ ] **Step 2: 짧게 들어 보고 고른다 (사용자)**

후보 중 "곡 같은 소리"가 나는 것을 사용자가 귀로 고른다.

- [ ] **Step 3: 파일 형식을 정한다 (사용자의 Safari 필요)**

Chrome·Firefox·Safari(데스크톱과 iOS)가 **모두** 디코드하는 형식 하나를 정한다. 후보 형식 두어 개로 같은 샘플을 만들어 `public/samples/piano/`에 넣고, Safari에서 `/`를 열어 피아노 상태가 `준비됨`이 되는지 확인한다. 안 되는 형식은 버린다. 결과를 `docs/known-gaps.md` 2절의 Safari 행에 "확인함(날짜, 기기, 형식)"으로 고친다.

- [ ] **Step 4: 샘플을 넣고 매니페스트를 만든다**

악기마다 `public/samples/<instrument>/`에 샘플과 `manifest.json`을 둔다. 존 간격은 몇 음(예: 3~6반음)이며 `loPitch <= centerPitch <= hiPitch`다. 스키마는 `lib/audio/samples/manifest.ts`가 정의한다. 첫 재생에 필요한 총량이 5MB를 넘으면 존 간격을 넓히거나 샘플 길이를 줄인다.

- [ ] **Step 5: 출처 파일을 쓴다**

Create `public/samples/LICENSES.md` — 팩마다 아래 항목을 **확인한 사실만** 적는다:

```markdown
# 샘플 출처와 라이선스

## <instrument>

- 팩 이름: <원본 페이지의 이름>
- 출처 URL: <원본 페이지>
- 라이선스: <CC0 또는 퍼블릭 도메인>
- 라이선스 확인 URL: <라이선스 문구가 있는 페이지>
- 내려받은 날짜: <YYYY-MM-DD>
- 가공: <변환한 형식, 자른 구간 등>
```

- [ ] **Step 6: 예산·정합성 테스트를 쓴다**

Create `lib/audio/samples/budget.test.ts`:

```ts
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseManifest } from "@/lib/audio/samples/manifest";
import { INSTRUMENT_IDS } from "@/lib/score/model";

const ROOT = fileURLToPath(new URL("../../../public/samples", import.meta.url));

/** 첫 재생에 필요한 샘플 총량 상한(모바일 링크 열기를 염두에 둔 값). */
const TOTAL_BUDGET_BYTES = 5 * 1024 * 1024;
/** 악기 하나의 상한. 한 악기가 예산을 독점하지 않게 한다. */
const PER_INSTRUMENT_BUDGET_BYTES = 1.5 * 1024 * 1024;

function loadManifest(instrument: (typeof INSTRUMENT_IDS)[number]) {
  const file = path.join(ROOT, instrument, "manifest.json");
  return {
    dir: path.join(ROOT, instrument),
    manifest: parseManifest(JSON.parse(readFileSync(file, "utf8")), instrument),
  };
}

function bytesOf(instrument: (typeof INSTRUMENT_IDS)[number]): number {
  const { dir, manifest } = loadManifest(instrument);
  const files = new Set(manifest.zones.map((z) => z.file));
  return [...files].reduce((sum, f) => sum + statSync(path.join(dir, f)).size, 0);
}

describe("샘플 팩", () => {
  for (const instrument of INSTRUMENT_IDS) {
    it(`${instrument}: 매니페스트가 올바르고 가리키는 파일이 모두 있다`, () => {
      const { dir, manifest } = loadManifest(instrument);
      for (const zone of manifest.zones) {
        expect(existsSync(path.join(dir, zone.file)), `${instrument}/${zone.file}`).toBe(
          true,
        );
      }
    });

    it(`${instrument}: 악기당 상한 안이다`, () => {
      expect(bytesOf(instrument)).toBeLessThanOrEqual(PER_INSTRUMENT_BUDGET_BYTES);
    });

    it(`${instrument}: LICENSES.md에 출처가 적혀 있다`, () => {
      const licenses = readFileSync(path.join(ROOT, "LICENSES.md"), "utf8");
      expect(licenses).toMatch(new RegExp(`^## ${instrument}\\s*$`, "m"));
    });
  }

  it("첫 재생에 필요한 총량이 예산 안이다", () => {
    const total = INSTRUMENT_IDS.reduce((sum, i) => sum + bytesOf(i), 0);
    expect(total).toBeLessThanOrEqual(TOTAL_BUDGET_BYTES);
  });

  it("LICENSES.md의 모든 라이선스 줄이 CC0 또는 퍼블릭 도메인이다", () => {
    const licenses = readFileSync(path.join(ROOT, "LICENSES.md"), "utf8");
    const lines = licenses.split(/\r?\n/).filter((l) => /^- 라이선스:/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(INSTRUMENT_IDS.length);
    for (const line of lines) {
      expect(line).toMatch(/CC0|퍼블릭 도메인|Public Domain/i);
    }
  });
});
```

- [ ] **Step 7: 개발용 톤을 걷어낸다**

`.gitignore`에서 "개발용 임시 톤 팩" 주석과 `/public/samples/` 줄을 삭제한다. `public/samples/`에 개발용 톤 파일이 남아 있으면 지운 뒤 실제 팩 파일만 둔다. (`scripts/gen-dev-samples.mjs`는 파이프라인 점검용으로 남기되, 출력이 실제 팩을 덮어쓰지 않도록 `ROOT`를 `public/samples-dev`로 바꾸는 편이 안전하다 — 바꾸면 `.gitignore`에 `/public/samples-dev/`를 추가한다.)

- [ ] **Step 8: 검사를 통과시킨다**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: 통과. `budget.test.ts`가 통과한다.

- [ ] **Step 9: 사람이 귀로 확인한다 (사용자)**

- [ ] `pnpm dev` → `/`에서 4개 악기 상태가 `준비됨`이 되고 데모 곡이 "곡 같은 소리"로 재생된다.
- [ ] 같은 확인을 Safari(데스크톱 또는 iOS)에서 한다.
- [ ] Task 13 Step 11의 체크리스트(끊김, 30초 이상 드리프트, 마지막 소리 꼬리)를 실제 샘플로 다시 한다.
- [ ] 결과를 `docs/known-gaps.md` 2절에 날짜와 함께 반영한다.

- [ ] **Step 10: 커밋한다**

```bash
git add public/samples lib/audio/samples/budget.test.ts .gitignore docs/known-gaps.md
git commit -m "feat(assets): CC0 샘플 팩과 출처·예산 검증을 추가한다"
```

---

## Self-Review

**1. Spec 커버리지**

| spec | Task |
| --- | --- |
| 3.1 타입, 3.4 작업자·서명 자리 | 4 (`model.ts`의 `SongMeta`/`Author`), 8 (스키마 형식 검증) |
| 3.2 불변식(겹침 불가 포함) | 6 |
| 3.3 패턴 카탈로그·id 불변·펼치기·베이크 | 5, 7 |
| 3.5 스키마·복구 정책 | 8 |
| 4.1 유지하는 골격 | 10 (스케줄러·엔진 이식, 기존 테스트 유지) |
| 4.2 입력 `TrackEvents[]`, `setSong` 원자성 | 10 |
| 4.3 샘플 계층·지연 로딩·재생 전 보장 | 11, 12 |
| 4.3 샘플 출처·예산 | 15 (`budget.test.ts`, `LICENSES.md`) |
| 5 이식 대상(Scheduler/Engine/VoicePool/schema 정책/히스토리 규칙) | 2, 8, 10 |
| 6 최소 검증 화면 | 13 |
| 7 테스트 전략(jsdom, CRLF, 순수 함수화) | 1, 전역 제약, 14의 known-gaps |
| 8 오류 처리(로딩 실패·미지원 브라우저·AudioContext) | 11, 12, 13 |
| 9 완료 기준 5(문서) | 14 |
| 철거(spec 2절) | 3 |

**2. 플레이스홀더 점검:** "TBD"/"나중에"는 없다. 단, Task 15는 사람이 직접 해야 하는 단계(검색·청취·Safari)를 담고 있어 코드가 아닌 절차로 쓰였다. 이는 샘플 팩 이름이나 URL을 지어내지 않으려는 의도적 선택이다. Task 13 Step 11도 같은 이유로 체크리스트다.

**3. 타입 일관성:** `TrackEvents`/`ScheduledNote`(Task 7) ↔ `Scheduler` 입력(Task 10) ↔ `scheduler.test.ts`의 `demoEvents()`. `NoteSink.schedule(trackId, pitch, …)` ↔ 엔진 sink ↔ 테스트의 `RecordingSink`. `SamplePort.ensureReady(ctx: Decoder, …)`(Task 11) ↔ `Engine.play`가 `AudioContext`를 넘김(Task 12) ↔ `FakeSampleBank.ensureReady(_ctx: Decoder, …)`. `SampleStatus`의 5값은 `SampleBank`(Task 11)·`VerifyScreen`의 `STATUS_LABEL`(Task 13)·known-gaps/spec 갱신(Task 14)에서 같다. `PlayResult` 네 값은 `Engine`(Task 12)·`VerifyScreen`(Task 13)에서 같다. `Engine.setSong(): boolean`은 Task 10에서 만들고 Task 12·13이 그대로 쓴다.

**4. 알려진 위험(구현자가 알아야 할 것)**
- Task 10은 중간에 `check-types`가 깨지는 구간을 의도적으로 허용한다(스케줄러와 엔진이 서로 물려 있다). 끝에서 한 번 통과해야 한다.
- Task 11의 `settle()`(`setTimeout 0`)에 기대는 테스트는 `fetchBytes`가 마이크로태스크만 쓴다는 전제다.
- Task 13의 `useSyncExternalStore(bank.subscribe, …)`는 `bank.subscribe`의 참조가 안정적이어야 한다. `SampleBank`는 클래스 필드 화살표 함수로 만들어 안정적이다. 가짜는 `makeDeps` 안에서 한 번만 만든다.
- Task 13의 `createRealDeps`는 `useState` 초기화 중(렌더 중)에 `new Engine`을 만들고, 생성자가 `prefetch`를 부른다. 서버 렌더링·`next build` 프리렌더에서 상대 URL `fetch`가 실패하고 서버 HTML과 클라이언트 상태가 어긋날 수 있어, `defaultSampleBank()`가 `window`가 없으면 `prefetch`를 하지 않게 했다(`enabled`, Task 11). 모든 테스트가 가짜를 주입하므로 **이 경로는 자동 테스트가 직접 보지 못한다.** Task 13 Step 9의 `pnpm build`가 실패하거나 `/`가 동적 라우트로 바뀌면 이 렌더 중 부작용부터 의심한다.
- 개발 모드 StrictMode는 `useState` 초기화를 두 번 부르므로 뱅크가 둘 생기고 prefetch가 두 번 일어난다. 브라우저 HTTP 캐시가 중복을 흡수하며 프로덕션 빌드에는 영향이 없다.
- Task 15가 끝나기 전에는 실제 샘플이 없어 `pnpm build`·테스트는 통과해도 **앱은 개발용 톤으로만 소리가 난다.**
