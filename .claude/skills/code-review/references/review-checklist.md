# Review Checklist

`.claude/rules/*.md`, `CLAUDE.md`, `AGENTS.md`를 읽은 뒤에 쓴다.

## Architecture

- 변경이 맞는 계층에 있다: `lib/score/` (곡 데이터) / `lib/audio/` (엔진) / `components/` (React) / `state/` (연결).
- `lib/score/`가 Web Audio도 React도 import하지 않는다.
- `lib/audio/`가 React를 import하지 않는다.
- `components/`가 엔진 내부를 직접 폴링하지 않고 `StudioProvider`가 노출한 것만 읽는다.
- `use client`가 훅이나 브라우저 API를 쓰는 모든 파일에 있다.
- `app/page.tsx`가 얇게 유지된다.
- FSD 레이어, 상태 라이브러리, 데이터 레이어가 도입되지 않았다.

## AudioContext

- 모듈 스코프에 `new AudioContext()`가 없다 (SSR/빌드 파괴).
- 첫 사용자 제스처에서 지연 생성된다.
- 제스처 핸들러 안에 `await ctx.resume()` 경로가 있다.
- 앱 전체에 컨텍스트가 하나다.

## Scheduling

- 노트를 `setTimeout`/`rAF`로 하나씩 울리지 않는다.
- 예약 시각이 `ctx.currentTime` 기준 절대값이다. `Date.now()`/`performance.now()`가 섞이지 않았다.
- lookahead가 틱 간격보다 크다.
- 스케줄러 틱이 전체 노트를 스캔하지 않는다 (정렬 + 커서).
- 템포 변경 시 새 템포 적용 시점이 정의돼 있다.

## Musical Time

- 노트가 정수 틱으로 저장된다. 초로 저장되지 않았다.
- 초 변환이 예약 직전에 한 번만 일어난다.
- 재생 위치가 `pos += delta` 누적이 아니다.

## State Ownership

- 플레이헤드 위치, 예약 큐, 울리는 보이스, 미터 레벨이 `useState`에 없다.
- 이들을 복사해 둔 평범한 객체를 ref에 담아 두지 않았다.
- 매 프레임 `setState`가 없다. 표시용 값은 저주기로 샘플링된다.
- `useState`에 담긴 객체를 제자리에서 변형하지 않는다 (React Compiler가 관찰하지 못한다).
- 구조적 변경(노트 추가/삭제/이동)이 새 객체를 만든다.

## Node Lifecycle

- `OscillatorNode`/`AudioBufferSourceNode`를 재사용하지 않는다 (일회용).
- 만든 노드마다 `stop()` 예약과 `onended` → `disconnect()` 정리 경로가 있다.
- `exponentialRampToValueAtTime`의 목표값이 0이 아니다.
- 동시 발음 상한과 voice stealing이 있다.
- 마스터 게인 스테이지가 합산 클리핑을 막는다.

## Samples and Assets

- 샘플이 한 번만 디코드돼 `AudioBuffer`로 캐시된다.
- 첫 재생 전 필요한 샘플 로드가 보장되고 로딩 상태가 UI에 노출된다.
- `public/samples/` 경로가 실제 존재하는 파일을 가리킨다.
- 악기별 지연 로딩과 총 다운로드 용량이 고려됐다.

## AudioWorklet (있다면)

- `process()` 안에서 할당하지 않는다 (객체·배열·클로저 생성 금지).
- `console.log`, `fetch`, DOM 접근이 없다.
- 메인 스레드와 `port.postMessage`로만 통신한다.
- 모듈 경로가 번들러 설정과 맞는다.

## Rendering and UI

- 플레이헤드 이동이 노트 리렌더를 유발하지 않는다 (분리된 레이어, ref + transform).
- 화면 밖 노트를 그리지 않는다.
- 노트 데이터에 픽셀 값이 저장되지 않았다.
- 드래그 중 곡 전체를 매 프레임 교체하지 않는다. 커밋은 `pointerup`에서 한 번.
- 소리를 내는 진입점이 사용자 제스처 안에 있다.
- Tailwind 클래스를 직접 쓴다. `cn()` 헬퍼나 컴포넌트 라이브러리가 도입되지 않았다.
- 컨트롤에 텍스트가 들어간다. 요청하지 않은 설명 문구가 없다.
- 재생/정지·뮤트/솔로가 실제 `<button>`이다.

## Security and Configuration

- 비밀값이나 호스트가 하드코딩되지 않았다 (PreToolUse 훅이 일반적인 시크릿 패턴을 막는다 — 우회하지 않는다).
- 에셋 경로가 `public/`에 실제 존재하는 파일을 가리킨다.

## Documentation Sync

- 구현이 `.claude/rules/*.md`에서 "계획"으로 표시된 구조를 처음 만들었다면, 그 문서가 사실로 갱신됐다.
- 비주얼 언어(팔레트, 패널 스타일)를 처음 정했다면 `ui-conventions.md`에 기록됐다.

## Validation

- `pnpm lint`, `pnpm check-types`, `pnpm build`가 가능한 한 실행됐다.
- 동작이 바뀌었으면 앱을 실제로 띄워 **들어봤다**.
- 검사를 건너뛰었으면 블로커와 잔여 위험이 보고됐다.
