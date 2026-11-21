# 블록 조립 편집 UI와 곡 모델 v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비전공자가 코드 진행 레인과 트랙별 패턴을 조립해 곡 뼈대를 만들고 들어 볼 수 있는 편집 화면(`/`)을 만든다. 이를 위해 곡 모델을 v3(코드 진행을 곡이 소유, 클립은 패턴만)로 올린다.

**Architecture:** `lib/score/`에 v3 모델·진행 조회·검증·펼치기·순수 편집 함수를 두고(규칙은 전부 여기), `state/StudioProvider`가 엔진 하나·실행취소·자동 저장을 소유하며, `components/studio/`가 그 위에서 그리고 드래그한다. 엔진·스케줄러·샘플 계층은 `TrackEvents[]`만 읽으므로 바뀌지 않는다.

**Tech Stack:** Next.js 16.2.12 App Router, React 19.2, TypeScript strict, zod 4.4.3, vitest 4.1.10(`node`/`jsdom` 프로젝트), `@testing-library/react`, Tailwind 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-21-arrangement-editor-design.md` (이 계획이 따르는 설계. 모호하면 spec이 우선한다.)

## Global Constraints

- 시간은 `PPQ = 480` 정수 틱. 4/4 한 마디 = 1920틱, 격자 `SNAP_TICKS = 960`(반마디), 새 클립 기본 길이 1920. UI는 4/4만 다룬다(모델은 박자표를 허용).
- 곡 모델 v3: `Song.v = 3`, `progression: ChordSegment[]`(곡 전체를 빈틈·겹침 없이 덮음), `PatternBody { type: "pattern"; pattern }`(코드 필드 없음), `NotesBody` 변경 없음. v2 곡은 거부한다(마이그레이션 없음).
- **모델 불변식은 `length ≥ 1`까지**, UI 편집 함수는 구간·클립 길이를 반마디 이상으로 유지한다. 같은 트랙의 클립은 겹치지 않는다. `validateSong`이 진행(`progression-invalid`)과 코드(`invalid-chord`: `root` 0..11 정수, 닫힌 `quality`)를 검사한다.
- 펼치기: 화음 악기 패턴의 각 스텝은 **그 스텝의 절대 시각에 해당하는 코드**로 음높이를 정한다. 드럼 패턴은 진행을 읽지 않는다. 재생과 내보내기는 같은 `expandSong`을 쓴다. 이벤트는 `tick` 오름차순(안정 정렬).
- **패턴 id는 불변이다.** `chords.ts`·`patterns.ts`와 패턴 스냅샷은 바뀌지 않는다.
- 편집 함수는 순수하고 새 `Song`을 돌려주며, **아무것도 안 바뀌면 같은 참조를 돌려준다**. 모든 결과는 `validateSong === []`이다. 편집은 **정지 중에만** 된다(엔진의 `setSong`이 재생 중·샘플 대기 중에 `false`를 돌려주는 규칙).
- 재생 상태 UI는 `engine.play()`가 `{status:"playing"}`으로 끝났을 때만 켠다(`isPlaying()`은 샘플 대기 중에도 참). 플레이헤드는 `requestAnimationFrame`에서 DOM `transform`만 쓰고 `useState`에 넣지 않는다.
- 엔진·`lib/audio/` 코드는 바꾸지 않는다. Web Audio·`window`를 모듈 스코프에서 건드리지 않는다. 오디오·브라우저 API를 쓰는 파일에는 `"use client"`.
- 브라우저: Chrome·Firefox 데스크톱, 마우스·키보드. **Safari·모바일 편집은 대상 아님.**
- 패키지 매니저 pnpm. 커밋 메시지 `<type>(<scope>): <한국어>`, 푸시하지 않는다. git은 이 머신에서 `git -c safe.directory=C:/Users/USER/Desktop/music …`로 쓴다(아래 명령의 `git`은 그 뜻). 프레임워크 레벨 코드(`app/`) 전에 `node_modules/next/dist/docs/`를 읽는다.
- 파일 내용을 정규식으로 파싱하는 테스트는 `\r?\n`. 모든 Task는 끝날 때 `pnpm lint`, `pnpm check-types`, `pnpm test`가 통과해야 한다(표시된 Task는 `pnpm build`도).
- 규칙이 든 로직은 훅·컴포넌트가 아니라 `lib/`의 순수 함수에 둔다(이 저장소의 결함은 전부 테스트 없는 UI·상태 계층에서 나왔다).

## 작업 순서

```text
1  모델 v3 이행 (lib/score 원자적)      ← 가장 위험. 이 위에 모든 것이 쌓인다
2  편집 함수 — 진행            3  편집 함수 — 클립·곡
4  자동 저장 순수 로직         5  격자 좌표 순수 함수
6  StudioProvider(상태·엔진·실행취소·저장)
7  화면 뼈대(상단·눈금·플레이헤드)  8  코드 레인   9  트랙 레인·클립 드래그·단축키
10 마디 추가·삭제, 복원 흐름, `/` 교체, 옛 화면 삭제 (build)
11 문서
```

Task 2~10은 **동작 규칙과 테스트 표를 정확히 정하고**, 구현 코드는 구현자가 테스트 우선으로 쓴다(Task 1은 완전한 코드 포함). 규칙·수치가 모호하면 구현하지 말고 멈춰서 묻는다.

---

### Task 1: 곡 모델 v3 이행 (원자적)

옛 `ChordBody`를 쓰는 모든 곳을 한 Task에서 고친다. 중간에 `check-types`가 깨지는 구간은 허용하고 **끝에서 전부 통과**해야 한다.

**Files:**
- Modify: `lib/score/model.ts`, `validate.ts`, `expand.ts`, `song-schema.ts`, `demo-song.ts`, `testing/builders.ts`
- Create: `lib/score/progression.ts`, `lib/score/progression.test.ts`
- Modify(테스트 이행): `expand.test.ts`, `validate.test.ts`, `song-schema.test.ts`, `demo-song.test.ts`, `patterns.test.ts`(chord 본문을 쓰는 곳만), `lib/audio/engine.test.ts`(chord 본문을 쓰는 곳만)

**Interfaces:**
- Produces (`model.ts`): `SONG_VERSION = 3`; `type PatternBody = { type: "pattern"; pattern: PatternId }`; `type ClipBody = PatternBody | NotesBody`; `type ChordSegment = { start: number; length: number; chord: Chord }`; `Song`에 `progression: ChordSegment[]`(`bars` 다음). `ChordBody`는 삭제.
- Produces (`progression.ts`): `defaultProgression(bars: number, timeSignature: [number, number]): ChordSegment[]`, `chordAt(progression: readonly ChordSegment[], tick: number): Chord`(이분 탐색, 범위 밖이면 `RangeError`), `segmentIndexAt(progression, tick): number`(같은 규칙).
- Produces (`expand.ts`): `clipNotes(clip: Clip, instrument: InstrumentId, progression: readonly ChordSegment[]): Note[]`, `bakeClip(clip, instrument, progression): Clip`, `bakeClipInSong(song, trackId, clipId)`(내부에서 `song.progression` 사용), `expandSong`·`instrumentsOf` 시그니처 유지.
- Produces (`validate.ts`): `ScoreIssueCode`에 `"progression-invalid"`, `"invalid-chord"` 추가.
- Produces (`testing/builders.ts`): 기존 `songWithNotes`가 `progression: defaultProgression(bars, [4,4])`를 채운다. 새 `songWithPatterns(opts: { tracks: Array<{ id: string; instrument: InstrumentId; clips: Array<{ id: string; start: number; length: number; pattern: string }> }>; bars?: number; progression?: ChordSegment[]; tempo?: number }): Song`.
- Produces (`demo-song.ts`): `buildDemoSong(): Song`(v3, 8마디, 120BPM, 4/4, 진행 C–Am–F–G7 각 2마디, 트랙 4개: `track-piano`/`track-guitar`/`track-bass`/`track-drums`; 멜로디 트랙은 삭제), `DEMO_BARS = 8`.

- [ ] **Step 1: 모델과 진행 조회의 실패하는 테스트를 쓴다**

Create `lib/score/progression.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { ChordSegment } from "@/lib/score/model";
import {
  chordAt,
  defaultProgression,
  segmentIndexAt,
} from "@/lib/score/progression";

const C = { root: 0, quality: "maj" } as const;
const AM = { root: 9, quality: "min" } as const;
const F = { root: 5, quality: "maj" } as const;

const PROG: ChordSegment[] = [
  { start: 0, length: 960, chord: C },
  { start: 960, length: 1920, chord: AM },
  { start: 2880, length: 960, chord: F },
];

describe("defaultProgression", () => {
  it("곡 전체를 덮는 C maj 한 구간이다", () => {
    expect(defaultProgression(8, [4, 4])).toEqual([
      { start: 0, length: 8 * 1920, chord: { root: 0, quality: "maj" } },
    ]);
  });

  it("박자표를 반영한다(3/4 한 마디 = 1440)", () => {
    expect(defaultProgression(2, [3, 4])[0].length).toBe(2880);
  });
});

describe("chordAt / segmentIndexAt", () => {
  it("구간 시작 틱은 그 구간에 속한다", () => {
    expect(chordAt(PROG, 0)).toBe(C);
    expect(chordAt(PROG, 960)).toBe(AM);
    expect(chordAt(PROG, 2880)).toBe(F);
  });

  it("구간 끝 직전 틱은 그 구간이고 끝 틱은 다음 구간이다", () => {
    expect(chordAt(PROG, 959)).toBe(C);
    expect(chordAt(PROG, 2879)).toBe(AM);
    expect(chordAt(PROG, 1919)).toBe(AM);
  });

  it("곡 마지막 틱은 마지막 구간이고 끝 틱 이상·음수는 RangeError다", () => {
    expect(chordAt(PROG, 3839)).toBe(F);
    expect(() => chordAt(PROG, 3840)).toThrow(RangeError);
    expect(() => chordAt(PROG, -1)).toThrow(RangeError);
    expect(() => chordAt([], 0)).toThrow(RangeError);
  });

  it("segmentIndexAt은 같은 규칙으로 인덱스를 돌려준다", () => {
    expect([0, 959, 960, 2879, 2880, 3839].map((t) => segmentIndexAt(PROG, t))).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
  });

  it("구간이 많아도 정확하다(이분 탐색 경계)", () => {
    const many: ChordSegment[] = Array.from({ length: 100 }, (_, i) => ({
      start: i * 960,
      length: 960,
      chord: { root: i % 12, quality: "maj" as const },
    }));
    for (const i of [0, 1, 49, 50, 98, 99]) {
      expect(segmentIndexAt(many, i * 960)).toBe(i);
      expect(segmentIndexAt(many, i * 960 + 959)).toBe(i);
    }
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm test lib/score/progression.test.ts`
Expected: FAIL — `@/lib/score/progression`을 찾을 수 없다.

- [ ] **Step 3: 모델 타입을 바꾼다**

In `lib/score/model.ts`:
- `export const SONG_VERSION = 2;` → `= 3;`
- `ChordBody` 타입(및 그 주석)을 아래로 교체하고 `ClipBody`를 갱신한다:

```ts
export type PatternBody = {
  type: "pattern";
  pattern: PatternId;
};

/** 곡 전체를 빈틈·겹침 없이 덮는 코드 구간. 코드는 여기서만 정한다. */
export type ChordSegment = {
  /** 곡 시작 기준 절대 틱. 정수. */
  start: number;
  /** 틱. 정수, 1 이상. */
  length: number;
  chord: Chord;
};

export type ClipBody = PatternBody | NotesBody;
```
- `Song` 타입에 `bars` 다음 줄로 추가: `/** 곡 전체를 덮는 코드 진행. start 오름차순, 빈틈·겹침 없음. */ progression: ChordSegment[];`

- [ ] **Step 4: `progression.ts`를 구현한다**

Create `lib/score/progression.ts`:

```ts
import type { Chord, ChordSegment, Song } from "./model";
import { ticksPerBar } from "./time";

/** 새 곡의 진행: 곡 전체가 C maj 한 구간이다. */
export function defaultProgression(
  bars: number,
  timeSignature: Song["timeSignature"],
): ChordSegment[] {
  return [
    {
      start: 0,
      length: bars * ticksPerBar(timeSignature),
      chord: { root: 0, quality: "maj" },
    },
  ];
}

/**
 * `tick`이 속한 구간의 인덱스. 구간은 start 오름차순으로 곡을 덮는다는
 * 불변식에 기댄다(이분 탐색). 어느 구간에도 속하지 않으면 RangeError —
 * 검증된 곡에서는 일어나지 않는다.
 */
export function segmentIndexAt(
  progression: readonly ChordSegment[],
  tick: number,
): number {
  let lo = 0;
  let hi = progression.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = progression[mid];
    if (tick < seg.start) hi = mid - 1;
    else if (tick >= seg.start + seg.length) lo = mid + 1;
    else return mid;
  }
  throw new RangeError(`코드 진행이 이 틱을 덮지 않습니다: ${tick}`);
}

export function chordAt(
  progression: readonly ChordSegment[],
  tick: number,
): Chord {
  return progression[segmentIndexAt(progression, tick)].chord;
}
```

- [ ] **Step 5: 진행 테스트 통과를 확인한다**

Run: `pnpm test lib/score/progression.test.ts`
Expected: PASS. (`check-types`는 아직 다른 파일이 깨져 있어 실패해도 된다.)

- [ ] **Step 6: 펼치기·베이크를 v3로 바꾼다 (테스트 먼저)**

`lib/score/expand.test.ts`를 v3에 맞게 **먼저** 고친다. 기존 케이스의 의도를 모두 유지하되 chord 클립을 `{ type: "pattern", pattern }`으로, 곡은 `songWithPatterns`로 만든다. 추가해야 할 새 케이스(숫자는 손으로 계산해 적는다):

| 케이스 | 입력 | 기대 |
| --- | --- | --- |
| 진행에 따라 같은 패턴의 음높이가 달라진다 | 피아노 `piano-block` 클립 2개(0~1920, 1920~3840), 진행 [C 0~1920, F 1920~3840] | 첫 클립 음 60·64·67, 둘째 클립 65·69·72 (F4=65, A4=69, C5=72) |
| 마디 중간 코드 변경은 그 시각부터 이어진다 | 피아노 `piano-arpeggio-8th` 한 클립(0~1920), 진행 [C 0~960, G 960~1920] | 스텝 0~3(시각 0,240,480,720)은 C 코드 degree [0,1,2,1]→ 60,64,67,64; 스텝 4~7(시각 960..1680)은 G 코드 degree [0,1,2,1] → 67,71,74,71 |
| 클립이 곡 중간에서 시작해도 절대 시각으로 조회한다 | 베이스 `bass-root-quarter` 클립 start 1920 길이 1920, 진행 [C 0~1920, F 1920~3840] | 음 4개 모두 pitch 41(F2: `12*3+5`), tick 1920·2400·2880·3360 |
| 코드 경계를 넘는 음은 시작 시점 코드의 높이를 유지한다 | `piano-block`(길이 1920) 클립 start 0, 진행 [C 0~960, F 960~1920] | 3음 모두 60·64·67(시작 시각 0의 코드), 길이 1920 |
| 드럼 패턴은 진행과 무관하다 | `drum-basic-rock` 클립 + 서로 다른 두 진행 | 두 경우 이벤트가 `toEqual` |
| 진행이 곡을 덮지 않으면 던진다 | 진행 [C 0~960]만, 길이 1920 클립 `piano-block` | `RangeError` |
| 베이크는 그 시점의 진행으로 굳는다 | 위 마디 중간 변경 곡에서 클립을 `bakeClip` | `notes` 본문의 음이 위 표(60,64,67,64,67,71,74,71)와 같고, 이후 `progression`을 바꿔도 `expandSong(baked)`는 그대로 |
| 베이크 동치 | 여러 클립·진행 변경이 있는 곡 | `expandSong(bakeClipInSong(song, …)) == expandSong(song)`이고 `validateSong === []` |

(드럼 `drum-basic-rock`에서 같은 틱의 킥(36)이 하이햇(42)보다 먼저 나오는 안정 정렬, 알 수 없는 패턴·악기 불일치 예외 등 기존 케이스는 그대로 유지한다.)

그다음 `lib/score/expand.ts`의 `clipNotes`·`bakeClip`·`bakeClipInSong`·`expandSong`을 아래로 바꾼다(`instrumentsOf`는 그대로).

```ts
import { chordPitch } from "./chords";
import type {
  Clip,
  ChordSegment,
  InstrumentId,
  Note,
  Song,
} from "./model";
import { getPattern } from "./patterns";
import { chordAt } from "./progression";

// ScheduledNote, TrackEvents 타입은 그대로.

/**
 * 클립 하나를 음 목록으로 편다. 반환은 **클립 상대 틱**이고 start 오름차순이다.
 *
 * - `notes` 클립은 이미 음이므로 그대로 돌려준다.
 * - `pattern` 클립은 패턴을 클립 길이만큼 반복해 만든다. 클립 끝을 넘는 음은
 *   끝에서 자르고, 끝 이후에 시작하는 스텝은 버린다.
 * - 화음 악기의 음높이는 **그 스텝의 절대 시각**(`clip.start + 상대 start`)의
 *   코드를 진행에서 찾아 정한다. 이미 시작한 음은 코드 경계를 넘어도 높이를
 *   유지한다. 드럼은 진행을 읽지 않는다.
 */
export function clipNotes(
  clip: Clip,
  instrument: InstrumentId,
  progression: readonly ChordSegment[],
): Note[] {
  const { body } = clip;
  if (body.type === "notes") return body.notes;

  const pattern = getPattern(body.pattern);
  if (!pattern) throw new Error(`알 수 없는 패턴: ${body.pattern}`);
  if ((pattern.kind === "drum") !== (instrument === "drums")) {
    throw new Error(`${instrument} 트랙에 맞지 않는 패턴: ${body.pattern}`);
  }

  const notes: Note[] = [];
  for (let base = 0; base < clip.length; base += pattern.length) {
    const emit = (
      at: number,
      length: number,
      pitchAt: (absoluteTick: number) => number,
      velocity: number,
    ) => {
      const start = base + at;
      if (start >= clip.length) return;
      notes.push({
        start,
        length: Math.min(length, clip.length - start),
        pitch: pitchAt(clip.start + start),
        velocity,
      });
    };

    if (pattern.kind === "drum") {
      for (const step of pattern.steps) {
        emit(step.at, step.length, () => step.pitch, step.velocity);
      }
    } else {
      for (const step of pattern.steps) {
        emit(
          step.at,
          step.length,
          (tick) => chordPitch(chordAt(progression, tick), step.degree, step.octave),
          step.velocity,
        );
      }
    }
  }

  // Array.prototype.sort는 안정 정렬이다 — 같은 start는 패턴에 적힌 순서를 유지한다.
  return notes.sort((a, b) => a.start - b.start);
}

export function expandSong(song: Song): TrackEvents[] {
  return song.tracks.map((track) => {
    const events: ScheduledNote[] = [];
    for (const clip of track.clips) {
      for (const note of clipNotes(clip, track.instrument, song.progression)) {
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

/** `pattern` 클립을 같은 id·start·length의 `notes` 클립으로 바꾼다. 한 방향이다. */
export function bakeClip(
  clip: Clip,
  instrument: InstrumentId,
  progression: readonly ChordSegment[],
): Clip {
  if (clip.body.type === "notes") return clip;
  return {
    ...clip,
    body: { type: "notes", notes: clipNotes(clip, instrument, progression) },
  };
}
```
`bakeClipInSong`은 `bakeClip(c, t.instrument, song.progression)`을 부르도록 한 줄만 바꾼다.

- [ ] **Step 7: 검증(`validateSong`)을 v3로 바꾼다 (테스트 먼저)**

`validate.test.ts`를 v3로 이행하고 새 케이스를 **먼저** 추가한다. `songWithNotes`는 이제 진행을 채우므로 기존 케이스는 그대로 통과해야 한다. 추가 케이스(`progression`을 직접 만들어 넣는다):

| 케이스 | 입력 | 기대 이슈(정확히) |
| --- | --- | --- |
| 올바른 진행 | 2마디 곡, [C 0~1920, F 1920~3840] | `[]` |
| 빈 진행 | `progression: []` | `["progression-invalid"]` |
| 시작이 0이 아님 | [C 480~3840] | `["progression-invalid"]` |
| 빈틈 | [C 0~960, F 1920~3840] | `["progression-invalid"]` |
| 겹침 | [C 0~2000, F 1920~3840] | `["progression-invalid"]` |
| 곡 끝에 못 미침 | [C 0~1920] (곡 길이 3840) | `["progression-invalid"]` |
| 곡 끝을 넘음 | [C 0~5000] | `["progression-invalid"]` |
| 소수 틱 | [C 0~960.5, F 960.5~3840] | `non-integer-tick`가 포함됨 |
| 길이 0 구간 | [C 0~0, F 0~3840] | `non-positive-length` 포함 |
| 알 수 없는 코드 종류 | quality `"aug"`(타입 우회) | `["invalid-chord"]` |
| 근음 범위·소수 | root 12, root 1.5, root -1 | 각각 `["invalid-chord"]` |
| 반마디 미만 구간 | [C 0~100, F 100~3840] | `[]` (모델은 length ≥ 1만 요구) |
| 패턴 본문 | `unknown-pattern`·`pattern-instrument-mismatch`가 `pattern` 본문에 적용 | 기존 케이스를 `type: "pattern"`으로 이행 |

`validate.ts`에 코드 `progression-invalid`/`invalid-chord`를 `ScoreIssueCode`에 추가하고, `validateSong` 안 곡 길이 검사 직후에 `checkProgression(song, songLength, add)`를 호출한다. `checkBody`의 `body.type === "chord"` 분기는 `"pattern"`으로 바꾼다. 아래를 추가한다:

```ts
function checkProgression(song: Song, songLength: number, add: Add): void {
  const { progression } = song;
  if (progression.length === 0) {
    add("progression-invalid", "progression", "코드 진행이 비어 있습니다");
    return;
  }

  let expectedStart = 0;
  let contiguous = true;
  progression.forEach((seg, i) => {
    const path = `progression[${i}]`;
    if (!Number.isInteger(seg.start) || !Number.isInteger(seg.length)) {
      add("non-integer-tick", path, "구간의 start와 length는 정수 틱이어야 합니다");
    }
    if (!(seg.length >= 1)) {
      add("non-positive-length", path, "구간 길이는 1틱 이상이어야 합니다");
    }
    const { root, quality } = seg.chord;
    if (
      !Number.isInteger(root) ||
      root < 0 ||
      root > 11 ||
      !(CHORD_QUALITIES as readonly string[]).includes(quality)
    ) {
      add("invalid-chord", path, "코드는 근음 0~11의 정수와 알려진 종류여야 합니다");
    }
    if (seg.start !== expectedStart) contiguous = false;
    expectedStart = seg.start + seg.length;
  });

  if (!contiguous || expectedStart !== songLength) {
    add(
      "progression-invalid",
      "progression",
      "코드 진행은 0부터 곡 끝까지 빈틈과 겹침 없이 이어져야 합니다",
    );
  }
}
```
(`CHORD_QUALITIES`를 `./model`에서 import한다. 소수 틱·길이 0 케이스에서는 위 표처럼 `progression-invalid`도 함께 나올 수 있으니, 그 두 행은 `toContain`으로 단언하고 나머지는 정확히 `toEqual`로 단언한다.)

- [ ] **Step 8: 스키마를 v3로 바꾼다 (테스트 먼저)**

`song-schema.test.ts`를 v3로 이행하고 먼저 추가한다:

| 케이스 | 기대 |
| --- | --- |
| v3 곡(진행 포함)은 통과, `repairs: []` | `ok: true` |
| `v: 2` | 거부(`v` 오류) |
| `progression` 키 없음 / `[]` | 거부 |
| 진행이 곡을 덮지 않음(빈틈·겹침·끝 불일치) | 거부, 메시지에 "코드 진행" |
| 진행 구간의 소수 틱 `{start 0.4, length 959.6}`+`{start 960, length 2880}` | 끝점 반올림으로 복구(`0~960`), 반올림 보고, 1틱 미만 겹침/빈틈은 반올림 후 판정(아래) |
| 진행이 `start` 순서가 어긋남 | 정렬해 통과, 정렬 보고 |
| 알 수 없는 `quality` | 거부(zod) |
| 클립 본문 `{type:"chord", chord, pattern}`(옛 v2 모양) | 거부 |
| 옛 `chord` 본문 + `v:3` | 거부 |

`song-schema.ts`: zod에서 `v: z.literal(SONG_VERSION)`(자동으로 3), 클립 본문은 `z.discriminatedUnion("type", [ z.object({ type: z.literal("pattern"), pattern: z.string().min(1) }), z.object({ type: z.literal("notes"), notes: z.array(noteSchema) }) ])`, `progression: z.array(z.object({ start: z.number(), length: z.number(), chord: chordSchema })).min(1)`를 추가한다. `repair`에서 진행을 클립과 같은 방식(`roundSpan`으로 끝점 반올림, `start` 정렬)으로 복구하고 반올림 개수를 기존 "소수 틱 N개" 보고에 합친다. 빈틈·겹침은 복구하지 않고 `validateSong`이 거부하게 둔다. 파일 맨 위 주석의 "구조만 본다" 설명에 진행 처리를 반영한다.

- [ ] **Step 9: 데모 곡과 빌더를 v3로 바꾼다**

`testing/builders.ts`: `songWithNotes`에 `progression: defaultProgression(bars, [4, 4])`와 `v: 3`을 채우고, `songWithPatterns`를 추가한다(진행 기본값은 `defaultProgression`, 클립은 `{ id, start, length, body: { type: "pattern", pattern } }`).

`demo-song.ts`: 기존 `PROGRESSION`(C, Am, F, G7 각 2마디)을 곡의 `progression`(구간 4개, 각 `3840`틱)으로 올리고, `chordClips`는 클립 본문을 `{ type: "pattern", pattern }`으로 만든다. 드럼 클립에서 가짜 코드 필드와 주석을 지운다. **멜로디 트랙(`track-melody`)을 삭제한다.** `v: 3`.

`demo-song.test.ts`를 갱신한다: 트랙 id가 정확히 `["track-piano","track-guitar","track-bass","track-drums"]`, 진행 구간 4개(각 3840, 코드 C·Am·F·G7), 악기 4종, 모든 트랙이 소리를 냄, `validateSong === []`, JSON 왕복 후 `parseSong`이 `repairs: []`로 통과, 하모닉 3트랙과 드럼의 마지막 클립 끝이 `DEMO_BARS * 1920`. 데모의 피아노 트랙을 펼쳐 1마디(C 구간)의 첫 음은 60, 3마디(Am 구간 시작, tick 3840)의 첫 음은 69(A4 = `12*5+9`)임을 확인하는 케이스를 추가한다(진행에 따라 같은 패턴의 음높이가 달라짐).

- [ ] **Step 10: 나머지 테스트를 이행하고 전부 통과시킨다**

`patterns.test.ts`·`lib/audio/engine.test.ts`에서 chord 본문을 쓰는 곳을 `pattern` 본문 + 진행 방식으로 바꾼다(엔진 테스트의 "잘못된 패턴으로 `setSong`이 던진다" 케이스는 `{ type: "pattern", pattern: "no-such-pattern" }`으로, 악기 불일치도 마찬가지). `lib/**`의 다른 파일이 `chord` 본문이나 `ChordBody`를 가리키지 않는지 확인한다:

Run: `grep -rnE '"chord"|ChordBody|v: 2' lib components app scripts --include=*.ts --include=*.tsx --include=*.mjs`
Expected: `type: "chord"` 문자열이 본문 용도로는 남지 않는다(`Chord` 타입·`chord:` 속성은 정상). 

- [ ] **Step 11: 전체 검사를 통과시킨다**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: 모두 통과. 패턴 스냅샷 파일(`lib/score/__snapshots__/*`)이 바뀌었다면 **되돌린다** — 패턴 id와 내용은 이 Task에서 바뀌지 않는다(줄바꿈만 바뀐 경우는 커밋하지 않는다).

- [ ] **Step 12: 변이 검증**

(임시로 코드를 망가뜨려 테스트가 실패하는지 확인하고 **되돌린다**. 결과를 보고서에 기록한다.)
- `expand.ts`: `chordAt(progression, clip.start + start)`를 `chordAt(progression, start)`(상대 틱)로 → "클립이 곡 중간에서 시작해도…" 실패.
- `expand.ts`: 조회 시각을 스텝 시각 대신 클립 시작(`clip.start`)으로 → "마디 중간 코드 변경" 실패.
- `validate.ts`: 빈틈 검사(`seg.start !== expectedStart`)를 지우면 → "빈틈" 실패. `expectedStart !== songLength`를 지우면 → "끝 불일치" 실패.
- `progression.ts`: `tick >= seg.start + seg.length`의 `>=`를 `>`로 → 경계 케이스 실패.

- [ ] **Step 13: 커밋한다**

```bash
git add -A
git commit -m "refactor(score): 곡 모델을 코드 진행 소유(v3)로 올린다"
```

---

### Task 2: 순수 편집 함수 — 코드 진행

**Files:**
- Create: `lib/score/edit.ts`(이 Task에서 시작; Task 3이 이어서 채운다), `lib/score/edit.test.ts`
- Create: `lib/score/testing/random.ts`(시드 고정 난수, Task 3의 속성 테스트도 쓴다)

**Interfaces:**
- Produces (`edit.ts`): 상수 `SNAP_TICKS = 960`, `DEFAULT_CLIP_TICKS = 1920`, `MIN_BARS = 1`, `MAX_BARS_UI = 64`; 헬퍼 `snapTick(tick: number): number`(= `Math.round(tick / SNAP_TICKS) * SNAP_TICKS`); `setChord(song: Song, index: number, chord: Chord): Song`; `splitSegment(song: Song, tick: number): Song`; `moveBoundary(song: Song, index: number, tick: number): Song`; `mergeSegments(song: Song, index: number): Song`.
- Produces (`testing/random.ts`): `mulberry32(seed: number): () => number`.

**규칙** (모든 함수: 입력 `song`은 변형하지 않고, 아무것도 안 바뀌면 **같은 참조**를 돌려준다. 결과는 `validateSong === []`):

- `setChord(song, index, chord)`: `index`가 범위 밖이면 `RangeError`. 근음·종류가 같으면 no-op. 아니면 그 구간의 `chord`만 바꾼다.
- `splitSegment(song, tick)`: `t = snapTick(tick)`. `t`가 어떤 구간 안쪽(`seg.start < t < seg.start + seg.length`)이고 **양쪽 길이가 모두 `SNAP_TICKS` 이상**일 때만 같은 코드의 두 구간으로 쪼갠다. 아니면 no-op.
- `moveBoundary(song, index, tick)`: `0 ≤ index < 구간 수 - 1`이 아니면 `RangeError`. `a = progression[index]`, `b = progression[index+1]`, `lo = a.start + SNAP_TICKS`, `hi = b.start + b.length - SNAP_TICKS`. `lo > hi`이면 no-op. `t = min(max(snapTick(tick), lo), hi)`. `t === b.start`이면 no-op. 아니면 경계를 `t`로 옮긴다(`a.length = t - a.start`, `b.start = t`, `b.length = bEnd - t`).
- `mergeSegments(song, index)`: 구간이 하나뿐이거나 `index`가 `0 ≤ index < 구간 수 - 1`이 아니면 `RangeError`(구간이 하나뿐일 때는 no-op — 구현은 둘 중 하나로 고정하고 테스트로 못박는다: **구간 하나뿐이면 no-op, 범위 밖 인덱스는 `RangeError`**). `index`와 `index+1`을 `{ start: a.start, length: a.length + b.length, chord: a.chord }`로 합친다(왼쪽 코드).

**테스트 표** (기본 곡: `songWithPatterns({ bars: 4, tracks: [], progression })`로 `bars: 4`(총 7680틱), 진행 `P = [C 0~1920, Am 1920~3840, F 3840~7680]`):

| 함수 | 입력 | 기대 |
| --- | --- | --- |
| setChord | (P, 1, F) | 구간 1의 chord가 F, 나머지 동일, `start/length` 불변 |
| setChord | (P, 1, Am과 같은 코드) | `toBe(song)` |
| setChord | index −1, 3 | `RangeError` |
| splitSegment | tick 960 | `[C 0~960, C 960~1920, Am, F]` (5개) |
| splitSegment | tick 1000 | 스냅 960과 같다 |
| splitSegment | tick 1500 | 스냅 1920 = 구간 경계 → no-op |
| splitSegment | tick 100 | 스냅 0 → no-op |
| splitSegment | 구간 길이 1920의 정확히 가운데(960)만 허용, tick 480/1440 | 스냅 960/1920 → 480은 0이 아닌 960(스냅)이 되어 분할, 1440→1920 경계 no-op |
| splitSegment | 길이 960 구간 안(`start+480`) | 양쪽 480 < 960 → no-op |
| moveBoundary | (P, 0, 2880) | 경계 1920→2880: C 0~2880, Am 2880~3840 |
| moveBoundary | (P, 0, 0) | 클램프: lo = 960 → C 0~960, Am 960~3840 |
| moveBoundary | (P, 0, 99999) | hi = 3840-960 = 2880 → 위와 같은 결과 |
| moveBoundary | (P, 0, 1920) | 변화 없음 → no-op |
| moveBoundary | (P, 2, …) | `RangeError`(마지막 구간 뒤에는 경계가 없다) |
| moveBoundary | 두 구간이 모두 960 길이일 때 어느 쪽으로도 이동 | 클램프 결과 변화 없음 → no-op |
| mergeSegments | (P, 0) | `[C 0~3840, F 3840~7680]` (왼쪽 코드 C) |
| mergeSegments | (P, 1) | `[C, Am 1920~7680]` (왼쪽 코드 Am) |
| mergeSegments | 구간 1개뿐 | no-op |
| mergeSegments | index −1, 구간 수−1 | `RangeError` |
| 공통 | 각 연산 뒤 | `validateSong(result) === []`, 원본 `P`는 변형되지 않음(깊은 비교로 복사본과 같음) |
| 속성 | 시드 20개 × 연산 200번(분할·이동·합치기·코드 변경을 무작위로) | 매번 `validateSong === []`, 모든 구간 길이 `% 960 === 0`이고 `≥ 960`, 구간 합 = 곡 길이 |

**변이 검증:** `snapTick`을 `Math.floor`로 → 스냅 케이스 실패; `moveBoundary`의 `lo` 클램프를 지우면 `(P,0,0)`이 반마디 미만 구간을 만들어 실패; `mergeSegments`가 오른쪽 코드를 쓰게 → 합치기 케이스 실패; no-op이 새 객체를 돌려주면 `toBe` 케이스 실패.

- [ ] **Step 1~N: 테스트를 먼저 쓰고(RED 확인) 구현해 통과시킨다.** 위 표의 모든 행이 테스트 이름이 되어야 한다. 속성 테스트는 `mulberry32(seed)`로 결정적이어야 한다(`Math.random` 금지).
- [ ] **마지막: 검증·커밋**

Run: `pnpm lint && pnpm check-types && pnpm test`

```bash
git add lib/score/edit.ts lib/score/edit.test.ts lib/score/testing/random.ts
git commit -m "feat(score): 코드 진행 편집 함수를 추가한다"
```

---

### Task 3: 순수 편집 함수 — 클립·곡 전체

**Files:** Modify `lib/score/edit.ts`, `lib/score/edit.test.ts`

**Interfaces:**
- Produces: `addClip(song: Song, trackId: string, startTick: number): Song`; `moveClip(song: Song, trackId: string, clipId: string, startTick: number): Song`; `resizeClip(song: Song, trackId: string, clipId: string, lengthTicks: number): Song`; `removeClip(song: Song, trackId: string, clipId: string): Song`; `setClipPattern(song: Song, trackId: string, clipId: string, patternId: string): Song`; `setTrackPattern(song: Song, trackId: string, patternId: string): Song`; `setBars(song: Song, bars: number): Song`; `setTempo(song: Song, bpm: number): Song`.
- Consumes: `patternsFor`(patterns.ts), `ticksPerBar`/`songLengthTicks`(time.ts), `MIN_TEMPO`/`MAX_TEMPO`(model.ts).

**규칙** (공통: `trackId`/`clipId`가 없으면 `Error`, 아무것도 안 바뀌면 같은 참조, 결과는 `validateSong === []`; `L = songLengthTicks(song)`):

- `addClip`: `s = Math.floor(startTick / SNAP_TICKS) * SNAP_TICKS`(**클릭한 칸의 시작**). `s < 0`이거나 `s + SNAP_TICKS > L`이면 no-op. `s`가 기존 클립 안(`clip.start ≤ s < clip.start + clip.length`)이면 no-op. `free = (s 뒤 첫 클립의 start, 없으면 L) - s`. `length = floor(min(DEFAULT_CLIP_TICKS, free) / SNAP_TICKS) * SNAP_TICKS`, `length < SNAP_TICKS`이면 no-op. 패턴은 `patternsFor(instrument)[0].id`. id는 트랙 안 기존 id 중 `/^clip-(\d+)$/`의 최댓값 + 1로 `clip-<n>`(없으면 `clip-1`), 이미 쓰이면 다음 번호로 올려 유일하게. 클립은 `start` 순서가 유지되도록 삽입한다.
- `moveClip`: `lower = 이전 클립 끝(없으면 0)`, `upper = (다음 클립 start, 없으면 L) - clip.length`. `upper < lower`이면 no-op. `t = min(max(snapTick(startTick), lower), upper)`. `t === clip.start`이면 no-op.
- `resizeClip`: `upper = (다음 클립 start, 없으면 L) - clip.start`. `len = min(max(snapTick(lengthTicks), SNAP_TICKS), upper)`(이미 `upper < SNAP_TICKS`면 `len = upper`). `len === clip.length`이면 no-op. `notes` 본문이면 새 길이를 넘는 음 정리: `start ≥ len`이면 버리고 `start + length > len`이면 `length = len - start`.
- `removeClip`: 클립 제거.
- `setClipPattern`: 클립 본문이 `notes`면 `Error("notes 클립에는 패턴이 없습니다")`. `patternId`가 `patternsFor(instrument)`에 없으면 `Error`. 같은 패턴이면 no-op.
- `setTrackPattern`: 그 트랙의 **모든 `pattern` 클립**에 적용. 패턴이 악기와 안 맞으면 `Error`. 바뀐 클립이 없으면 no-op. `notes` 클립은 건드리지 않는다.
- `setBars`: `b = clamp(Math.round(bars), MIN_BARS, MAX_BARS_UI)`. `b === song.bars`이면 no-op. `newL = b * ticksPerBar(song.timeSignature)`. **늘릴 때:** 마지막 진행 구간의 `length`를 `newL - L`만큼 늘린다. **줄일 때:** 진행에서 `start ≥ newL`인 구간을 버리고 마지막 구간을 `newL`까지로 자른다; 클립은 `start ≥ newL`이면 삭제하고 `start + length > newL`이면 `length = newL - start`로 자른다(`notes` 본문은 음도 같은 규칙으로 정리).
- `setTempo`: `bpm`을 반올림해 `[MIN_TEMPO, MAX_TEMPO]`로 클램프. 같으면 no-op.

**테스트 표** (`songWithPatterns`로 만든 `bars: 4`(L = 7680) 곡에 피아노 트랙 `t-piano`(클립 `clip-1`: 0~1920 `piano-block`, `clip-2`: 3840~5760 `piano-arpeggio-8th`)와 드럼 트랙 `t-drums`(클립 없음); 진행은 기본):

| 함수 | 입력 | 기대 |
| --- | --- | --- |
| addClip | (`t-piano`, 1920) | 새 클립 `clip-3`: start 1920, length 1920(다음 클립 3840까지 빈 공간 1920), 패턴 `piano-block`, 배열 순서 `clip-1,clip-3,clip-2` |
| addClip | (`t-piano`, 2000) | floor → 1920과 같은 결과 |
| addClip | (`t-piano`, 960) | 클립 `clip-1` 안 → no-op |
| addClip | (`t-piano`, 5760) | 길이 min(1920, 7680-5760=1920)=1920, 새 클립 `clip-3` start 5760 |
| addClip | (`t-piano`, 7000) | 7000→6720, free 960 → 길이 960 |
| addClip | (`t-piano`, 7680) / (`t-piano`, −10) | no-op / floor(-10/960)=-1 → `s<0` no-op |
| addClip | (`t-drums`, 0) | 패턴 `drum-basic-rock`(카탈로그 첫 드럼 패턴), 길이 1920 |
| addClip | 존재하지 않는 `trackId` | `Error` |
| addClip | 두 번 연속 같은 칸 | 둘째는 no-op |
| moveClip | (`clip-1`, 1000) | 스냅 960 → start 960 |
| moveClip | (`clip-1`, 99999) | upper = 3840-1920=1920 → start 1920 |
| moveClip | (`clip-2`, 0) | lower = 1920(clip-1 끝) → start 1920 |
| moveClip | (`clip-1`, 0) | 변화 없음 → no-op |
| moveClip | (`clip-2`, 99999) | upper = 7680-1920=5760 → start 5760 |
| resizeClip | (`clip-1`, 960) | length 960 |
| resizeClip | (`clip-1`, 100) | 최소 960 |
| resizeClip | (`clip-1`, 99999) | upper = 3840 → length 3840 |
| resizeClip | (`clip-2`, 99999) | upper = 7680-3840=3840 → length 3840 |
| resizeClip | (`clip-1`, 1920) | no-op |
| resizeClip(notes) | 길이 1920의 `notes` 클립 음 3개(start 0/960/1440, length 480)를 960으로 | start 960·1440 음 삭제(`start ≥ 960`), start 0 음 유지 |
| resizeClip(notes) | 음 `{start 800, length 480}`을 길이 1000으로 줄임 | 그 음이 `length 200`으로 잘림 |
| removeClip | `clip-1` | 클립 하나 감소, 없는 id → `Error` |
| setClipPattern | (`clip-1`, `piano-arpeggio-8th`) | 패턴 변경 |
| setClipPattern | 드럼 패턴 id를 피아노에 | `Error`, 같은 패턴 | no-op |
| setClipPattern | `notes` 클립 | `Error` |
| setTrackPattern | (`t-piano`, `bass-root-fifth`) | 모든 피아노 `pattern` 클립 변경(두 클립 모두), `notes` 클립이 있으면 불변 |
| setTrackPattern | 이미 모두 그 패턴 | no-op |
| setBars | 8 | 진행 마지막 구간 length += 7680, 클립 불변 |
| setBars | 2 | L=3840: 진행 `start ≥ 3840` 구간 버림·마지막 자름, `clip-2`(start 3840) 삭제, `clip-1` 유지 |
| setBars | 3(클립 `clip-2` 3840~5760, 새 L 5760) | `clip-2`는 `start 3840 < 5760`, 끝 5760 → 길이 그대로 |
| setBars | 3, 클립이 새 끝을 가로지름(예: 4800~6720) | length 960으로 잘림 |
| setBars | 0, 100, 4.6 | 1, 64, 5로 클램프 |
| setBars | 같은 값 | no-op |
| setTempo | 500, 10, 119.6 | 240, 40, 120; 같은 값 no-op |
| 속성 | 시드 20개 × 연산 300번(add/move/resize/remove/setClipPattern/setTrackPattern/setBars/Task 2의 진행 연산을 섞어 무작위) | 매번 `validateSong === []`, 같은 트랙 클립이 겹치지 않음, 입력 곡이 변형되지 않음 |

**변이 검증:** `moveClip`의 `lower`/`upper` 클램프를 지우면 겹침 케이스 실패; `addClip`의 `Math.floor`를 `Math.round`로 → `(2000)`/`(7000)` 케이스 실패; `resizeClip`의 `upper` 클램프 삭제 → 겹침 실패; `setBars` 줄일 때 진행 자르기를 지우면 속성 테스트의 `validateSong`이 실패; no-op 참조 케이스 전부.

- [ ] **테스트 우선 구현, 변이 검증 후 커밋**

Run: `pnpm lint && pnpm check-types && pnpm test`

```bash
git add lib/score/edit.ts lib/score/edit.test.ts
git commit -m "feat(score): 클립·곡 전체 편집 함수를 추가한다"
```

---

### Task 4: 자동 저장 순수 로직

**Files:** Create `lib/score/autosave.ts`, `lib/score/autosave.test.ts`

**Interfaces:**
- Produces: `AUTOSAVE_KEY = "bandline:song:v3"`; `serializeSong(song: Song): string`(`JSON.stringify`); `type LoadResult = { song: Song; notice: string | null }`; `loadSong(raw: string | null): LoadResult`.
- Consumes: `parseSong`(song-schema.ts), `buildDemoSong`(demo-song.ts).

**규칙:** `raw`가 `null`·빈 문자열이면 데모 곡, `notice: null`. JSON 파싱 실패 또는 `parseSong`이 `ok:false`이면 데모 곡 + 한 줄 `notice`("저장된 곡을 읽지 못해 데모 곡으로 시작합니다"). `ok:true`이고 `repairs`가 있으면 그 곡 + `notice`("저장된 곡을 고쳐서 열었습니다: " + 보고 문구를 `; `로 이은 것, 200자에서 자르고 `…`). 옛 v2 곡은 `parseSong`이 거부하므로 같은 경로다.

**테스트:** null·`""`·`"{"`(깨진 JSON)·`"null"`·`"[]"`·v2 곡 JSON·v3인데 진행이 빠진 곡 → 데모 + 안내(첫 둘만 안내 없음); 올바른 곡 왕복(`loadSong(serializeSong(song)).song`이 `toEqual(song)`, `notice === null`); 복구가 필요한 곡(소수 틱) → 복구된 곡 + 안내에 "고쳐서" 포함; 안내 문구 길이 상한. **변이:** `ok:false` 분기에서 부분 결과를 쓰면 → 실패.

- [ ] **테스트 우선 구현·검증·커밋**

```bash
git add lib/score/autosave.ts lib/score/autosave.test.ts
git commit -m "feat(score): 자동 저장 직렬화와 안전한 읽기를 추가한다"
```

---

### Task 5: 격자 좌표 순수 함수

**Files:** Create `components/studio/geometry.ts`, `components/studio/geometry.test.ts`

**Interfaces:**
- Produces: `PX_PER_BAR = 160`, `BAR_TICKS = 1920`; `tickToX(tick: number): number`(`tick / BAR_TICKS * PX_PER_BAR`); `xToTick(x: number): number`(`Math.round(x / PX_PER_BAR * BAR_TICKS)`); `pointerToTick(clientX: number, laneLeft: number, scrollLeft?: number): number`(`max(0, xToTick(clientX - laneLeft + scrollLeft))`); `clipRect(start: number, length: number): { left: number; width: number }`; `deltaTicks(fromClientX: number, toClientX: number): number`(`xToTick(to - from)`, 음수 허용); `barLabels(bars: number): number[]`(`[1..bars]`).
- 이 모듈은 DOM·React를 import하지 않는다.

**테스트:** 왕복(`xToTick(tickToX(t)) === t` for 960 배수와 임의 정수 틱); 한 마디 = 160px; `pointerToTick`의 스크롤 보정과 음수 클램프; `clipRect(960, 1920)` = `{left: 80, width: 160}`; `deltaTicks`의 부호; 반올림 경계(`xToTick(0.5)`=6(0.5/160*1920=6)). **변이:** `PX_PER_BAR`와 `BAR_TICKS`의 위치를 서로 바꾸면 실패.

- [ ] **테스트 우선 구현·검증·커밋**

```bash
git add components/studio/geometry.ts components/studio/geometry.test.ts
git commit -m "feat(editor): 격자 좌표 변환 순수 함수를 추가한다"
```

---

### Task 6: StudioProvider — 상태·엔진·실행취소·자동 저장

**Files:**
- Create: `state/StudioProvider.tsx`, `state/useStudio.ts`(훅 export), `state/StudioProvider.test.tsx`, `state/types.ts`
- Create: `state/testing/fake-deps.ts`(테스트용 가짜 엔진·뱅크·저장소 — `components/verify/VerifyScreen.test.tsx`의 `makeDeps`를 참고)

**Interfaces:**
- Produces (`state/types.ts`): 
  ```ts
  export type StudioEngine = Pick<Engine, "play" | "stop" | "setSong" | "setTempo" | "setMetronome" | "currentTick" | "dispose"> & { onStop: (() => void) | null };
  export type StudioBank = { prefetch(i: readonly InstrumentId[]): void; getSnapshot(): Readonly<Record<InstrumentId, SampleStatus>>; subscribe(l: () => void): () => void };
  export type StudioStorage = { getItem(k: string): string | null; setItem(k: string, v: string): void };
  export type StudioDeps = { engine: StudioEngine; bank: StudioBank; storage: StudioStorage | null };
  export type Selection = { trackId: string; clipId: string } | null;
  export type StudioApi = {
    song: Song; selection: Selection; select(s: Selection): void;
    playing: boolean; pending: boolean;           // pending = play()를 기다리는 중
    editable: boolean;                             // !playing && !pending
    position: { bar: number; beat: number };
    message: string | null; dismissMessage(): void;
    sampleStatuses: Readonly<Record<InstrumentId, SampleStatus>>;
    retrySamples(instrument: InstrumentId): void;
    canUndo: boolean; undo(): void;
    play(): Promise<void>; stop(): void;
    setTempo(bpm: number): void; metronome: boolean; setMetronome(on: boolean): void;
    getEngine(): StudioEngine;                     // 플레이헤드용(읽기)
    edit: { setChord, splitSegment, moveBoundary, mergeSegments, addClip, moveClip, resizeClip, removeClip, setClipPattern, setTrackPattern, setBars };  // lib/score/edit.ts 함수와 같은 인자(첫 인자 song 제외)
  };
  ```
- Produces: `<StudioProvider createDeps?={() => StudioDeps}>{children}</StudioProvider>`와 `useStudio(): StudioApi`(Provider 밖이면 `Error`).
- Consumes: `lib/score/history.ts`(`createHistory`/`commit`/`replaceWithoutHistory`/`undo`/`canUndo`), `lib/score/edit.ts`, `lib/score/autosave.ts`, `Engine`/`defaultSampleBank`(실제 deps 생성), `buildDemoSong`.

**규칙:**
- 실제 deps는 `useState` 초기화에서 만든다(`new Engine(song, undefined, bank)`, `defaultSampleBank()`, `typeof window !== "undefined" ? window.localStorage(try/catch) : null`). 서버 렌더에서는 `localStorage`를 건드리지 않는다. 초기 곡은 `storage?.getItem(AUTOSAVE_KEY)`를 `loadSong`에 넣은 결과(`notice`가 있으면 `message`로). **서버 렌더와 클라이언트 첫 렌더가 달라 하이드레이션 불일치가 나지 않게** 한다: 서버에서는 항상 데모 곡이고, 클라이언트에서 저장된 곡이 있으면 마운트 뒤(`useEffect`)에 교체한다(교체는 실행취소에 쌓지 않는다).
- **편집 액션(`edit.*`)은 `editable`일 때만 동작한다.** 아니면 아무 일도 하지 않는다. 동작할 때는 `commit(history, (s) => editFn(s, …))`(같은 참조면 기록 안 됨).
- `setTempo`는 `replaceWithoutHistory`(템포는 실행취소에 쌓지 않음) + `engine.setTempo(bpm)`(재생 중에도 즉시). `editable` 제한 없음.
- 곡이 바뀌면(정지 중·`pending` 아님) `engine.setSong(song)`으로 엔진을 맞춘다. 재생 시작 대기(`pending`) 중에는 엔진이 `false`를 돌려주므로 대기가 끝나 `playing=false`가 되면(예: `not-ready`) 다시 맞춘다(`useEffect` 의존성에 `song`, `playing`, `pending`).
- `play()`: `pending=true` → `await engine.play()` → `pending=false`. `result.status === "playing"`일 때만 `playing=true`. `not-ready`면 `message = "샘플을 불러오지 못한 악기가 있어 재생하지 않았습니다: <악기 한글 이름>"`. `superseded`/`already-playing`은 상태 변화 없음. 예외면 `message = "소리를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요."`. 이미 `pending`이거나 `playing`이면 무시.
- `stop()`/`engine.onStop`(자동 정지): `playing=false`, 위치 `{1,1}`로 초기화, 엔진을 최신 곡·템포로 다시 맞춘다(`setSong({...song, tempo})`는 곡이 이미 템포를 가진다). `onStop` 바인딩은 `useEffect`에서 하고 정리 시 `null`로 되돌리며 `engine.dispose()`.
- 위치: 재생 중에만 100ms 간격으로 `engine.currentTick()`을 `min(tick, 곡 길이 - 1)`로 클램프해 `ticksToBarBeat`로 바꿔 상태에 넣는다(같은 값이면 이전 객체 유지).
- **자동 저장:** 곡이 바뀐 뒤 300ms 디바운스로 `storage.setItem(AUTOSAVE_KEY, serializeSong(song))`. 초기 로드·복원으로 생긴 곡은 즉시 저장하지 않아도 된다(편집이 있을 때 저장). `setItem` 예외(용량·차단)는 삼키고 `message`에 한 번만 "브라우저에 저장하지 못했습니다"를 알린다. `pagehide` 때 대기 중 저장을 즉시 flush.
- 샘플 상태는 `useSyncExternalStore(bank.subscribe, bank.getSnapshot, () => IDLE_STATUSES)`(서버 스냅샷은 고정 idle 맵 — `components/verify/VerifyScreen.tsx`의 하이드레이션 수정과 같은 이유). `retrySamples(i)` = `bank.prefetch([i])`.
- `undo()`: `lib/score/history.undo`. `editable`이 아니면 무시. 실행취소 후 엔진 동기화(곡 변경 effect가 처리).
- 한 번의 `commit`은 한 칸, 한도 `HISTORY_LIMIT`(50).

**테스트(jsdom, 가짜 deps):** 
1. 초기 곡: 저장값 없음→데모, 올바른 저장값→그 곡, 깨진 저장값→데모+`message`(안내), v2 저장값→데모+안내, 저장소 `null`→데모.
2. 편집 액션이 곡을 바꾸고 `canUndo`가 참이 되며 `undo`가 되돌린다. 제자리 편집(no-op)은 기록되지 않는다(`canUndo` 거짓 유지).
3. 정지 중 편집 후 `engine.setSong`이 최신 곡으로 호출된다. 
4. **재생 상태:** 지연되는 `play`(수동 resolve) 동안 `playing`은 거짓·`pending` 참·`editable` 거짓(편집 액션이 무시됨), resolve `playing` 뒤 `playing` 참. `not-ready` → `message`에 실패 악기 이름, `playing` 거짓, **편집 가능으로 복귀하고 `engine.setSong`이 다시 호출**됨. `superseded`/`already-playing` → 변화 없음. 거부(reject) → 재시도 메시지.
5. 자동 정지(`engine.onStop?.()`)와 `stop()` → `playing` 거짓, 위치 `{1,1}`, 엔진이 최신 곡으로 `setSong` 호출.
6. 재생 중 편집 액션은 곡을 바꾸지 않는다. `setTempo`는 재생 중에도 `engine.setTempo` 호출 + 곡 템포 변경 + 실행취소에 쌓이지 않음.
7. 자동 저장: 편집 후 299ms에는 저장 안 됨, 300ms에 `setItem(AUTOSAVE_KEY, …)` 호출(가짜 타이머), 연속 편집은 한 번만 저장, 저장된 문자열이 `loadSong`으로 왕복됨, `setItem`이 던져도 앱이 죽지 않고 `message`가 한 번만 나온다, `pagehide`에서 flush.
8. 서버 렌더(`renderToString`) → 하이드레이션 경고 없음(저장된 곡이 있어도 첫 렌더는 데모 곡, 이후 교체).
9. 언마운트 시 `engine.onStop`이 `null`, `dispose` 호출, 타이머 정리(남은 타이머 0).
10. `useStudio`를 Provider 밖에서 쓰면 `Error`.

**변이 검증:** `playing`을 `play()` 호출 직전에 켠다 → 4번 실패; `not-ready` 뒤 재동기화 의존성(`pending`)을 지우면 → 4번의 재동기화 단언 실패; `editable` 가드를 지우면 → 6번 실패; 디바운스를 없애면 → 7번 실패; 자동 정지 콜백에서 `setSong` 재동기화를 지우면 → 5번 실패.

- [ ] **테스트 우선 구현·검증·커밋**

Run: `pnpm lint && pnpm check-types && pnpm test`

```bash
git add state
git commit -m "feat(state): 편집 상태·엔진 동기화·실행취소·자동 저장을 맡는 StudioProvider를 추가한다"
```

---

### Task 7: 화면 뼈대 — 상단 바, 눈금, 플레이헤드

**Files:**
- Create: `components/studio/Studio.tsx`, `TopBar.tsx`, `Ruler.tsx`, `Playhead.tsx`, `SampleStatus.tsx`, 테스트 `Studio.test.tsx`, `TopBar.test.tsx`, `Playhead.test.tsx`
- Create(테스트 도우미): `components/studio/testing/pointer.ts` — jsdom이 `PointerEvent`/`clientX`를 지원하지 않으면 `MouseEvent` 기반으로 포인터 이벤트를 만들어 `fireEvent`에 넘기는 헬퍼(`firePointer(el, type, { clientX, clientY, pointerId })`)와 `getBoundingClientRect`·`setPointerCapture` 스텁

**Interfaces:**
- Produces: `<Studio />`(`useStudio()`를 읽는 최상위 화면), `TopBar`, `Ruler({ bars })`, `Playhead({ engine, playing, lengthTicks })`, `SampleStatus`.
- 레이아웃: 상단 바 + 좌측 트랙 이름 열(폭 96px) + 가로 스크롤되는 격자(`bars × PX_PER_BAR`px, 마디 눈금 `Ruler`, 한 마디 안 박 구분선). 격자 영역은 `data-testid="timeline"`.

**규칙:**
- **상단 바:** 재생/정지 버튼(`playing`이면 "정지", 아니면 "재생"; `pending`이면 "재생"을 비활성화하지 말고 `aria-busy`만 — 정지 버튼은 `playing`일 때만), 위치 `N마디 · M박`(`font-mono tabular-nums`), 템포 슬라이더(`aria-label="템포"`, `MIN_TEMPO..MAX_TEMPO`)와 값, 메트로놈 체크박스(`aria-label="메트로놈"`), 되돌리기 버튼(`aria-label="되돌리기"`, `canUndo`·`editable`일 때만 활성), 악기별 샘플 상태 목록(`VerifyScreen`의 문구와 같다: 준비됨/불러오는 중/받음(재생 때 마무리)/대기/실패, `error`면 "<악기> 다시 시도" 버튼), 메시지 줄(`role="alert"`, 닫기 버튼).
- 재생 중에는 편집 컨트롤(되돌리기, 마디 추가·삭제, 격자 상호작용)이 비활성이고 상단에 "재생 중에는 편집할 수 없습니다"가 보인다. 재생 시작 대기 중에는 "샘플을 불러오는 중…"이 보인다(편집 불가).
- **Playhead:** 격자 안의 세로선 `div`(ref). `playing`일 때만 `requestAnimationFrame` 루프를 돌려 `style.transform = translateX(tickToX(min(engine.currentTick(), lengthTicks))px)`를 쓴다. `useState`에 넣지 않는다. 정지하면 루프를 취소하고 `translateX(0)`. 언마운트 시 `cancelAnimationFrame`.
- Web Audio 미지원 브라우저(`isAudioSupported()` 거짓): 경고와 재생 버튼 비활성(`VerifyScreen`과 같은 `useSyncExternalStore` 패턴, 서버 스냅샷 `true`).

**테스트(jsdom):** 상단 바 각 컨트롤이 `useStudio` 액션을 호출한다(재생→`play`, 정지→`stop`, 슬라이더→`setTempo`, 메트로놈, 되돌리기, 샘플 재시도). 재생 상태별 버튼 표시(`pending`/`playing`/`not-ready` 복귀)와 비활성 규칙. 메시지 줄. Playhead: `requestAnimationFrame` 스텁으로 한 프레임 돌려 `transform`이 기대 px(예: tick 960 → 80px)가 되는지, 곡 끝을 넘는 tick이 클램프되는지, 정지 시 0으로 돌아가는지, 루프가 정지·언마운트에서 취소되는지(스텁 호출 기록). 마디 눈금이 `bars`개이고 4/4의 박 구분선이 마디당 4개.
**변이:** Playhead의 클램프 삭제, `playing` 가드 삭제(→ 정지 중에도 루프가 돔)에서 실패. 

- [ ] **테스트 우선 구현·검증·커밋**

```bash
git add components/studio
git commit -m "feat(editor): 편집 화면의 상단 바·눈금·플레이헤드를 추가한다"
```

---

### Task 8: 코드 레인

**Files:** Create `components/studio/ChordLane.tsx`, `ChordPopover.tsx`, `useBoundaryDrag.ts`, 테스트 `ChordLane.test.tsx`

**Interfaces:**
- Produces: `<ChordLane />`(`useStudio()`로 `song.progression`을 읽고 `edit.*` 호출), `<ChordPopover … />`. 코드 이름 표기 헬퍼 `chordLabel(chord: Chord): string`(`lib/score/chords.ts`에 두고 테스트: 근음 `C C# D D# E F F# G G# A A# B` + 종류 접미 `maj=""`, `min="m"`, `dom7="7"`, `maj7="maj7"`, `min7="m7"` → `Am`, `G7`, `F#maj7`, `Dm7`; 이름 매핑 전체를 표로 단언).
- 구간은 `clipRect(start, length)`로 그린 절대 배치 `button`들. 라벨은 `chordLabel`.

**규칙:**
- 구간 클릭(`editable`일 때만) → 팝오버가 열린다(`role="dialog"`, `aria-label="코드 선택"`): 근음 12개 버튼 + 종류 5개 버튼, 현재 값 강조(`aria-pressed`). 근음·종류 선택은 즉시 `edit.setChord(index, 새 코드)`(근음만 바꾸면 종류 유지, 반대도). 팝오버 하단에 "가운데에서 나누기"(그 구간의 가운데 틱 `seg.start + seg.length / 2`를 `edit.splitSegment`에 넘긴다 — 스냅은 편집 함수가 한다. 구간 길이가 `2 × SNAP_TICKS`(1920) 미만이면 버튼 비활성), "오른쪽과 합치기"(마지막 구간이면 비활성; `edit.mergeSegments(index)`). `Esc` 또는 바깥 클릭으로 닫힌다.
- 경계 드래그: 인접 구간 사이에 폭 8px의 핸들(`role="separator"`, `aria-label="코드 경계 N"`). 포인터 캡처로 드래그. 드래그 중에는 `moveBoundary`를 **미리보기**로 적용한 곡의 구간으로 레인을 그린다(커밋 안 함). 놓으면 한 번 `edit.moveBoundary(index, 틱)` 커밋(변화 없으면 기록 안 됨). `Esc`는 취소하고 원래대로. 틱 계산은 `pointerToTick(clientX, laneLeft, scrollLeft)`.
- `editable`이 거짓이면 모든 상호작용이 비활성(클릭·드래그 무시)이고 버튼에 `aria-disabled`.

**테스트(jsdom + `testing/pointer.ts`):** 구간 렌더(라벨·위치·폭: 4구간 곡의 `style.left/width`), 클릭→팝오버→근음/종류 선택이 `setChord` 호출(인자 단언), 근음만 바꿀 때 종류 유지, 나누기·합치기 버튼이 올바른 인자로 호출되고 경계 조건에서 비활성, `Esc`/바깥 클릭으로 닫힘, 경계 드래그: pointerdown→move→up이 올바른 틱으로 `moveBoundary`를 한 번만 호출(중간 move는 커밋 안 함, 미리보기 폭 변화 확인), `Esc` 취소 시 호출 없음·원래 폭 복귀, 제자리 드롭은 기록 없음, `editable` 거짓에서 모든 상호작용 무시. `chordLabel` 전체 표.
**변이:** `moveBoundary`를 move마다 커밋하게 → "한 번만" 실패; `Esc` 취소 처리 삭제 → 실패; 근음 변경 시 종류를 `maj`로 리셋 → 실패.

- [ ] **테스트 우선 구현·검증·커밋**

```bash
git add components/studio lib/score/chords.ts lib/score/chords.test.ts
git commit -m "feat(editor): 코드 진행 레인과 코드 선택·분할·경계 드래그를 추가한다"
```

---

### Task 9: 트랙 레인 — 클립 추가·이동·길이·삭제·패턴, 단축키

**Files:** Create `components/studio/TrackLane.tsx`, `ClipBlock.tsx`, `PatternPopover.tsx`, `useClipDrag.ts`, `useShortcuts.ts`, 테스트 `TrackLane.test.tsx`, `shortcuts.test.tsx`

**Interfaces:**
- Produces: `<TrackLane trackId />`, `<ClipBlock … />`, `<PatternPopover … />`, `useShortcuts()`(Studio에서 한 번 호출). 패턴 표시 이름 `patternLabel(id: string): string`(`lib/score/patterns.ts`에 매핑 표를 두고 단언: `piano-block`→"블록 코드", `piano-arpeggio-8th`→"8분 아르페지오", `guitar-strum-quarter`→"4분 스트럼", `bass-root-quarter`→"근음 4분", `bass-root-fifth`→"근음·5도", `drum-basic-rock`→"기본 락", `drum-four-on-floor`→"포 온 더 플로어"; 모르는 id는 id 그대로).

**규칙:**
- 트랙 이름 열: 악기 한글 이름(피아노·기타·베이스·드럼).
- **빈 곳 클릭**(클립이 없는 격자 위에서 pointerdown·up이 5px 이내): `pointerToTick`으로 틱을 구해 `edit.addClip(trackId, tick)`. 새 클립은 선택 상태가 된다(`select`). `addClip`이 no-op(공간 없음)이면 아무 일도 없다.
- **클립 본문 드래그:** pointerdown→(5px 넘게 움직이면 드래그 시작; 안 움직이고 놓으면 **클릭**=선택+패턴 팝오버)→move마다 `moveClip(원래 곡, …, 원래 start + deltaTicks)`을 미리보기로 계산해 클립을 그 위치에 그린다(커밋 안 함)→up에서 `edit.moveClip` 한 번 커밋(변화 없으면 기록 안 됨). `Esc` 취소.
- **오른쪽 가장자리 핸들**(폭 8px, `role="separator"`, `aria-label="클립 길이 조절"`) 드래그: 같은 방식으로 `resizeClip`.
- **클립 클릭:** 선택(`aria-selected`/강조) + 패턴 팝오버(`role="dialog"`, `aria-label="패턴 선택"`)에 `patternsFor(instrument)`의 항목(`patternLabel`)과 현재 값 강조, 항목 클릭 → `edit.setClipPattern`. "이 트랙 전체에 적용" 체크 후 선택하면 `edit.setTrackPattern`. `notes` 클립은 팝오버 없이 선택만 된다(이동·길이·삭제는 가능). 선택된 클립 아래 "삭제" 버튼(`edit.removeClip`).
- **키보드(`useShortcuts`):** `Space`(재생/정지 토글: `playing`이면 `stop()`, 아니면 `play()`), `Ctrl+Z`/`Cmd+Z`(`undo()`), `Delete`/`Backspace`(선택한 클립 삭제, `editable`일 때), `Esc`(팝오버 닫기·진행 중 드래그 취소·선택 해제 순서). **입력 요소 가드:** 이벤트 대상이 `input, textarea, select, [contenteditable]`이거나 `[role="dialog"]` 안이면 단축키를 처리하지 않는다. `Space`는 대상이 `button`이면 처리하지 않는다(네이티브 동작에 맡긴다). 처리했으면 `preventDefault`.
- `editable`이 거짓이면 모든 편집 상호작용이 비활성이고 단축키 중 `Space`(정지)·`Esc`만 동작한다.

**테스트(jsdom):** 
1. 빈 곳 클릭 → `addClip` 인자(트랙, 틱)와 선택; 클립 위 클릭은 `addClip`을 부르지 않음; `addClip`이 no-op인 경우 상태 불변.
2. 이동 드래그: 5px 미만은 클릭으로 처리(드래그로 오인하지 않음), 이후 up에서 정확한 틱으로 `moveClip` 한 번, 중간 move는 커밋 없음·미리보기 위치 변화, 이웃을 넘으려 하면 클램프된 위치로 미리보기, `Esc` 취소, 제자리 드롭은 기록 없음.
3. 길이 드래그: `resizeClip` 인자, 최소 길이·다음 클립 클램프 미리보기.
4. 클릭→팝오버→패턴 선택 → `setClipPattern`, "이 트랙 전체에 적용" → `setTrackPattern`; 드럼 트랙은 드럼 패턴만, 피아노는 화음 패턴만 보임; `notes` 클립은 팝오버 없음.
5. 삭제 버튼과 `Delete`/`Backspace`; 선택 없을 때는 아무 일 없음.
6. 단축키 가드: 입력(`<input>`)·`dialog` 안·버튼 위의 `Space`, 팝오버 안 `Delete`는 처리하지 않음; `Ctrl+Z`가 `undo`; `Space`가 재생/정지 토글; `editable` 거짓에서 `Delete`/클릭 편집이 무시됨.
7. 재생 중(`playing`/`pending`)에는 어떤 편집도 커밋되지 않는다(클릭·드래그·삭제 키·되돌리기 모두).
8. **UI 상태가 엔진 상태와 어긋나는 경로:** `pending` 중 `Space`를 다시 눌러도 `play`가 두 번 불리지 않는다(이미 pending이면 무시). 
9. `patternLabel`/표 전체 단언.
**변이:** 5px 임계값을 0으로 → 클릭이 드래그로 처리되어 실패; 이동을 move마다 커밋 → "한 번만" 실패; 단축키 입력 가드 삭제 → 6번 실패; `editable` 가드 삭제 → 7번 실패; 삭제 시 선택 해제 누락 → 5번 후속 단언 실패.

- [ ] **테스트 우선 구현·검증·커밋**

```bash
git add components/studio lib/score/patterns.ts lib/score/patterns.test.ts
git commit -m "feat(editor): 트랙 레인과 클립 추가·이동·길이·패턴·삭제, 단축키를 추가한다"
```

(주의: `patterns.ts`에는 **표시 이름 매핑만** 추가한다. 패턴 데이터와 패턴 스냅샷은 바뀌면 안 된다. 스냅샷 파일이 바뀌면 되돌린다.)

---

### Task 10: 마디 추가·삭제, `/` 교체, 옛 화면 삭제

**Files:**
- Create: `components/studio/BarsControl.tsx`(+ 테스트)
- Modify: `components/studio/Studio.tsx`, `app/page.tsx`
- Delete: `components/verify/`(`VerifyScreen.tsx`, `VerifyScreen.test.tsx`)

**규칙:**
- `BarsControl`: 격자 오른쪽 끝의 `＋마디`(`aria-label="마디 추가"`)와 `－`(`aria-label="마디 삭제"`) 버튼. `edit.setBars(song.bars ± 1)`. `MAX_BARS_UI`(64)에서 추가 비활성, 1마디에서 삭제 비활성. 마디를 줄여 클립이 잘리거나 삭제될 때는 되돌리기로 복구할 수 있다는 점이 보이도록, 줄이는 순간 메시지 줄에 "마디를 줄였습니다 — 되돌리기로 복구할 수 있습니다"를 띄운다(클립이 잘렸을 때만).
- `Studio`: `<StudioProvider>` 안에서 상단 바, 좌측 열(코드·악기 4줄), 격자(눈금 + `ChordLane` + 트랙마다 `TrackLane`)와 `Playhead`, `BarsControl`을 배치한다. 트랙은 `song.tracks` 순서대로 그린다(고정 4개를 가정하지 않는다). 격자 영역은 가로 스크롤.
- `app/page.tsx`는 서버 컴포넌트로 `<StudioProvider><Studio /></StudioProvider>`를 렌더한다(Provider가 `"use client"`). `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`를 먼저 읽고 서버/클라이언트 경계를 확인한다.
- `components/verify/`를 삭제하고 `grep -rn "verify" components app lib state --include=*.ts --include=*.tsx`로 남은 참조가 없는지 확인한다.
- **전체 흐름 통합 테스트(jsdom, 가짜 deps)** `components/studio/Studio.integration.test.tsx`: 데모 곡 로드 → 코드 레인에서 둘째 구간을 F로 바꿈 → `engine.setSong`의 마지막 곡에서 피아노·기타·베이스가 따라온 것을(`expandSong`을 직접 돌려 둘째 구간 시각의 피치가 F 계열) 확인 → 되돌리기로 복귀 → 재생 시작(지연 resolve)→ 재생 중 편집 불가 → 자동 정지 후 편집 가능 → 새로고침 흉내(Provider를 다시 마운트, 같은 가짜 storage)로 복원 → 깨진 저장값으로 마운트하면 데모 + 안내. 
- `pnpm build`가 `/`를 정적 프리렌더로 통과해야 한다.

- [ ] **테스트 우선 구현 → 전체 검증 → 커밋**

Run: `pnpm lint && pnpm check-types && pnpm test && pnpm build`

```bash
git add -A
git commit -m "feat(app): 편집 화면으로 /를 교체하고 마디 추가·삭제를 붙인다"
```

---

### Task 11: 문서

**Files:** `AGENTS.md`, `README.md`, `docs/known-gaps.md`, `docs/superpowers/specs/2026-11-20-core-model-sample-engine-design.md`(§3 모델 서술에 "v3로 대체됨, 2026-11-21 spec 참조" 안내와 바뀐 용어만), `.claude/rules/frontend-architecture.md`(디렉터리 구조 블록과 `state/`·`components/studio/`)

- 모든 서술은 코드로 검증하고 쓴다(AGENTS.md는 매 세션 읽히므로 짧게). 갱신할 사실: 곡 모델이 v3(진행 소유, `pattern` 클립), 새 편집 화면(`/`, 4트랙 고정 UI·코드 진행 레인), `lib/score/edit.ts`가 규칙의 단일 출처, `state/StudioProvider`, 자동 저장 키·동작, 편집은 정지 중에만, 지금 없는 것(음 편집·복사/붙여넣기·다시실행·트랙 추가·파일 열기/저장·링크·내보내기), `components/verify/` 삭제, 새로 검증되지 않은 것(직접 조립해 들어 본 것 — 사용자가 해야 함, 마디 중간 코드 변경의 음악적 자연스러움, 드래그 느낌, 좌표·스크롤 실제 브라우저 동작).
- `docs/known-gaps.md`에 새 이월 항목: UI 한도 64마디와 모델 상한 500의 차이, 자동 저장이 `parseSong`을 거치지만 개수 상한·펼친 이벤트 예산 검사는 여전히 없음(파일/링크 전에 필요), 접근성은 최소(실제 `button`·키보드 단축키까지, 격자 드래그의 키보드 대안 없음), 큰 곡에서의 렌더 비용 미측정.
- 거짓이 된 문장을 모두 찾아 고친다: `AGENTS.md`의 "아직 없는 것"/"지금 있는 것", README의 소리 확인 화면 설명, `known-gaps.md`의 `components/verify` 언급, 규칙 문서의 디렉터리 블록. `grep -rn "VerifyScreen\|components/verify\|소리 확인 화면" AGENTS.md README.md docs/known-gaps.md .claude/rules` 결과가 사실과 맞는지 확인한다.

Run: `pnpm lint && pnpm check-types && pnpm test`

```bash
git add AGENTS.md README.md docs .claude/rules/frontend-architecture.md
git commit -m "docs: 블록 조립 편집 화면과 곡 모델 v3를 문서에 반영한다"
```

---

## Self-Review

**1. Spec 커버리지:** §3 모델 v3(타입·불변식·펼치기·베이크·스키마·영향 범위) → Task 1. §4 편집 함수 → Task 2·3. §5 상태 계층(엔진 동기화, 재생 상태 규칙, 실행취소, 자동 저장, 하이드레이션 안전) → Task 4·6. §6 화면(상단·코드 레인·트랙 레인·드래그·키보드·마디 추가·`/` 교체) → Task 5·7·8·9·10. §7 테스트 전략(순수 함수 + 변이 검증 + 컴포넌트 시나리오 + 엔진-UI 불일치 경로) → 각 Task의 테스트·변이 절. §9 완료 기준 5(문서) → Task 11. §9 기준 4(직접 듣기)는 사람의 몫이라 계획 밖에서 사용자에게 요청한다.

**2. 플레이스홀더 점검:** "TBD"/"나중에"는 없다. Task 2~10의 구현 코드는 의도적으로 구현자가 쓰고, 동작 규칙·수치·테스트 표·변이 검증을 정확히 정했다. 모호하면 멈추라는 지시를 헤더에 넣었다.

**3. 타입 일관성:** `ChordSegment`/`PatternBody`/`progression`(Task 1) ↔ `edit.ts` 함수(Task 2·3) ↔ `StudioApi.edit.*`(Task 6) ↔ 컴포넌트(Task 8·9)가 같은 이름·인자를 쓴다. `snapTick`/`SNAP_TICKS`/`DEFAULT_CLIP_TICKS`/`MAX_BARS_UI`는 Task 2에서 정의하고 Task 3·6·10이 쓴다. `chordAt`/`segmentIndexAt`(Task 1) ↔ 펼치기. `StudioEngine`/`StudioBank`/`StudioStorage`(Task 6) ↔ 가짜 deps. `pointerToTick`/`clipRect`/`deltaTicks`(Task 5) ↔ Task 8·9의 드래그.

**4. 알려진 위험:** Task 1은 이미 병합·리뷰한 모델과 많은 테스트를 고치는 원자적 변경이다(중간에 타입 검사가 깨진다). jsdom은 레이아웃·`PointerEvent`가 없어 드래그 테스트는 `testing/pointer.ts` 헬퍼와 `getBoundingClientRect` 스텁에 기댄다 — 실제 브라우저에서의 드래그 느낌과 스크롤 보정은 자동 테스트로 검증되지 않는다. 마디 중간 코드 변경의 음악적 자연스러움과 소리는 직접 들어야 안다.
