---
name: ui-implementation
description: 'Implement Bandline editing UI: the piano roll, timeline, track headers, transport controls, and Tailwind styling. Use for panels, controls, note editing interaction, layout, and visual changes.'
---

# UI Implementation

사용자가 보고 조작하는 것을 만들거나 바꿀 때 쓴다. 기준 문서는 `.claude/rules/ui-conventions.md`.

## Component Rules

- TypeScript React 함수 컴포넌트. 주변 스타일에 맞춘다.
- props는 `interface`로 타입 지정한다. 곡 데이터 타입은 `lib/score/`에서 import한다 — 다시 선언하지 않는다.
- 훅을 위에, 핸들러를 다음에, effect를 마지막에, 그다음 return 블록.
- 새 컴포넌트를 추가하기 전에 기존 것을 재사용한다.
- **훅이나 브라우저 API를 쓰면 `use client`가 필요하다.**

## Layer Rules

- UI는 `lib/audio/` 내부를 직접 폴링하지 않는다. `state/StudioProvider`가 노출한 것만 읽는다.
- 엔진 API가 없어서 막히면 직접 `lib/audio/`를 고치지 말고 필요한 API를 명시해 요청한다.

## Styling Rules

- Tailwind CSS 4, 클래스 문자열 직접 작성. `cn()` 헬퍼도 컴포넌트 라이브러리도 없다 — 추가하지 않는다.
- **비주얼 언어는 아직 확정되지 않았다.** 처음 만드는 화면이 기준이 된다. 팔레트와 패널 스타일을 정하면 `.claude/rules/ui-conventions.md`에 기록해 이후 화면이 따르게 한다.
- DAW UI는 어두운 배경이 기본이다 — 오래 보는 도구이고 노트 색 구분이 중요하다. 라이트 테마를 넣으면 노트 대비를 양쪽에서 확인한다.
- 숫자 표시(BPM, 마디:박, 시간)는 `font-mono`. 폭 변화로 레이아웃이 흔들리지 않게.
- 컨트롤에 텍스트가 들어가는지 확인한다. 요청하지 않은 설명 문구를 넣지 않는다.

## Piano Roll / Timeline Rules

노트가 수천 개까지 갈 수 있는 화면이다. 일반 폼 UI와 규칙이 다르다.

- **플레이헤드는 노트와 분리된 레이어.** 움직일 때 노트가 리렌더되면 안 된다. `rAF`에서 ref로 `transform: translateX()`만 직접 쓴다 — `useState`를 거치지 않는다.
- 화면 밖 노트는 그리지 않는다(가상화).
- 노트 데이터에 픽셀 값을 저장하지 않는다. 음악적 시간을 렌더 직전에 `pixelsPerBeat × zoom`으로 환산한다.
- 렌더 방식(DOM vs `<canvas>`)은 미정. DOM으로 시작하고, 노트 수가 늘어 프레임이 떨어지면 canvas 전환을 제안한다.
- 줌·스크롤은 React 상태로 둬도 되지만, 스크롤 중 전체 리렌더가 나지 않는지 확인한다.

## Interaction Rules

- 노트 드래그·리사이즈는 `pointerdown` → `pointermove` → `pointerup`. `setPointerCapture`로 요소 밖에서도 추적을 유지한다.
- 드래그 중에는 미리보기만 갱신하고, 곡 데이터 커밋은 `pointerup`에서 한 번만. 매 프레임 곡 전체를 교체하지 않는다.
- 키보드 단축키는 입력 필드 포커스 시 가로채지 않는다. `event.target`을 확인한다.
- **소리를 내는 진입점은 사용자 제스처 안에 있어야 한다.** 재생 버튼, 건반 클릭, 노트 미리듣기에서 `AudioContext.resume()` 경로가 보장되는지 확인한다.

## Accessibility Rules

- 재생/정지, 뮤트/솔로는 실제 `<button>`. `<div onClick>` 금지.
- 트랜스포트 컨트롤과 트랙 목록은 탭 순서가 통해야 한다.
- 색만으로 상태를 구분하지 않는다.

## Verification

- `pnpm dev`로 실제로 띄워 본다. diff는 화면을 보여주지 않는다.
- 노트를 많이 배치한 상태에서 스크롤·줌·재생이 부드러운지 확인한다.
- 좁은 화면과 넓은 화면에서 트랙 헤더와 타임라인이 어긋나지 않는지 확인한다.
- 확인하지 못한 시각적 가정을 구현 산출물에 기록한다.
