---
name: systematic-debugging
description: 'Investigate Bandline bugs, build failures, lint failures, type errors, runtime errors, silent playback, timing drift, audio glitches, and edits that do not take effect by finding root cause before fixes. Use whenever debugging, build failure, regression, or unclear behavior is mentioned.'
---

# Systematic Debugging

버그나 검증 실패를 고치기 전에 쓴다.

## Rule

코드를 편집하기 전에 근본 원인을 찾는다. 증상만 가리는 빠른 패치는 수정이 아니다.

## Phase 1: Evidence

1. 에러, 경고, 스택 트레이스, 사용자 재현 절차 전문을 읽는다. 오디오 문제면 브라우저 콘솔의 Web Audio 경고도 본다.
2. 재현 가능한지 확인한다. **오디오 버그는 언제 나는지가 결정적이다** — 처음부터인지, 몇 마디 뒤인지, 트랙/악기를 늘렸을 때인지, 특정 악기에서만인지, 오래 재생했을 때인지.
3. 최근 diff와 직접 관련된 파일을 확인한다.
4. 동작하는 로컬 패턴과 비교한다.
5. 근본 원인 가설 하나를 말한다.

## Phase 2: Boundary Trace

해당하는 추적을 고른다:

```text
무음:      사용자 제스처 -> AudioContext 생성 -> ctx.state === 'running'? -> 샘플 로드됨?
             -> 스케줄러 틱이 도는가 -> 구간 안 노트를 찾았나 -> destination까지 연결됐나
             -> 마스터 게인 -> 트랙 뮤트/솔로
타이밍:    정수 틱 -> 템포로 초 변환 -> ctx.currentTime 절대 시각 예약인가
             -> setTimeout/rAF로 직접 울리고 있지 않은가 -> lookahead 충분한가
             -> 메인 스레드가 막히지 않았나
편집 반영: setState -> 곡 데이터가 새 객체로 교체됐나 -> 엔진이 언제 다시 읽나
             -> 이미 예약된 구간이라 다음 틱 반영이 정상 아닌가
빌드/타입: 첫 컴파일러 에러 -> 소유 파일 -> import/타입 사슬 -> 최근 diff
```

경계를 둘 이상 넘는 실패는 수정을 제안하기 전에 `${CLAUDE_SKILL_DIR}/references/root-cause-tracing.md`를 읽는다.

## Phase 3: Minimal Fix

- 가설을 다루는 한 가지만 바꾼다.
- 정리 작업이나 리팩터링을 끼워 넣지 않는다.
- **순수 로직 버그(시간 변환, 스케줄러 구간 선택, 샘플 뱅크·엔진 경합)는 실패하는 vitest 테스트를 먼저 쓴다** (`pnpm test`). 소리·렌더 버그는 테스트로 잡히지 않으므로 수정을 검증하는 가장 작은 수동 경로를 문서로 남긴다 — 어떤 버튼을 누르고, **무엇을 들어야** 하는지.

## Phase 4: Verification

가장 작은 의미 있는 검사를 먼저, 그다음 넓은 게이트:

```bash
pnpm lint
pnpm check-types
pnpm build
```

그다음 `pnpm dev`로 실제 동작을 확인한다 — 타입 검사가 통과했다는 건 소리가 나는지에 대해 아무 말도 하지 않는다.

환경 제약으로 검사를 못 돌렸으면 그 제약을 코드 위험과 분리해 보고한다.
