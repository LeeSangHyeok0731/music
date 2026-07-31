---
name: quality-gate
description: 'Verify Bandline changes with pnpm lint, pnpm check-types, pnpm build, plus layer-boundary review, audio-state ownership review, scheduling review, and actually playing the app and listening. Use after implementation, during reviews, for reruns, and whenever a task risks regressions.'
---

# Quality Gate

최종 전달 전에 변경을 검증하는 데 쓴다.

## Rule Loading

정적 리뷰 전에 하네스 규칙을 찾아 읽는다:

```bash
find .claude/rules -name "*.md" 2>/dev/null
```

`CLAUDE.md`, `AGENTS.md`, 주변 소스 패턴과 함께 쓴다.

## Minimum Commands

가능하면 전부 돌린다:

```bash
pnpm lint
pnpm check-types
pnpm build
```

실패하면 원인이 이번 변경인지, 환경인지, 기존 저장소 상태인지 구분해 각각 보고한다.

## Static Review Checklist

- 계층 경계: `lib/score/`가 Web Audio/React를 import하지 않음. `lib/audio/`가 React를 import하지 않음. `components/`가 엔진 내부를 직접 폴링하지 않음.
- `use client`가 훅/브라우저 API를 쓰는 모든 파일에 있음.
- 모듈 스코프에 `new AudioContext()` 없음. 사용자 제스처 이후 지연 생성 + `resume()` 경로.
- 플레이헤드·예약 큐·보이스가 `useState`에 없음. 매 프레임 `setState` 없음. `useState` 객체 제자리 변형 없음.
- 노트를 `setTimeout`/`rAF`로 직접 울리지 않음. 예약이 `ctx.currentTime` 절대 시각.
- 노트가 정수 틱으로 저장됨. 재생 위치가 부동소수 누적이 아님.
- `start()`한 노드 재사용 없음. 노드마다 `disconnect()` 경로 존재.
- `exponentialRampToValueAtTime` 목표값이 0이 아님.
- 동시 발음 상한과 마스터 게인 스테이지 존재.
- 샘플이 한 번만 디코드돼 캐시됨. `public/samples/` 경로가 실제 파일을 가리킴.
- 플레이헤드 이동이 노트 리렌더를 유발하지 않음. 화면 밖 노트를 그리지 않음.
- 하드코딩된 비밀값 없음.

## Runtime Check

정적 검사는 소리가 맞는지 알려주지 않는다. 동작이나 소리가 바뀌었으면:

1. `pnpm dev` 실행.
2. 재생을 눌러 **첫 소리가 나는지** 확인한다 (자동재생 정책 회귀의 유일한 검출 방법).
3. 메트로놈과 함께 30초 이상 재생해 박자 드리프트를 듣는다.
4. 악기를 여러 개 올리고 동시 발음이 많은 구간에서 끊김·지직거림을 듣는다.
5. 재생 중 편집, 시크, 템포 변경을 각각 실행한다.
6. 몇 분 재생해 두고 점점 느려지지 않는지 본다 (노드 누수 검출).
7. 이번 변경이 건드린 경로를 구체적으로 실행한다.

이 환경에서 앱을 띄울 수 없으면 명시하고 잔여 위험으로 남긴다 — 검증된 것처럼 쓰지 않는다.

## Reporting Format

이 순서로 보고한다:

1. 블로킹 이슈
2. 비블로킹 위험
3. 실행한 명령
4. 잔여 위험 (해당하면 "실제로 들어보지 못함" 포함)

발견 사항이 없으면 그렇게 말하고, 그래도 수행한 검사를 나열한다.
