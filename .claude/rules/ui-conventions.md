---
description: 'React, Tailwind, piano-roll/timeline rendering, and interaction conventions for Bandline TSX and style files.'
paths:
  - 'app/**/*.tsx'
  - 'app/globals.css'
  - 'components/**/*.tsx'
---

# UI Conventions

편집 UI를 만들거나 리뷰할 때 쓴다.

## 컴포넌트

- TypeScript 함수 컴포넌트. 컴포넌트는 `PascalCase`, 헬퍼는 `camelCase`.
- props는 `interface`로 타입 지정한다. 공유 타입은 소유자 쪽에 둔다 — 곡 데이터 타입(`Note`, `Track`, `Pattern`)은 `lib/score/`에서, 엔진 타입은 `lib/audio/`에서, UI 컨텍스트 타입은 `state/StudioProvider.tsx`에서 export한다.
- 새 패턴을 도입하기 전에 주변 컴포넌트 스타일을 먼저 맞춘다.

## 스타일

- Tailwind CSS 4. 클래스 문자열을 직접 쓴다. `cn()` 헬퍼도 컴포넌트 라이브러리도 없다 — 추가하지 않는다. 필요하다고 판단되면 먼저 사용자에게 묻는다.
- 숫자 표시(BPM, 마디:박, 시간)는 `font-mono tabular-nums`. 폭이 변하면서 레이아웃이 흔들리는 걸 막는다.
- 설명용 문구를 화면에 임의로 추가하지 않는다. 요청이 있을 때만 넣는다.

### 팔레트

타임라인 화면에서 정한 값이다. 이후 화면은 여기 맞춘다. 라이트 테마는 없다 — 긴 시간 응시하는 도구이고 타일 색 구분이 중요해서다.

| 용도 | 값 |
| --- | --- |
| 앱 배경 | `#0b0c0f` (`app/globals.css`의 `body`) |
| 패널 — 헤더 바, 트랙 헤더 열 | `#141519` |
| 패널 경계 | `border-white/10` |
| 행 구분선 | `rgb(255 255 255 / 0.07)` |
| 마디선 / 박선 | `white/0.11` / `white/0.035` |
| 본문 텍스트 | `text-zinc-200` · 보조 `text-zinc-400` · 흐림 `text-zinc-500` |
| 플레이헤드 | `bg-red-500` |

악기 색은 타일과 트랙 헤더 점이 같은 계열을 쓴다: 피아노 `indigo`, 기타 `emerald`, 베이스 `amber`, 드럼 `rose`. 타일은 `bg-{색}-500/25` + `border-{색}-400/60`.

### 레이아웃

- 앱 셸은 `h-dvh`로 화면을 꽉 채우고 바깥은 스크롤하지 않는다. 스크롤은 타임라인 안쪽에서만 일어난다. 가운데 정렬된 `max-w-*` 칼럼을 두지 않는다 — DAW는 화면을 다 쓴다.
- 스테이지에 `minWidth: 100%`, `min-h-full`을 준다. 곡이 뷰포트보다 짧아도 격자가 화면을 채워서 "트랙이 더 들어갈 자리"로 읽힌다.
- **행 구분선은 `border`가 아니라 `boxShadow`(inset)로 그린다.** border는 박스 높이를 1px 먹어서, 드럼 라인처럼 안쪽 행 높이의 합이 컨테이너 높이와 같아야 하는 경우 헤더 열과 스테이지가 아래로 갈수록 어긋난다. 상수는 `components/timeline/layout.ts`의 `ROW_DIVIDER`.
- 트랙 헤더 열과 스테이지는 같은 높이 상수(`layout.ts`)를 쓴다. 스테이지 맨 위 눈금자 높이만큼 헤더 열에도 빈 칸을 둔다.

## 피아노롤 / 타임라인

노트가 수천 개까지 갈 수 있는 화면이다. 일반 폼 UI와 규칙이 다르다.

- **플레이헤드는 노트와 분리된 레이어**로 그린다. 플레이헤드가 움직일 때 노트 컴포넌트가 리렌더되면 안 된다. `transform: translateX()`만 바꾸고, 값은 `requestAnimationFrame`에서 ref로 직접 쓴다 — `useState`를 거치지 않는다.
- 노트 렌더 방식(DOM 요소 vs `<canvas>`)은 아직 정해지지 않았다. DOM으로 시작하되 노트 수가 늘어 프레임이 떨어지면 canvas로 옮긴다. 어느 쪽이든 화면 밖 노트는 그리지 않는다(가상화).
- 그리드 계산은 음악적 시간 기준이다. 픽셀 좌표는 렌더 직전에 `pixelsPerBeat × zoom`으로 환산한다. 노트 데이터에 픽셀 값을 저장하지 않는다.
- 줌·스크롤 상태는 React 상태로 둬도 된다(사용자 조작 빈도라서). 단 스크롤 중 매 이벤트마다 전체 리렌더가 나지 않는지 확인한다.

## 인터랙션

- 노트 드래그·리사이즈는 `pointerdown` → `pointermove` → `pointerup` 흐름으로 처리하고, `setPointerCapture`로 요소 밖으로 나가도 추적이 끊기지 않게 한다.
- 드래그 중에는 미리보기만 갱신하고, 실제 곡 데이터 커밋은 `pointerup`에서 한 번만 한다. 드래그 매 프레임마다 `setState`로 곡 전체를 갈아치우지 않는다.
- 키보드 단축키(스페이스=재생/정지 등)는 입력 필드에 포커스가 있을 때 가로채면 안 된다. 핸들러에서 `event.target`을 확인한다.
- **소리를 내는 모든 진입점은 사용자 제스처 안에 있어야 한다.** 재생 버튼, 건반 클릭, 노트 미리듣기 핸들러에서 `AudioContext.resume()`이 보장되는지 확인한다 (`.claude/rules/audio-engine.md` 참고).

## 접근성

- 재생/정지, 트랙 뮤트/솔로 같은 컨트롤은 실제 `<button>`이어야 한다. `<div onClick>`으로 만들지 않는다.
- 노트 그리드 자체는 키보드로 다루기 어렵다. 최소한 트랜스포트 컨트롤과 트랙 목록은 탭 순서가 통하게 한다.
- 색만으로 상태를 구분하지 않는다(뮤트된 트랙, 선택된 노트 등).

## 검증

- `pnpm dev`로 실제로 띄워 본다. diff는 화면이 어떻게 보이는지 알려주지 않는다.
- 노트를 많이 배치한 상태에서 스크롤·줌·재생이 부드러운지 본다.
- 좁은 화면과 넓은 화면 양쪽에서 트랙 헤더와 타임라인이 어긋나지 않는지 본다.
