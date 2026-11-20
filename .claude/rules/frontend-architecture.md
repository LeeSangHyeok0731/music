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

아래 구조 중 "(아직 없음)"이 아닌 것은 실제로 존재한다. 옛 타임라인·상태 계층(`components/timeline/`, `components/transport/`, `state/StudioProvider`)은 재구상에서 철거했고 편집 UI 하위 프로젝트에서 새로 만든다. 이 문서의 아래 절들이 `StudioProvider`를 말하는 곳은 그 옛 설계의 규칙이다 — 편집 UI를 설계할 때 다시 정한다.

```text
app/                    Next.js App Router 엔트리포인트 (`/` = 소리 확인 화면)
lib/score/              곡 데이터 모델 v2 — Song/Track/Clip/Note, 코드·패턴, 펼치기, 검증, 스키마, 데모 곡, 실행취소 규칙. 순수 TS. Web Audio도 React도 import하지 않는다
lib/audio/              오디오 엔진 — AudioContext, look-ahead 스케줄러, 보이스 풀, 메트로놈, 샘플 뱅크(samples/), 샘플 악기(instruments/). 순수 TS. React를 import하지 않는다
components/verify/      소리 확인 화면 (편집 UI가 아니다)
components/ui/          (아직 없음) 버튼, 슬라이더, 패널 등 공용 컨트롤
state/                  (아직 없음) 편집 UI가 생길 때의 React 상태 (Context)
scripts/                개발용 톤 생성(gen-dev-samples.mjs)
public/samples/         악기 샘플 — 커밋된 파일 없음(gitignore). 지금은 `pnpm gen:dev-samples`의 개발용 톤. 실제 팩은 계획 Task 15
```

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
- `lib/audio/`는 React를 import하지 않는다. `AudioContext`, 노드 그래프, 스케줄러, 재생 커서를 소유한다. UI는 명령형 메서드(`play()`, `stop()`, `seek()`, `setTempo()`)로만 이 레이어를 건드린다.
- `components/`는 `lib/audio/`의 내부 상태를 직접 폴링하지 않는다. `state/StudioProvider`가 노출하는 것만 읽는다.
- **`use client`는 훅이나 브라우저 API를 쓰는 모든 파일에 필요하다.** 이걸 한곳에 몰아주는 루트 컴포넌트는 두지 않는다.

## 상태 소유권

두 종류의 상태가 있고, 절대 섞지 않는다.

- **오디오/재생 상태** (플레이헤드 위치, 예약된 이벤트 큐, 현재 울리고 있는 보이스, 미터 레벨 — 매 프레임 또는 매 스케줄 틱마다 변함): **오직 `lib/audio/` 엔진 내부**에만 산다. `useState`에 들어가지 않고, 이걸 복사해 둔 평범한 객체를 ref에 담아 두지도 않는다. 화면에 플레이헤드를 그릴 때는 `requestAnimationFrame`에서 엔진 값을 읽어 DOM/캔버스에 직접 쓴다 — 리렌더를 유발하지 않는다.
- **React 상태** (`state/StudioProvider.tsx`의 `useState`): 재생 중인지 여부, 템포, 박자, 루프 구간, 선택된 트랙/노트, 악기 설정, 그리고 **표시용으로 낮은 주기(10Hz 정도)로 샘플링한** 재생 위치. 편집 UI가 리렌더되는 근거는 이것뿐이다.
- **곡 데이터** (노트, 트랙 구성): 사용자 편집으로만 바뀌므로 React 상태로 두는 것이 맞다. 단 변경 시 엔진에 반영해야 한다 — 재생 중 편집이 언제부터 들리는지(보통 다음 스케줄 틱부터)를 정해 두고 지킨다.

`useState`에 담은 객체를 제자리에서 변형(mutate)하지 않는다. React Compiler가 그 변경을 관찰하지 못한다. 구조적 변경은 새 객체를 만들고, 매 프레임 값은 애초에 React 상태가 아니어야 한다.

UI 조작은 `StudioProvider`의 setter를 통과한다. setter가 엔진을 명령형으로 호출하고(`engine.setTempo(v)`) 같은 호출에서 React 상태를 갱신한다. 엔진이 스스로 리렌더를 일으키지 않는다.

## 변경 범위

- 요청을 만족하는 가장 작은 변경만 한다.
- 이번 변경이 필요로 하지 않는 한 주변 코드를 리팩터링하지 않는다.
- 구조가 깔끔해 보이려고 파일을 옮기지 않는다.
- 실제 중복을 제거할 때만 추상화를 추가한다.
