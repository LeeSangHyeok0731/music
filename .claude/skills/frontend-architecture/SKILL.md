---
name: frontend-architecture
description: 'Plan and review Bandline architecture: layer placement (lib/score, lib/audio, components, state), audio-state vs React-state ownership, component responsibilities, and minimal implementation scope. Use for any feature, refactor, routing, dependency, or architecture decision in this repository.'
---

# Frontend Architecture

변경을 저장소의 실제 구조에 맞추고 불필요한 리팩터링을 막는 데 쓴다.

## Repository Shape

Bandline은 Next.js App Router 프론트엔드다:

- Next.js 16, React 19, TypeScript
- Tailwind CSS 4
- Web Audio API (브라우저 네이티브, 서버 렌더링 불가)

**현재 구조** (정확한 배치와 각 폴더의 역할은 `.claude/rules/frontend-architecture.md`의 디렉터리 구조):

```text
app/                `/` = StudioProvider로 감싼 Studio (편집 화면)
lib/score/          곡 데이터 모델 v3와 편집 규칙(edit.ts). 순수 TS
lib/audio/          오디오 엔진. React 없음
components/studio/  편집 화면 UI
state/              StudioProvider, useStudio
public/samples/     CC0 샘플 팩
```

`components/ui/`(공용 컨트롤)는 아직 없다.

`src/`도, 데이터 레이어도, 서버 API도 없다. FSD 레이어나 상태 라이브러리를 이 규모에 도입하지 않는다.

`AGENTS.md`는 프레임워크 레벨 코드 전에 `node_modules/next/dist/docs/`를 읽으라고 요구한다 — 이 Next.js 버전은 흔한 학습 데이터와 다르다.

## Planning Workflow

1. 사용자에게 보이는(또는 들리는) 동작을 정의한다.
2. 어느 계층에 속하는지 정한다:
   - 곡 데이터 구조·시간 계산 → `lib/score/`
   - 재생, 타이밍, 소리 → `lib/audio/`
   - 편집 화면, 컨트롤 → `components/`
   - 둘을 잇는 상태와 setter → `state/StudioProvider.tsx`
3. 어떤 상태가 필요한지 정한다:
   - 매 프레임/매 틱 변하는 값 (플레이헤드, 예약 큐, 보이스) → **엔진 내부.** `useState` 금지
   - 리렌더를 유발해야 하는 UI 값 (재생 여부, 템포, 선택, 악기 설정) → `useState`
   - 곡 데이터 → `useState` (사용자 편집으로만 변함). 단 엔진 반영 시점을 명시
4. 변경을 소유할 가장 작은 컴포넌트를 고른다.

## Ownership Rules

- `app/page.tsx`: 얇게 유지한다. 스튜디오 셸을 `StudioProvider`로 감싸는 정도.
- `app/layout.tsx`: html 셸, 폰트, 메타데이터.
- `lib/score/`: Web Audio도 React도 import하지 않는다.
- `lib/audio/`: React를 import하지 않는다. AudioContext와 재생 상태를 소유한다.
- `components/`: 엔진 내부를 직접 폴링하지 않는다. `StudioProvider`가 노출한 것만 읽는다.
- `use client`는 훅이나 브라우저 API를 쓰는 모든 파일에 필요하다. 한곳에 몰아주는 루트 컴포넌트는 두지 않는다.

## Decision Rules

- 반복되는 복잡성을 제거할 때만 새 추상화를 추가한다.
- 매 프레임 `setState` 금지. 구조적 변경(노트 추가/삭제)은 상태를 바꿔도 되지만 연속 값은 안 된다.
- `useState`에 담은 객체를 제자리에서 변형하지 않는다. React Compiler가 관찰하지 못한다.
- **Web Audio는 서버에서 실행되지 않는다.** 모듈 스코프에서 `AudioContext`를 만들 수 없고, 소리를 내는 경로는 사용자 제스처 뒤에 있어야 한다. 계획에 이걸 명시한다.
- 곡이 커질 때 곱해지는 비용(스케줄러 틱, 렌더 노드 수, 동시 발음, 샘플 용량)은 계획에서 정당화한다.
- 구조가 깔끔해 보이려고 파일을 옮기지 않는다.
- **규칙 문서가 아직 계획인 부분을 구현이 사실로 만들면, `.claude/rules/*.md`를 갱신하는 것까지 작업 범위에 넣는다.**

## Output

짧은 계획을 쓴다:

- 변경이 어느 계층에 속하는지
- 상태 소유권 (엔진 / React 상태 / ref)
- 바뀔 파일
- 성능 위험 (스케줄러 틱 비용, 렌더 노드 수, 동시 발음 수, 샘플 다운로드 용량)
- 가정과 검증 절차 — **소리로 확인해야 하는 항목을 따로 적는다**
