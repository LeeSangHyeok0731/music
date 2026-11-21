---
description: 'Project structure, layer boundaries, and audio-state vs React-state ownership for Bandline source files.'
paths:
  - 'app/**/*'
  - 'components/**/*'
  - 'lib/**/*'
  - 'state/**/*'
  - 'CLAUDE.md'
  - 'AGENTS.md'
---

# Frontend Architecture Rules

이 저장소의 아키텍처 체크리스트다.

## Next.js 문서를 먼저 읽는다

`AGENTS.md`는 구속력이 있다. 이 Next.js 버전은 흔한 학습 데이터와 다르다. 라우팅, 메타데이터, config, 서버/클라이언트 경계 같은 프레임워크 레벨 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 가이드를 읽는다.

## 디렉터리 구조

괄호로 없다고 표시하지 않은 것은 실제로 존재한다. 옛 타임라인·상태 계층은 재구상에서 철거했고, 편집 화면(하위 프로젝트 2a)이 `components/studio/`와 `state/`로 새로 들어왔다. 이 문서의 아래 절이 말하는 `StudioProvider`는 지금 있는 `state/StudioProvider.tsx`다.

```text
app/                    Next.js App Router 엔트리포인트 (`/` = 편집 화면: `StudioProvider`로 감싼 `Studio`)
lib/score/              곡 데이터 모델 v3 — Song/Track/Clip/Note + 곡이 소유하는 코드 진행(progression), 코드·패턴, 펼치기, 검증, 스키마, 데모 곡, 실행취소 규칙(history.ts), 편집 규칙(edit.ts — 규칙의 단일 출처), 자동 저장 직렬화(autosave.ts), 진행 조회(progression.ts), 마디 축소 판정(bars.ts), 패턴 표시 이름(pattern-labels.ts). 순수 TS. Web Audio도 React도 import하지 않는다
lib/audio/              오디오 엔진 — AudioContext, look-ahead 스케줄러, 보이스 풀, 메트로놈, 샘플 뱅크(samples/), 샘플 악기(instruments/). 순수 TS. React를 import하지 않는다
components/studio/      편집 화면 UI — Studio, TopBar, 코드 레인(ChordLane), 트랙 레인(TrackLane/ClipBlock), 팝오버, Playhead, 드래그 훅(useClipDrag/useBoundaryDrag), 단축키(useShortcuts), 좌표 순수 함수(geometry.ts), 레이아웃 상수(layout.ts), 테스트 헬퍼(testing/)
components/ui/          (아직 없음) 공용 컨트롤
state/                  StudioProvider — Engine 하나, 곡 히스토리, 재생 상태 기계, 자동 저장을 소유. useStudio()가 StudioApi를 준다. 테스트용 가짜 의존성은 state/testing/fake-deps.ts
scripts/                샘플 팩 빌드(build-sample-pack.mjs, sample-pack.config.mjs, sample-pack/), 개발용 합성 톤(gen-dev-samples.mjs → public/samples-dev/, gitignore)
public/samples/         CC0 샘플 팩(커밋됨). `pnpm build:samples` 출력이라 손으로 고치지 않는다. 출처·라이선스는 public/samples/LICENSES.md
```

**편집 규칙은 `lib/score/edit.ts`에만 둔다.** 스냅·클램프·겹침 방지·최소 길이 같은 규칙을 훅·컴포넌트에 두지 않는다. 편집 함수는 새 `Song`을 돌려주고 바뀐 게 없으면 같은 참조를 돌려주며(실행취소가 빈 칸을 쌓지 않는다), 결과는 항상 `validateSong`을 통과한다. UI는 `useStudio().edit.*`로만 곡을 바꾸고, 드래그는 미리보기만 그리다가 놓을 때 한 번 커밋한다.

`src/`, feature/entity 레이어, FSD는 두지 않는다. 이 규모에 맞지 않는다.

임포트는 `@/` alias(저장소 루트 기준)로 해결한다.

## 3계층 경계

가장 중요한 경계다:

```text
lib/score/ (곡 데이터 — 무엇을 연주할지)
   -> lib/audio/ (엔진 — 언제 어떻게 소리 낼지, 재생 상태를 소유)
   -> components/ (React — 편집·표시, 파생된 React 상태만 읽음)
```

- `lib/score/`는 Web Audio도 React도 모른다. 순수 데이터와 순수 함수만. 브라우저 없이 검증 가능해야 한다.
- `lib/audio/`는 React를 import하지 않는다. `AudioContext`, 노드 그래프, 스케줄러, 재생 커서를 소유한다. UI는 명령형 메서드(`play()`, `stop()`, `setSong()`, `setTempo()`, `setMetronome()`)로만 이 레이어를 건드린다. 지금 `Engine`에 `seek()`은 없다.
- `components/`는 `lib/audio/`의 내부 상태를 직접 폴링하지 않는다. `state/StudioProvider`가 노출하는 것만 읽는다.
- **`use client`는 훅이나 브라우저 API를 쓰는 모든 파일에 필요하다.** 이걸 한곳에 몰아주는 루트 컴포넌트는 두지 않는다.

## 상태 소유권

두 종류의 상태가 있고, 절대 섞지 않는다.

- **오디오/재생 상태** (플레이헤드 위치, 예약된 이벤트 큐, 현재 울리고 있는 보이스, 미터 레벨 — 매 프레임 또는 매 스케줄 틱마다 변함): **오직 `lib/audio/` 엔진 내부**에만 산다. `useState`에 들어가지 않고, 이걸 복사해 둔 평범한 객체를 ref에 담아 두지도 않는다. 화면에 플레이헤드를 그릴 때는 `requestAnimationFrame`에서 엔진 값을 읽어 DOM/캔버스에 직접 쓴다 — 리렌더를 유발하지 않는다.
- **React 상태** (`state/StudioProvider.tsx`): 곡 히스토리(곡 포함), 재생 단계(`idle`/`pending`/`playing`), 선택된 클립, 메트로놈, 안내 메시지, 그리고 **표시용으로 10Hz로 샘플링한** 재생 위치(마디·박). 편집 UI가 리렌더되는 근거는 이것뿐이다. 템포는 곡(`song.tempo`)이 소유하고 실행취소에 쌓지 않는다. 플레이헤드는 `getEngine().currentTick()`을 rAF에서 읽어 DOM `transform`만 쓴다(`Playhead.tsx`).
- **곡 데이터** (진행, 클립, 트랙 구성): 사용자 편집으로만 바뀌므로 React 상태(히스토리)로 둔다. 엔진 반영은 한 길뿐이다 — 정지 중(`idle`)에 곡이 바뀌거나 `idle`로 돌아올 때 `engine.setSong(song)`. 엔진은 재생 중·재생 대기 중 `setSong`을 거절(`false`)하므로 **편집은 정지 중에만 허용**한다(`editable`). 재생 중에 바뀌는 것은 템포뿐이고 `engine.setTempo`로 바로 전한다.

`useState`에 담은 객체를 제자리에서 변형(mutate)하지 않는다. React Compiler가 그 변경을 관찰하지 못한다. 구조적 변경은 새 객체를 만들고, 매 프레임 값은 애초에 React 상태가 아니어야 한다.

UI 조작은 `StudioProvider`의 setter를 통과한다. setter가 엔진을 명령형으로 호출하고(`engine.setTempo(v)`) 같은 호출에서 React 상태를 갱신한다. 엔진이 스스로 리렌더를 일으키지 않는다. 엔진의 `isPlaying()`은 재생 대기(컨텍스트 재개·샘플 준비) 중에도 참이므로 UI의 재생 여부로 쓰지 않는다 — `play()`가 `{status:"playing"}`로 끝났을 때만 `playing`이다.

## 변경 범위

- 요청을 만족하는 가장 작은 변경만 한다.
- 이번 변경이 필요로 하지 않는 한 주변 코드를 리팩터링하지 않는다.
- 구조가 깔끔해 보이려고 파일을 옮기지 않는다.
- 실제 중복을 제거할 때만 추상화를 추가한다.
