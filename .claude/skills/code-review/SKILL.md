---
name: code-review
description: 'Review Bandline changed files using dynamically discovered .claude/rules, layer boundaries, audio-state vs React-state ownership, scheduling correctness, Web Audio node lifecycle, render cost, and validation results. Use for code review requests, staged diff review, pre-PR review, and after multi-file implementation.'
---

# Code Review

변경된 소스나 하네스 파일을 구조적으로 리뷰할 때 쓴다.

## Step 1: Load Rules

규칙을 동적으로 찾는다:

```bash
find .claude/rules -name "*.md" 2>/dev/null
```

반환된 파일을 전부 읽는다. `CLAUDE.md`와 `AGENTS.md`도 유효하다. 충돌 시 우선순위:

```text
AGENTS.md > CLAUDE.md > .claude/rules/** > 주변 소스 패턴
```

다중 파일 리뷰나 PR 전 점검이면 `${CLAUDE_SKILL_DIR}/references/review-checklist.md`도 읽는다.

## Step 2: Determine Review Scope

- 스테이징 리뷰: `git diff --staged`
- 워킹 트리 리뷰: `git diff`
- 브랜치 리뷰: 가능하면 `main`과 비교
- 파일 지정 리뷰: 지정된 파일과 직접 의존성을 확인

## Step 3: Review Checklist

변경 파일에 해당하는 것만 확인한다:

- **계층 경계**: `lib/score/`가 Web Audio/React를 import하지 않음, `lib/audio/`가 React를 import하지 않음, `components/`가 엔진 내부를 직접 폴링하지 않음, `use client` 위치.
- **AudioContext**: 모듈 스코프 생성 없음, 사용자 제스처 이후 지연 생성, `resume()` 경로 존재.
- **스케줄링**: `setTimeout`/`rAF`로 노트를 직접 울리지 않음, 예약이 `ctx.currentTime` 절대 시각, lookahead가 틱 간격보다 큼.
- **음악적 시간**: 정수 틱 저장, 부동소수 누적 없음, 초 변환이 예약 직전 한 번.
- **상태 소유권**: 매 프레임 값이 `useState`에 없음, `useState` 객체 제자리 변형 없음, 매 프레임 `setState` 없음.
- **노드 수명주기**: 일회용 노드 재사용 없음, `disconnect()` 경로 존재, `exponentialRampToValueAtTime` 목표값이 0 아님.
- **믹싱**: 동시 발음 상한, 마스터 게인 스테이지.
- **샘플**: 한 번만 디코드해 캐시, `public/samples/` 경로가 실제 파일.
- **렌더 비용**: 플레이헤드 이동이 노트 리렌더를 유발하지 않음, 화면 밖 노트 미렌더, 드래그 중 곡 전체 교체 없음.
- 검증 명령 실행 여부와 잔여 위험.
- **규칙 문서 동기화**: 구현이 "계획"으로 표시된 구조나 비주얼 언어를 처음 확정했다면 `.claude/rules/*.md`가 갱신됐는지 확인한다.

## Report Format

발견 사항을 먼저 쓴다:

```markdown
## Findings

- [High|Medium|Low] `path:line` — 문제, 영향, 제안하는 수정

## Open Questions

- 실제 블로커나 가정만

## Checks

- 수행한 명령과 정적 검사
```

문제가 없으면 분명히 말하고 검증되지 않은 것을 언급한다 — 보통 실제 재생 동작, 타이밍 정확도, 부하 시 끊김 여부.
