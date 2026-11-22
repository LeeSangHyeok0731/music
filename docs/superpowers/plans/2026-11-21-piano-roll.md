# 피아노롤(하위 프로젝트 2b-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 화음 악기(피아노·기타·베이스)의 패턴 클립을 음 클립으로 굽거나 빈 음 클립을 만들고, 화면 전체 모달 피아노롤에서 음을 추가·선택(Shift·박스)·이동·길이·세기·키보드로 편집한다.

**Architecture:** 음 편집 규칙은 새 순수 모듈 `lib/score/notes.ts`(계획 함수 + 곡만 돌려주는 편집 함수)에 두고, `state/StudioProvider`는 기존 `applyEdit` 경로로 감싸기만 한다. 모달(`components/studio/pianoroll/`)은 UI 지역 상태(열림·선택)를 갖고, 드래그 미리보기는 순수 계획 함수로 원본 스냅샷에서 계산해 놓을 때 한 번 커밋한다. 곡 모델·엔진·샘플 계층은 바뀌지 않는다.

**Tech Stack:** Next.js 16.2.12 App Router, React 19.2, TypeScript strict, zod 4.4.3, vitest 4.1.10(`node`/`jsdom` 프로젝트), `@testing-library/react`, Tailwind 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-21-piano-roll-design.md` (모호하면 spec이 우선한다). 2a 설계·결과: `2026-11-21-arrangement-editor-design.md`, `AGENTS.md`, `docs/known-gaps.md`.

## Global Constraints

- 곡 모델 v3 **변경 없음**. `lib/audio/**`·`public/samples/**`·`lib/score/patterns.ts`·패턴 스냅샷 **변경 없음**. `lib/score/chords.ts`는 **추가만**(새 export).
- 시간은 `PPQ=480` 정수 틱. 격자 단위 `1/4=480`, `1/8=240`, `1/16=120`. 음은 클립 기준 상대 틱.
- 음 편집 규칙(편집 함수가 지킴, `validateSong` 검사 아님): 같은 음높이끼리 겹치지 않음(맞닿음 허용), 같은 `(start,pitch)` 중복 없음, 음은 클립 안(`0≤start`, `start+length≤clip.length`), 세기 `[0.05,1]`(기본 `0.8`).
- 모든 편집 함수는 순수하고 새 `Song`을 돌려주며 **바뀌는 게 없으면 같은 참조**, 결과는 항상 `validateSong===[]`, 입력은 변형하지 않는다. 없는 트랙·클립 id, `notes`가 아닌 클립, 드럼 트랙은 `Error`.
- 편집은 정지 중에만(`editable`, 재생 중·재생 대기 중 차단). 규칙이 든 로직은 컴포넌트가 아니라 `lib/`의 순수 함수에 둔다.
- **포인터 제스처 규칙(2a에서 얻은 교훈, 어기면 안 됨):** 캡처는 **`pointerdown`에서** 잡는다(마우스는 암묵 캡처가 없다. 임계값 뒤에 잡지 않는다), 캡처가 던지면 제스처를 만들지 않는다, 마우스는 `buttons` 가드, 5px 임계로 클릭/드래그를 **놓을 때** 가른다, 미리보기는 순수 계획 함수로 **원본 스냅샷**에서 계산하고 커밋은 놓을 때 한 번(마지막 미리보기 값), 취소 경로(pointercancel·lostpointercapture without up·Esc·`editable` false·언마운트·대상 소멸·`isConnected` false), `activeRef`는 캡처를 풀기 **전에** null, 드래그 뒤 브라우저 `click`은 `detail>0`으로 삼킨다(키보드 클릭은 `detail 0`이라 통과), 모든 틱·좌표는 `Number.isFinite` 가드, `event.button!==0` 무시. `components/studio/gestures.ts`의 `beginGesture()`/`hasActiveGesture()`로 진행 중 제스처를 센다(되돌리기 차단용).
- 팝오버/모달 같은 오버레이는 `document.body`로 포털하고 정리 경로를 보장한다(모듈 수준 카운터는 마운트 effect에서 올리고 정리에서 내리며, 테스트 `afterEach`가 0임을 단언한다).
- Esc는 한 번에 한 겹: 진행 중 드래그 → 선택 해제 → 모달 닫기. 드래그 훅은 `document` **캡처 단계** + `preventDefault`, 상위 처리는 `defaultPrevented`면 건너뛴다.
- UI 규칙: `.claude/rules/ui-conventions.md`(팔레트, 실제 `<button>`, `font-mono tabular-nums`, 설명용 문구 임의 추가 금지, `cn()`·컴포넌트 라이브러리 금지, 행 구분선은 inset `boxShadow`, 스크롤 영역 `.timeline-scroll`). 브라우저: Chrome·Firefox 데스크톱(Safari 대상 아님).
- 패키지 매니저 pnpm. 커밋 메시지 `<type>(<scope>): <한국어>`, 푸시하지 않는다. git은 이 머신에서 `git -c safe.directory=C:/Users/USER/Desktop/music …`. 프레임워크 레벨 코드(`app/`) 전에 `node_modules/next/dist/docs/`를 읽는다(이 계획은 `app/`을 건드리지 않는다).
- 테스트: jsdom은 레이아웃이 없다(좌표는 `getBoundingClientRect` 스텁). 컴포넌트 테스트는 **실제 `StudioProvider`+`createFakeDeps`**로 곡 상태를 단언한다(mock 호출만 단언하지 않는다). 포인터 테스트는 `components/studio/testing/pointer.ts`(`firePointer`, `stubLaneRect`, `installPointerCaptureStubs`; 캡처된 포인터 이벤트는 캡처 요소로 재라우팅이 기본)와 `testing/harness.tsx`(`renderWithStudio`)를 쓴다. 파일 내용을 정규식 파싱하는 테스트는 `\r?\n`. 패턴 스냅샷 파일이 줄바꿈만 바뀌어 수정으로 보이면 **커밋하지 않는다**.
- 모든 Task는 끝에서 `pnpm lint`, `pnpm check-types`, `pnpm test`(표시된 Task는 `pnpm build`도)가 통과해야 한다.

## 작업 순서

```text
1  순수 규칙 lib/score/notes.ts            ← 위험(상위 모델)
2  Provider 연결 + 모달 열림 표시 + 전역 단축키 범위
3  피아노롤 좌표·순수 도우미 + 모달 뼈대(진입점·포커스·건반·격자·코드 띠·플레이헤드)
4  음 상호작용(추가·선택·Shift·박스·이동·길이)   ← 위험(상위 모델)
5  세기 레인 + 키보드 이동
6  통합 테스트 + 문서 (이후 통제자 브라우저 점검)
```

---

### Task 1: 순수 규칙 `lib/score/notes.ts`

**Files:**
- Create: `lib/score/notes.ts`, `lib/score/notes.test.ts`
- Modify: `lib/score/testing/builders.ts`(필요하면 음 클립을 가진 곡을 만드는 도우미 추가만)

**Interfaces (Produces):**
```ts
export const GRID_UNITS = { "1/4": 480, "1/8": 240, "1/16": 120 } as const;
export type GridUnit = keyof typeof GRID_UNITS;
export const DEFAULT_VELOCITY = 0.8;
export const MIN_VELOCITY = 0.05;
export type NoteKey = string;                     // `${start}:${pitch}`
export function noteKey(n: Pick<Note, "start" | "pitch">): NoteKey;
export type ChordalInstrument = Exclude<InstrumentId, "drums">;
export const PITCH_RANGE: Record<ChordalInstrument, { lo: number; hi: number }>;
//   piano {36,96}, guitar {40,84}, bass {28,60}
export function displayRange(instrument: ChordalInstrument, notes: readonly Note[]): { lo: number; hi: number };
//   = [min(표.lo, 가장 낮은 음-2), max(표.hi, 가장 높은 음+2)], 0..127로 클램프. 음이 없으면 표 그대로.
export type NotePlan = { song: Song; keys: NoteKey[] };   // keys = 결과 선택 키(입력과 같으면 바뀌지 않았다)
export type NoteBox = { startTick: number; endTick: number; loPitch: number; hiPitch: number };

export function bakeClipToNotes(song: Song, trackId: string, clipId: string): Song;
export function emptyNotesClip(song: Song, trackId: string, clipId: string): Song;
export function planAddNote(song, trackId, clipId, spec: { start: number; pitch: number; length?: number; velocity?: number }, unit: GridUnit): NotePlan;
export function planMoveNotes(song, trackId, clipId, keys: readonly NoteKey[], dTicks: number, dPitch: number, unit: GridUnit): NotePlan;
export function planResizeNotes(song, trackId, clipId, keys: readonly NoteKey[], dLength: number, unit: GridUnit): NotePlan;
export function planRemoveNotes(song, trackId, clipId, keys: readonly NoteKey[]): NotePlan;
export function planSetVelocities(song, trackId, clipId, keys: readonly NoteKey[], velocity: number): NotePlan;
export function selectNotesInBox(song, trackId, clipId, box: NoteBox): NoteKey[];
// 곡만 돌려주는 얇은 편집 함수: addNote/moveNotes/resizeNotes/removeNotes/setVelocities = plan*(…).song
```

**규칙 (모든 plan 함수 공통):** 바뀌는 게 없으면 `{ song(같은 참조), keys: 입력 키(걸러서) }`. 입력 키는 클립에 실제 있는 음으로 먼저 거른다(낡은 키·중복 무시; `(start,pitch)`가 같은 음이 둘이면 첫 음). 없는 트랙·클립은 `Error`, `notes`가 아닌 클립은 `Error("notes 클립이 아닙니다")`, 드럼 트랙은 `Error("화음 악기의 음 클립만 편집합니다")`. NaN·±Infinity 인자: 위치/길이/세기 NaN은 no-op, 이동의 ±Infinity는 범위 밖이라 거부, 길이의 ±Infinity는 클램프 범위로 수렴. 결과 `notes`는 `start` 오름차순(같은 start는 입력 배열 순서 유지, 안정 정렬). 비교는 구간 `[start, start+length)`(맞닿음은 겹침이 아님).

- `bakeClipToNotes`: `pattern` 클립을 `bakeClipInSong`(expand.ts)으로 `notes`로 바꾼다. `notes` 클립이면 no-op. **굽기 전후 `expandSong` 결과가 같아야 한다**(동치). 드럼 포함 모든 악기에서 동작(UI는 이번 단계에서 드럼에 노출하지 않음).
- `emptyNotesClip`: `pattern` 클립을 같은 `id·start·length`의 `{type:"notes", notes:[]}`로. `notes` 클립이면 no-op.
- `planAddNote`: `start' = floor(start/unit)*unit`(칸의 시작으로 내림), `length' = length 생략 시 unit, 주어지면 floor(length/unit)*unit(최소 unit)`, `pitch`는 정수이고 `displayRange` 안, `start' ∈ [0, clip.length)`; `length' = min(length', clip.length − start')`; 같은 음높이의 기존 음이 `start'`를 품으면(`n.start ≤ start' < n.start+n.length`) no-op; `start'` 뒤에 같은 음높이 음이 있으면 `length' = min(length', 그 start − start')`. 세기 = 주어지면 `[0.05,1]` 클램프, 생략 시 0.8. 삽입 위치: `start` 오름차순에서 같은 start들 **뒤**. `keys = [새 음 키]`.
- `planMoveNotes`: `dTicks' = Math.round(dTicks/unit)*unit`, `dPitch` 정수로 반올림. `dTicks'==0 && dPitch==0`이면 no-op. 선택된 음을 한 덩어리로 이동한 결과가 (a) 각 음 `start≥0 && start+length≤clip.length`, (b) 각 음 `pitch ∈ displayRange(원래 클립의 음들 기준)`, (c) **이동한 음이 같은 음높이의 다른 음(이동한 것끼리 포함, 선택 안 된 것 포함)과 겹치지 않음** — 하나라도 어기면 **전체 거부**(no-op, `keys`=입력 키). 이동하지 않은 음끼리의 기존 겹침(손으로 고친 곡)은 검사하지 않는다. 성공하면 `keys`=이동한 음들의 새 키.
- `planResizeNotes`: `d' = Math.round(dLength/unit)*unit`(±Infinity는 그대로 두고 아래 클램프). 음마다 `maxLen_i = min(clip.length − start_i, (같은 음높이이고 start가 더 큰 음 중 가장 작은 start) − start_i)`, `minLen_i = min(unit, maxLen_i)`. 전체 `d_eff = clamp(d', max_i(minLen_i − length_i), min_i(maxLen_i − length_i))`; 상한<하한이면 no-op. `d_eff==0`이면 no-op. 선택 음 모두 `length += d_eff`. `keys`=입력 키(시작·음높이 불변).
- `planRemoveNotes`: 키에 해당하는 음 삭제, 지울 게 없으면 no-op, `keys=[]`.
- `planSetVelocities`: 선택 음 세기를 `[0.05,1]`로 클램프한 같은 값으로. 모두 이미 그 값이면 no-op. `keys`=입력 키.
- `selectNotesInBox`: `n.start < endTick && n.start+n.length > startTick && loPitch ≤ n.pitch ≤ hiPitch`인 음의 키(음 배열 순서). 박스 값이 NaN이면 `[]`.

**테스트 표** (기본 곡: `songWithNotes({ instrument:"piano", bars:4, notes })`, 클립 `clip-1` 길이 7680, 트랙 `track-1`. 기본 음 `A={0,480,60}`, `B={480,480,64}`, `C={480,480,67}`, `D={960,960,60}`(모두 세기 0.8). 아래 `unit`은 `"1/4"`=480 별도 표기 없으면):

| 함수 | 입력 | 기대 |
| --- | --- | --- |
| planAddNote | start 1000, pitch 62 | 960 칸으로 내림. 새 음 `{960,480,62,0.8}`이 start 960 그룹 **뒤**(D 뒤)에 삽입, `keys=["960:62"]` |
| planAddNote | start 1000, pitch 60 | 같은 음높이 D(960..1920)가 960을 품음 → no-op(같은 참조), keys=[] |
| planAddNote | start 0, pitch 60 | A가 품음 → no-op |
| planAddNote | start 480, pitch 60 | A는 `0≤480<480` 거짓이라 품지 않음, 다음 같은 음높이 D(960) → 길이 `min(480, 480)=480` → `{480,480,60}` 추가, `keys=["480:60"]` |
| planAddNote | start 600, pitch 60, length 960, unit `"1/16"` | start' 600, length' 960, 다음 같은 음높이 D(960) → `min(960, 360)=360` → `{600,360,60}` |
| planAddNote | start 7500, pitch 62 | start' 7200, length 480, 7200+480=7680 ≤ 클립 길이 → 추가 |
| planAddNote | start 7200, pitch 62, length 960 | 클립 끝으로 클램프 → length 480 |
| planAddNote | start 7680 / −10 / NaN | start' ≥ 클립 길이 / start' −480<0 / NaN → 전부 no-op |
| planAddNote | pitch 20 / 97 / 60.5 / NaN | 표시 범위(piano 36..96, 음 범위 58..69와 합집합이라 그대로) 밖·비정수 → no-op. pitch 96은 추가됨 |
| planAddNote | velocity 1.5 / 0 / 생략 | 1 / 0.05 / 0.8 |
| planAddNote | 없는 트랙, 없는 클립, 패턴 클립, 드럼 트랙 | 각각 `Error` |
| planMoveNotes | keys `["480:64","480:67"]`, dTicks 480, dPitch 0 | B→`{960,64}`, C→`{960,67}`. 결과 notes 순서 `[A, B', C', D]`(이미 start 오름차순), `keys=["960:64","960:67"]` |
| planMoveNotes | 같은 키, dTicks 500 | `round(500/480)=1` → 위와 동일 |
| planMoveNotes | 같은 키, dTicks 200 | `round(0.416)=0`, dPitch 0 → no-op |
| planMoveNotes | 같은 키, dTicks 0, dPitch +2 | B→66, C→69, `keys=["480:66","480:69"]` |
| planMoveNotes | `["0:60"]`(A), dTicks 960 | A→`{960,480,60}`이 D(960..1920)와 겹침 → **전체 거부**, no-op, keys=입력 |
| planMoveNotes | `["960:60"]`(D), dTicks −480 | D→`{480,960,60}`(480..1440), A(0..480)와 맞닿음 → 허용. notes 순서 `[A,B,C,D']` |
| planMoveNotes | D, dTicks −1920 / +6720 / +5760 | start −960 거부 / 7680+960>7680 거부 / start 6720 끝 7680 허용 |
| planMoveNotes | A, dPitch +40 / −24 / −25 | 100>96 거부 / 36 허용 / 35<36 거부 |
| planMoveNotes | `["999:1"]` / 존재+없음 섞음 | no-op(같은 참조) / 있는 것만 이동 |
| planMoveNotes | 손으로 고친 곡에 같은 음높이 70이 겹친 두 음(선택 안 함)이 있고 B를 +2 | 이동한 B만 검사 → 허용 |
| planResizeNotes | `["0:60"]`(A, 길이 480), dLength +480 | `maxLen_A=min(7680, 960−0)=960`, 새 길이 960(D와 맞닿음) |
| planResizeNotes | A, dLength +960 | 상한 `960−480=480`로 클램프 → 길이 960 |
| planResizeNotes | A, dLength −480 | `minLen_A=min(480,960)=480`, 하한 `480−480=0` → d_eff 0 → no-op |
| planResizeNotes | `["960:60"]`(D 길이 960), dLength −480 / −960 | 길이 480 / 하한 `480−960=−480`로 클램프 → 길이 480 |
| planResizeNotes | `[A, D]`, dLength +480 | A 상한 +480, D 상한 `(6720−960)=5760` → `d_eff=480` → A 960, D 1440 |
| planResizeNotes | `[A, D]`, dLength +960 | 상한 `min(480,5760)=480` → 같은 결과(A 960, D 1440) |
| planResizeNotes | D, dLength +99999 / 200 | 클립 끝(길이 6720) / `round(200/480)=0` → no-op |
| planRemoveNotes | `["480:64"]` / 없는 키 / 전체 | B 삭제 keys=[] / no-op / `notes:[]`(클립은 남음, validateSong 통과) |
| planSetVelocities | `["0:60"]`, 0.5 / 0.5 한 번 더 / 2 / 0 / NaN | A 0.5 / no-op / 1 / 0.05 / no-op |
| selectNotesInBox | `{400,500,60,64}` | A(0..480, 60): `0<500 && 480>400` ✓, B(480..960, 64) ✓, C(67) ✗(음높이 초과), D(960..) ✗ → `["0:60","480:64"]` |
| selectNotesInBox | `{480,480,0,127}` | 구간 폭 0 → A `480>480` 거짓, B `480<480` 거짓 → `[]` |
| bakeClipToNotes | 피아노 `piano-block` 클립(0~1920, C 진행) | `notes` 본문, pitch 집합 `{60,64,67}`; `expandSong(before)` `toEqual` `expandSong(after)`; 마디 중간 코드 변경 진행(C 0~960 / G 960~)이 있는 `piano-arpeggio-8th` 곡에서도 동치 |
| bakeClipToNotes | `notes` 클립 | no-op(같은 참조) |
| emptyNotesClip | 패턴 클립 | 같은 id·start·length, `notes:[]`, 다른 클립·트랙은 같은 참조 |
| displayRange | 음 pitch 30~100인 piano / 음 없음 / bass `{28,60}`에 pitch 20 음 | `{28,102}` / `{36,96}` / `{18,60}`(0..127로 클램프) |
| 속성 | 시드 20개 × 연산 300번(모든 plan 함수 + bake/empty를 유효·무효 인자 혼합, 빈 음 클립 곡과 패턴을 구운 곡에서 시작) | 매번 `validateSong===[]`, 클립 notes 정렬·클립 안·**같은 음높이 겹침 없음(이동·추가·길이로 생긴 것)**·세기 `[0.05,1]`·입력 불변·같은 참조면 내용 동일·허용된 `Error`만 던짐. 손으로 고친(정렬 안 된 길이/겹침 있는) 곡 한 패스: `validateSong`과 입력 불변만 단언 |

**변이 검증(각각 이름 있는 테스트가 실패해야 하고 되돌린다):** 겹침 검사 제거 → 이동·추가 겹침 행 실패; 덩어리 이동을 음별 독립 클램프로 → 화음 모양 행 실패; `Math.floor`(추가)를 `Math.round`로 → start 1000 행 실패; `Math.round`(이동)를 `Math.floor`로 → dTicks 500 행 실패; 길이 클램프 하한 제거 → A −480 행 실패; 낡은 키 걸러내기 제거 → `["999:1"]` 행 실패; no-op이 새 객체를 돌려줌 → `toBe` 행 실패; bake 동치 깨기(코드 조회 시각을 클립 시작으로) → 동치 행 실패.

- [ ] **Step 1~N: 테스트 먼저 → RED → 구현 → GREEN → 변이 검증(되돌림, `git diff` 확인) → `pnpm lint && pnpm check-types && pnpm test`**
- [ ] **커밋**

```bash
git add lib/score/notes.ts lib/score/notes.test.ts lib/score/testing/builders.ts
git commit -m "feat(score): 음 클립 편집 규칙과 굽기를 순수 함수로 추가한다"
```

---

### Task 2: Provider 연결·모달 열림 표시·전역 단축키 범위

**Files:**
- Modify: `state/types.ts`, `state/StudioProvider.tsx`, `state/StudioProvider.test.tsx`, `components/studio/useShortcuts.ts`, `components/studio/shortcuts.test.tsx`
- Create: `components/studio/modal.ts`, `components/studio/modal.test.tsx`

**Interfaces:**
- Produces (`state/types.ts`): `StudioNoteEdits`(첫 인자 `song`을 뺀 `addNote/moveNotes/resizeNotes/removeNotes/setVelocities`, `lib/score/notes.ts`의 곡만 돌려주는 함수에서 파생), `StudioEdits`에 `bakeClipToNotes(trackId, clipId)`, `emptyNotesClip(trackId, clipId)`, `notes: StudioNoteEdits` 추가.
- Produces (`modal.ts`): `useModalOpenCount(open: boolean)`(마운트 effect에서 증감, 정리 보장), `hasOpenModal(): boolean`.
- Consumes: Task 1의 함수들.

**규칙:**
- 모든 새 편집은 기존 `applyEdit`로 감싼다(`editable`일 때만, 같은 참조면 기록·저장 안 함, 던지면 `EDIT_FAILED` 메시지 + 곡 그대로).
- `bakeClipToNotes`가 곡을 바꾸면(같은 참조가 아니면) 메시지 줄에 정확히 **"음으로 바꿨습니다 — 코드 진행을 바꿔도 이 클립은 따라가지 않습니다. 되돌리기로 복구할 수 있습니다"**. `emptyNotesClip`은 안내 없음.
- `useShortcuts`: `hasOpenModal()`이면 `Delete`/`Backspace`(클립 삭제)와 Esc 선택 해제를 처리하지 않는다(모달이 처리). Space·Ctrl+Z는 그대로(드래그 중 undo 차단 유지).
- 모달 카운터: 열린 동안 +1, 닫히거나 언마운트되면 −1(멱등). StrictMode에서 균형.

**테스트:** 각 새 편집이 실제 Provider로 곡을 바꾸고 `canUndo`가 참, undo가 되돌림, 같은 참조 편집은 기록·저장 안 함, `!editable`(pending/playing)에서 무시, 던지는 입력(없는 클립)은 메시지 + 곡 그대로; 굽기 안내가 정확한 문구로 뜨고 `emptyNotesClip`·no-op 굽기에서는 안 뜸; undo 뒤 안내 유지 여부는 기존 마디 축소 안내와 같은 동작(문서화); `useShortcuts`가 모달 열림 동안 Delete/Esc선택해제를 무시하고 닫히면 다시 동작(카운터 `afterEach` 0 단언); `modal.test.tsx`: 카운터 증감·언마운트·StrictMode·멱등.
**변이:** 굽기 안내 제거 → 실패; `editable` 가드 제거 → 실패; 모달 카운터 정리 누락 → 누수 단언 실패; 단축키의 모달 가드 제거 → 실패.

- [ ] **테스트 우선 구현 → 검증(`pnpm lint && pnpm check-types && pnpm test && pnpm build`) → 커밋**

```bash
git add state components/studio/modal.ts components/studio/modal.test.tsx components/studio/useShortcuts.ts components/studio/shortcuts.test.tsx
git commit -m "feat(state): 음 편집 액션과 굽기 안내, 모달 열림 표시를 추가한다"
```

---

### Task 3: 피아노롤 순수 도우미와 모달 뼈대

**Files:**
- Create: `components/studio/pianoroll/geometry.ts`(+test), `PianoRoll.tsx`, `RollHeader.tsx`, `KeyColumn.tsx`, `NoteGrid.tsx`(격자·행 색칠·코드 띠·노트 자리), `VelocityLane.tsx`(자리만, Task 5가 채움), `useFocusTrap.ts`(+test), `PianoRoll.test.tsx`
- Modify: `lib/score/chords.ts`(**추가만**: `chordPitchClasses(chord): number[]`)+`chords.test.ts`, `components/studio/Playhead.tsx`(좌표 변환 주입), `components/studio/PatternPopover.tsx`(두 버튼), `components/studio/ClipBlock.tsx`(음 클립 편집 버튼·더블클릭·Enter), `components/studio/TrackLane.tsx`, `components/studio/Studio.tsx`, 해당 기존 테스트

**Interfaces:**
- Produces (`pianoroll/geometry.ts`, 순수): `ROLL_PX_PER_BEAT=96`(1틱=0.2px), `ROW_HEIGHT=20`, `KEY_COLUMN_WIDTH=56`, `rollTickToX(tick)=tick*ROLL_PX_PER_BEAT/PPQ`(곱셈을 먼저 해서 부동소수 오차를 피한다), `rollXToTick(x)=Math.round(x*PPQ/ROLL_PX_PER_BEAT)`(`-0` 정리), `pitchToY(pitch, hi)=(hi−pitch)*ROW_HEIGHT`, `yToPitch(y, hi)=hi−floor(y/ROW_HEIGHT)`, `noteName(pitch)`(60→"C4", `ROOT_NAMES` 샤프 표기, 옥타브 `floor(p/12)−1`), `isBlackKey(pitch)`, `noteRect(note, hi)`, `chordSegmentsInClip(song, clip): Array<{start,length,chord}>`(클립 기준 상대 틱으로 자른 구간), `chordToneRows(chord)`(= `chordPitchClasses`), 격자선 CSS 배경 문자열 생성 도우미 `gridBackground(unit, ticksPerBeat, beatsPerBar)`.
- Produces (`Playhead`): `toX?: (tick:number)=>number`(기본 `tickToX`)와 `offsetTick?`(클립 시작) 주입 — 기본 동작·기존 테스트 불변.
- Produces (`PianoRoll`): `<PianoRoll trackId clipId onClose />`(포털 `document.body`, `role="dialog" aria-modal="true" aria-label="피아노롤"`, 화면 전체).
- Produces (`Studio`): 지역 상태 `roll: {trackId, clipId} | null`, `openRoll(trackId, clipId)`(안정된 콜백)를 `TrackLane`으로 내려준다(memo 유지).
- Consumes: Task 1·2의 함수·훅.

**규칙(동작 정확히):**
- **진입:** 패턴 클립 팝오버(드럼 트랙에서는 숨김)에 버튼 두 개 **"음으로 바꾸기"**(`edit.bakeClipToNotes` 후 모달 열기)와 **"빈 음 클립으로"**(`edit.emptyNotesClip` 후 모달 열기); 팝오버는 선택 뒤 닫는다. 음 클립 타일(드럼 아님)에는 선택됐을 때 **편집 버튼**(`aria-label="음 편집"`), 본문 버튼 **더블클릭/Enter**로도 모달이 열린다(Enter는 키보드 click `detail 0`; 마우스 클릭 한 번은 지금처럼 선택만 — 기존 클릭 규칙 유지). 빈 트랙 칸 **Shift+클릭**(화음 악기)은 `addClip` 후 `emptyNotesClip`으로 빈 음 클립을 만들고 선택한다(모달은 열지 않는다).
- **모달:** `← 돌아가기` 버튼과 Esc로 닫힌다. 열리면 `useModalOpenCount(true)`, 포커스 가두기(Tab 순환, 첫 포커스는 닫기 버튼 또는 격자), 닫으면 **연 요소로 포커스 복귀**(편집 버튼 또는 클립 본문). 클립이 사라지거나(undo/삭제) 패턴 클립으로 돌아가면 모달이 닫힌다(파생 상태). 재생 중에도 열려 있고 편집은 막힌다(헤더에 기존 알림 문구).
- **헤더:** 제목 `"<악기 한글 이름> · N~M마디"`(클립 시작·끝 마디), 격자 단위 라디오 3개(`1/4`·`1/8`·`1/16`, 기본 `1/8`, 지역 상태), 재생/정지 버튼·위치(`font-mono tabular-nums`; 상단 바와 같은 `useStudio` 액션), 되돌리기 버튼(`aria-label="되돌리기"`), 메시지 줄(공용 컴포넌트를 재사용/추출).
- **본문:** 왼쪽 `KeyColumn`(음 이름 행, 검은 건반 어둡게, 높이 `ROW_HEIGHT`), 오른쪽 `NoteGrid`(가로 = 클립 길이 × 0.2px, 세로 = 표시 범위 행 수 × `ROW_HEIGHT`). 격자선(마디·박·선택한 단위)은 **CSS 배경**(DOM 요소 없음), 현재 클립 구간의 코드 구성음 행에 옅은 색(코드가 바뀌는 지점마다 다른 색칠은 **코드 띠 구간 단위**로 `NoteGrid` 안 행 배경 레이어에 그림), 격자 위 **코드 띠**(읽기 전용, `chordLabel`). 스크롤은 격자 영역이 소유(가로·세로, `.timeline-scroll`), 처음 열 때 음이 있으면 음 범위 중앙, 없으면 C4 근처로 세로 스크롤. 음은 아직 **읽기 전용 `NoteBlock`**(Task 4가 상호작용을 붙임): 실제 `<button>`, `aria-pressed`(선택), 이름 `"C4, 3마디 1박, 길이 1/8"` 형식(마디·박은 클립 시작 기준이 아니라 **곡 기준** 위치), 색은 악기 색 타일 클래스(`instruments.ts`).
- **플레이헤드:** `Playhead`에 `toX`/`offsetTick`을 주입해 클립 구간 안에서만 움직이고(구간 밖 틱은 0 또는 끝으로 클램프, 비유한 값 0), 정지하면 0.
- **전역 키:** Space·Ctrl+Z는 모달에서도 동작(전역). Esc는 모달 안에서 `document` **캡처 리스너**가 처리한다: `e.defaultPrevented`이거나 `hasActiveGesture()`이면 아무것도 안 함(드래그 훅이 먼저 취소하게), 선택이 있으면 선택 해제(`preventDefault`), 아니면 모달 닫기(`preventDefault`). (선택은 Task 4에서 생기므로 이 Task에서는 닫기만 구현하고 테스트한다.)
- `chordPitchClasses(chord)`: 코드 구성음의 **피치 클래스 목록**(0..11, 오름차순, 중복 없음). `chords.ts`의 기존 간격 표를 그대로 써서 만든다(새 표를 만들지 않는다).

**테스트(jsdom):** `geometry.test.ts` 전체 표(손계산: `rollTickToX(480)=96`, `rollXToTick(96)=480`, `-0` 정리·NaN/Infinity 처리, `noteName`: 60→C4, 61→C#4, 71→B4, 72→C5, 36→C2, 28→E1; `isBlackKey`: 61·63·66·68·70 true, 60 false; `pitchToY(96,96)=0`, `pitchToY(60,96)=720`, `yToPitch(0,96)=96`, `yToPitch(19,96)=96`, `yToPitch(20,96)=95`; `chordSegmentsInClip`: 클립 960~2880, 진행 C 0~1920/Am 1920~3840이면 `[{start:0,length:960,C},{start:960,length:960,Am}]`; `chordPitchClasses` C maj = `[0,4,7]`, Am = `[0,4,9]`, G7 = `[2,5,7,11]`, Cmaj7 = `[0,4,7,11]`, Dm7 = `[0,2,5,9]`); `PianoRoll`: 열림/닫힘(`← 돌아가기`, Esc), 포커스 가두기·복귀, 카운터 증감, 클립 소멸 시 닫힘(undo로), 재생 중 열려 있고 편집 알림, 헤더(제목·격자 단위 상태·재생/정지가 실제 Provider를 움직임), 코드 띠 라벨, 행 색칠이 코드 구성음에만 붙음(`data-chord-tone`), 음 `NoteBlock`의 이름·위치(곡 기준 마디·박), 진입점 4종(팝오버 두 버튼, 편집 버튼, 더블클릭/Enter, Shift+클릭 빈 음 클립)과 드럼 트랙에서 팝오버 두 버튼 숨김, 팝오버 → 굽기 후 모달이 열리고 굽기 안내가 보임, 플레이헤드 `toX`/`offsetTick`(클립 구간 안 px, 구간 밖 클램프, 정지 시 0)와 기존 `Playhead` 테스트 불변.
**변이:** 포커스 복귀 제거 → 실패; 카운터 정리 누락 → 실패; 팝오버 드럼 가드 제거 → 실패; 행 색칠이 모든 행에 붙음 → 실패; `pitchToY` 부호 뒤집기 → 실패.

- [ ] **테스트 우선 구현 → 검증(`pnpm lint && pnpm check-types && pnpm test && pnpm build`) → 커밋**

```bash
git add components/studio lib/score/chords.ts lib/score/chords.test.ts
git commit -m "feat(editor): 피아노롤 모달 뼈대와 진입점을 추가한다"
```

---

### Task 4: 음 상호작용 (추가·선택·Shift·박스·이동·길이)

**Files:**
- Create: `components/studio/pianoroll/useNoteGestures.ts`(+test; 순수 도우미 export·단위 테스트), `NoteBlock.tsx`(Task 3의 읽기 전용을 상호작용 버전으로 교체/확장), `SelectionBox.tsx`
- Modify: `PianoRoll.tsx`, `NoteGrid.tsx`, `PianoRoll.test.tsx` 및 신규 `NoteGestures.test.tsx`

**Interfaces:**
- Produces(순수, `useNoteGestures.ts`에서 export): `cellFromPointer(clientX, clientY, gridRect, scroll, hi, unit)`(→ `{ tick, pitch } | null`, 비유한 값·범위 밖이면 null), `boxFromPoints(a, b, hi, unit)`(→ `NoteBox`), `movedPastThreshold`(2a의 것을 재사용하거나 같은 규칙), `previewDelta(...)`.
- Produces(훅): 포인터 제스처 상태 기계(아래 규칙)와 `selection: NoteKey[]`·`setSelection`(모달 지역 상태 `PianoRoll`이 소유).
- Consumes: Task 1 `plan*`/`selectNotesInBox`, Task 2 `edit.notes.*`, Task 3 geometry/레이아웃, 2a `gestures.ts`·`popover.ts`·`testing/*`.

**규칙(동작 정확히):**
- **선택 상태:** `selection`(키 목록)은 `PianoRoll` 지역 상태. 곡이 바뀌어 사라진 키는 렌더 때 파생으로 걸러낸다(되돌리기 후 낡은 선택 방지). 모달이 닫히면 비운다.
- **빈 곳 클릭 = 음 추가:** 격자 배경(대상이 격자 자신)에서 pointerdown·up이 5px 안, 주 버튼, 유한 좌표, `editable` → `cellFromPointer`로 `{tick,pitch}`를 구하고 로컬 순수 `planAddNote`로 "추가되는지·새 키"를 예측(no-op이면 아무것도 안 함) → `edit.notes.addNote(...)` 후 선택을 새 키로. 이미 열린 오버레이/포털이 있으면 이 누름은 그것을 닫는 것이라 추가하지 않는다(`hasOpenPopover()`).
- **음 클릭:** 선택(Shift 없으면 그 음만, Shift면 토글). 드래그를 시작하는 5px 이동이면 **그 음이 선택에 없으면 먼저 단독 선택**(Shift 없이) 후 이동.
- **음 본문 드래그 = 이동:** `pointerdown`에서 캡처(실패면 제스처 없음), `beginGesture()`. 이동 중 미리보기 = 순수 `planMoveNotes(원본 곡, …, keys, dTicks, dPitch, unit)`(`dTicks`=`rollXToTick(Δx)`, `dPitch`=`−round(Δy/ROW_HEIGHT)`). **거부되면(같은 참조) 마지막 유효 미리보기를 유지**한다. 놓을 때 마지막 유효 미리보기가 원본과 다르면 `edit.notes.moveNotes(...)`를 **한 번**(그 미리보기를 만든 `dTicks/dPitch` 그대로), 선택을 결과 키로 갱신. 취소 경로 전부(Esc·pointercancel·lostpointercapture w/o up·편집 불가·언마운트·대상 소멸/`isConnected` false)는 미리보기만 버리고 커밋 없음. 마우스 `buttons` 가드. 드래그 뒤 `click` 삼킴(`detail>0`).
- **오른쪽 가장자리 8px 핸들 드래그 = 길이:** 같은 메커니즘, `planResizeNotes`, `edit.notes.resizeNotes` 한 번. 선택된 음 전체가 같은 변화량(덩어리 클램프). 핸들은 `role="separator" aria-label="음 길이 조절"`(포인터 전용).
- **빈 곳 5px 이상 드래그 = 박스 선택:** `pointerdown`에서 캡처, 박스는 미리보기(`SelectionBox`), 놓을 때 `selectNotesInBox`로 선택 확정(Shift면 기존 선택에 합침). Esc·cancel이면 박스만 버림. 박스가 비면 Shift 없을 때 선택을 비운다.
- **편집 불가(`!editable`):** 모든 조작 무시, 음·핸들 `aria-disabled="true"`, 진행 중 드래그 취소(커밋 없음). 비유한 좌표/`NaN` 무시, `event.button!==0` 무시, 우클릭 무시.
- **Esc(모달 캡처 리스너, Task 3 확장):** 진행 중 드래그가 있으면(`hasActiveGesture()`) 건드리지 않고(드래그 훅이 취소), 없고 선택이 있으면 선택 해제, 선택이 없으면 모달 닫기. 한 번의 Esc는 한 겹.
- **미리보기 렌더:** 이동·길이 미리보기 중에는 음을 미리보기 위치/길이로 그린다(`data-dragging`), 곡 상태는 커밋 전까지 불변(`canUndo` 불변). 렌더 비용: 선택·미리보기가 바뀌어도 음 컴포넌트는 `memo`로 변한 것만 다시 그린다; 10Hz `position` 변화로 음 레이어가 다시 그려지지 않는다(렌더 카운트 테스트).
- 기존 2a 훅(`useClipDrag`/`useBoundaryDrag`)은 **수정하지 않는다**(같은 규칙을 새 훅이 구현). 중복이 눈에 띄는 순수 도우미는 새 파일로 복사하지 말고 가능하면 import해서 쓴다.

**테스트 표(jsdom, 실제 Provider, 곡 상태 단언):** 빈 곳 클릭 → 음 추가(칸 내림 위치·기본 길이·세기 0.8·선택 키, `canUndo`), 이미 음이 품은 자리 클릭은 추가 안 함, 5px 이상 움직이면 추가 안 함(박스 선택으로), 비주 버튼·NaN·`!editable` 무시, 열린 팝오버를 닫는 클릭은 추가 안 함; 음 클릭 선택/Shift 토글/단독 선택으로 전환; 이동: 5px 미만 = 클릭, 미리보기 중 `studio().song`·`canUndo` 불변, 놓을 때 정확히 한 번 커밋(키·위치), 화음(두 음) 덩어리 이동, 거부 구간(겹침·경계·음높이 한계)에서 마지막 유효 위치 유지, 제자리 드롭 커밋 없음, Esc/pointercancel/lostcapture/대상 소멸/`!editable`로 취소, 놓는 요소가 달라도(재라우팅 끄고) 캡처 덕에 완료, **캡처가 `pointerdown` 시점에 이미 잡혀 있음**; 길이 핸들(8px)로 5px 움직임에도 드래그가 시작됨(2a 결함 재발 방지), 덩어리 길이 클램프; 박스 선택(교차 판정·Shift 합침·빈 박스 선택 해제), 박스 취소; Esc 단계(드래그만 취소 → 선택 해제 → 모달 닫기, 한 번에 하나); 선택 키가 undo로 사라지면 걸러짐; `afterEach`에서 `hasActiveGesture()`·`hasOpenModal()` false 단언; 렌더 카운트(position 변화로 음 레이어 재렌더 없음); `cellFromPointer`·`boxFromPoints` 순수 표(스크롤 보정, 음수·범위 밖 null, NaN null, 손계산 값 포함).
**변이(되돌림 확인):** 캡처를 임계 뒤로 미룸 → 8px 핸들 테스트 실패; 이동을 move마다 커밋 → "한 번만" 실패; 거부 시 미리보기를 원본으로 되돌림 → "마지막 유효 위치" 실패; `buttons` 가드 제거 → 실패; Esc에서 드래그 중 선택도 해제 → 한 겹 테스트 실패; 낡은 선택 키 걸러내기 제거 → 실패; `editable` 게이트 제거 → 실패; `memo` 제거 → 렌더 카운트 실패.

- [ ] **테스트 우선 구현 → 검증(`pnpm lint && pnpm check-types && pnpm test && pnpm build`) → 커밋**

```bash
git add components/studio
git commit -m "feat(editor): 피아노롤에서 음 추가·선택·박스·이동·길이 조절을 추가한다"
```

---

### Task 5: 세기 레인과 키보드 이동

**Files:**
- Create/Modify: `components/studio/pianoroll/VelocityLane.tsx`(+test), `useNoteKeys.ts`(+test), `NoteBlock.tsx`(필요 시), `PianoRoll.tsx`, `PianoRoll.test.tsx`

**규칙:**
- **세기 레인:** 격자 아래(가로 스크롤은 격자와 동기: 같은 스크롤 컨테이너 안에 두거나 `scrollLeft`를 맞춤 — **스크롤바를 직접 만들지 않는다**), 높이 80px, 음마다 막대. 막대는 키보드로도 닿도록 `role="slider" aria-label="C4 세기" aria-valuemin=5 aria-valuemax=100 aria-valuenow=<퍼센트> tabIndex=0`를 갖고 `↑/↓` 키로 ±5%씩 바꾼다. 막대 높이 = 세기 × 레인 높이. 세로 드래그: `pointerdown`에서 캡처, 미리보기(막대 높이) → 놓을 때 `edit.notes.setVelocities` **한 번**(그 음이 선택에 있으면 선택 전체를 같은 값, 없으면 그 음만 단독 선택하지 않고 그 음만), 값 = `clamp(1 − y/레인높이, 0.05, 1)`을 소수 둘째 자리 반올림하지 않고 그대로(순수 `velocityFromY`로 분리·단위 테스트). 취소 경로·`buttons` 가드·`editable` 게이트·비유한 좌표 무시는 Task 4와 같다.
- **키보드(모달 포커스가 격자/음에 있을 때, 입력 요소·`role=slider`는 제외):** `←/→` 선택을 격자 단위만큼 시간 이동(`planMoveNotes(dTicks=±unit, 0)`), `↑/↓` 반음, `Shift+↑/↓` 옥타브(±12), `Alt+←/→` 길이 ±격자 단위(`planResizeNotes`), `Delete/Backspace` 삭제(`planRemoveNotes`, 삭제 뒤 선택 비움·포커스를 격자 또는 이웃 음으로), `Ctrl/Cmd+A` 전체 선택. 거부(경계·겹침)면 아무 일 없음. 처리했을 때만 `preventDefault`(방향키 스크롤 방지), 선택이 없으면 처리하지 않는다. `event.isComposing`·`defaultPrevented`·`Ctrl/Meta`+방향키 무시(브라우저 단축키). `hasActiveGesture()` 중에는 키 편집을 막는다(드래그 중 곡 변경 방지).
- 리스너는 `document` 하나(모달 마운트 동안), 최신 값은 ref로 읽는다(2a `useShortcuts` 패턴), 정리 보장.

**테스트:** 세기 막대 높이(손계산: 세기 0.8 → 레인 80px에서 64px), 드래그로 값 변경·한 번 커밋·선택 전체 적용 vs 단일, 클램프(0.05 하한·1 상한), `velocityFromY` 표(y 0→1, y 레인높이→0.05, 중간 y 40→0.5, NaN→null), 취소 경로, `!editable`; 막대 `role=slider` 키 ±5%; 키보드 전체 표(각 키가 곡 상태를 기대대로 바꿈, 거부 시 no-op, 선택 없음 no-op, Shift/Alt 조합, 입력 요소 포커스 시 무시, 드래그 중 무시, `preventDefault` 여부, 한 번의 키 = 한 히스토리 항목, undo로 복구); 리스너 정리.
**변이:** 키 처리에서 `hasActiveGesture` 가드 제거 → 실패; Delete 뒤 선택 비움 제거 → 실패; `Alt+←/→`가 시간 이동으로 동작 → 실패; 세기 클램프 제거 → 실패; 리스너 정리 누락 → 실패.

- [ ] **테스트 우선 구현 → 검증(`pnpm lint && pnpm check-types && pnpm test && pnpm build`) → 커밋**

```bash
git add components/studio
git commit -m "feat(editor): 피아노롤의 세기 레인과 키보드 편집을 추가한다"
```

---

### Task 6: 통합 테스트와 문서

**Files:** Create `components/studio/pianoroll/PianoRoll.integration.test.tsx`; Modify `AGENTS.md`, `README.md`, `docs/known-gaps.md`, `.claude/rules/ui-conventions.md`, `.claude/rules/frontend-architecture.md`, `.claude/CHANGELOG.md`, `docs/superpowers/specs/2026-11-21-piano-roll-design.md`(상태 한 줄)

**통합 테스트(jsdom, `<StudioProvider><Studio/></StudioProvider>` + 가짜 deps, 실제 UI 이벤트):** (1) 데모 곡에서 피아노 첫 패턴 클립 선택 → 팝오버 "음으로 바꾸기" → 모달이 열림 + 굽기 안내 → **굽기 전후 `engine.setSong`이 받은 곡의 `expandSong`이 같음**; (2) 격자 빈 곳 클릭으로 음 추가 → 이동 드래그 → 길이 핸들 → 세기 드래그 → 키보드 이동/삭제 각 단계 후 가짜 엔진이 받은 마지막 곡의 `expandSong` 피아노 이벤트에 변경이 반영(추가한 음의 `tick/pitch/length/velocity`를 손계산으로 단언); (3) Ctrl+Z 반복으로 한 단계씩 복구; (4) 모달에서 Space로 재생(가짜 play pending → 편집 차단·알림, 재생 중 키보드 편집 무시) → 정지 → 다시 편집 가능; (5) 모달 닫기 → 곡 화면 선택·상태 유지, 클립 소멸(undo)로 모달 자동 닫힘; (6) 자동 저장 300ms 후 저장소의 곡이 `loadSong` 왕복 동일 + 다시 마운트하면 복원된 곡으로 음 클립 유지; (7) `<StrictMode>`에서 모달 열고 닫기·카운터 균형·편집 정상; (8) 빈 트랙 칸 Shift+클릭으로 빈 음 클립 → 편집 버튼으로 열기 → 음 추가; (9) 모달 열림 동안 전역 Delete가 클립을 지우지 않고 음을 지움; (10) 서버 렌더(`renderToString`)는 모달을 렌더하지 않고 기존처럼 통과. `afterEach`에서 console 잡음·모듈 카운터(`hasOpenPopover`, `hasActiveGesture`, `hasOpenModal`) 0 단언, 복원 먼저(`try/finally`).

**문서(코드로 검증한 사실만):**
- `AGENTS.md`: "현재 상태"에 2b-1(화음 악기 피아노롤) 완료, "지금 있는 것"에 `lib/score/notes.ts`·`components/studio/pianoroll/`, "아직 없는 것"에서 음 단위 편집·피아노롤을 지우고 **드럼 그리드(2b-2), 음 미리듣기, 반복 재생, 복사/붙여넣기, 다시실행, 줌**을 남긴다. 음 편집 규칙의 단일 출처가 `notes.ts`임을 명시. 아무도 들어 보지 않았다는 점 유지.
- `README.md`: 디렉터리·기능 표.
- `docs/known-gaps.md`: 새 간극(여러 음 이동 전체 거부, `(start,pitch)` 중복 로드 곡, 굽기 한 방향·음→패턴 되돌리기 없음, 음 미리듣기 없음, 피아노롤 키보드 접근성의 한계(박스 선택·핸들은 포인터 전용), 모달 포커스 가두기 외 `inert` 없음, 큰 클립(수백 음) 렌더 비용 미측정, 세기 레인 키보드 한계), 듣기 체크리스트에 **피아노롤 항목 추가**(굽기 직후 원래 패턴과 같은 소리인지, 음 하나 추가/이동/길이/세기 변화가 들리는지, 화음 이동·키보드 이동, 코드 진행을 바꾼 뒤 구운 클립이 따라오지 않는지).
- `.claude/rules/ui-conventions.md`: 제스처 표에 피아노롤 행 추가, 모달·포털 규칙(포커스 가두기·카운터), 격자 CSS 배경 규칙. `frontend-architecture.md`: 디렉터리 블록에 `pianoroll/` 추가. `.claude/CHANGELOG.md`: 새 행.
- 설계 문서 상단에 "구현 완료(2026-11-21 계획 Task 1~6)" 한 줄.

**검증:** `pnpm lint && pnpm check-types && pnpm test && pnpm build`, `grep`로 문서의 stale 표현("음 편집은 아직 없다", "피아노롤은 2b") 없음 확인.

- [ ] **테스트 우선 구현 → 문서 → 검증 → 커밋(둘로 나눈다)**

```bash
git add components/studio
git commit -m "test(editor): 피아노롤 통합 시나리오를 추가한다"
git add AGENTS.md README.md docs .claude
git commit -m "docs: 피아노롤을 문서에 반영한다"
```

(이후 통제자가 `pnpm dev`와 실제 Chrome으로 굽기 → 음 추가·선택·이동·길이·세기·키보드 → 재생·정지 → 되돌리기 → 새로고침 복원을 조작해 확인하고, 결과를 `docs/known-gaps.md`에 기록한다. 소리는 사용자가 듣는다.)

---

## Self-Review

**1. Spec 커버리지:** §2 규칙(같은 음높이 겹침·키·범위·세기) → Task 1. §3 함수 표 → Task 1 인터페이스와 표(굽기 동치 포함). §4 상태(`edit.notes`, 굽기 안내, 모달 표시) → Task 2. §5 진입(팝오버 두 버튼·편집 버튼·더블클릭·Shift+클릭)·모달·코드 띠·플레이헤드·포커스 → Task 3. §5 조작(추가·선택·박스·이동·길이·Esc 단계) → Task 4. §5 세기·키보드 → Task 5. §6 통합·문서 → Task 6. §2.1 표시 범위 → Task 1 `displayRange`. 이번에 안 하는 것(드럼 그리드·미리듣기·반복·복사·다시실행·줌)은 어느 Task에도 없음(문서에서 "아직 없는 것"으로 남김).

**2. 플레이스홀더 점검:** "TBD"/"나중에"는 없다. UI Task의 구현 코드는 의도적으로 구현자가 쓰고, 동작 규칙·인터페이스·손계산 테스트 표·변이 검증을 정했다. 모호하면 구현하지 말고 `NEEDS_CONTEXT`로 묻는다.

**3. 타입 일관성:** `NoteKey`·`NotePlan`·`GridUnit`·`NoteBox`(Task 1) ↔ `StudioNoteEdits`(Task 2) ↔ `useNoteGestures`·`VelocityLane`(Task 4·5). `ROW_HEIGHT`·`rollXToTick`·`pitchToY`(Task 3) ↔ 제스처(Task 4). `hasOpenModal`/`useModalOpenCount`(Task 2) ↔ 모달·단축키(Task 3). `beginGesture`/`hasActiveGesture`(2a) ↔ Esc·키 편집(Task 3~5).

**4. 알려진 위험:** (a) 제스처 훅이 2a와 거의 같은 상태 기계라 복사 대신 순수 도우미 재사용을 지시했지만 구현자가 중복을 만들 수 있다 — 리뷰에서 본다. (b) 모달의 포커스 가두기·전역 단축키·팝오버 카운터 교차 상호작용은 2a에서 반복해서 결함이 나온 영역이다 — 통합 테스트(9)와 통제자의 실제 브라우저 점검 대상. (c) jsdom은 스크롤·레이아웃·`:focus-visible`을 못 본다. (d) 여러 음 이동의 "전체 거부"는 사용성 위험(spec §8).
