---
description: 'Root-cause debugging, boundary tracing, and fix discipline rules for Bandline bugs, audio failures, validation failures, and scripts.'
paths:
  - 'app/**/*'
  - 'components/**/*'
  - 'lib/**/*'
  - 'state/**/*'
  - '.claude/**/*.sh'
  - '.claude/skills/systematic-debugging/**/*'
---

# Debugging Rules

버그, 빌드 실패, 타입 오류, 그리고 "소리가 이상하다" 계열 문제에 쓴다.

## 근본 원인 먼저

증상을 덮기 전에 원인을 특정한다.

코드를 바꾸기 전에:

1. 에러 출력 전문을 읽는다. 오디오 문제면 브라우저 콘솔의 Web Audio 경고도 본다.
2. 재현하거나, 왜 재현이 안 되는지 밝힌다. 오디오 버그는 **언제** 나는지가 결정적이다 — 처음부터인지, 몇 마디 뒤부터인지, 트랙을 늘렸을 때인지, 특정 악기에서만인지.
3. 최근 diff와 관련 호출부를 확인한다.
4. 깨진 경로를 같은 저장소의 동작하는 패턴과 비교한다.
5. 편집 전에 검증 가능한 가설 하나를 말로 만든다.

## 경계 추적

버그 대부분은 세 계층 경계 중 하나에 있다 (`frontend-architecture.md` 참고). 편집 전에 전체 사슬을 훑는다.

소리가 아예 안 날 때:

```text
사용자 제스처 -> AudioContext 생성 -> ctx.state === 'running' 인가 (suspended면 여기서 끝)
  -> 샘플/악기 로드 완료됐나 -> 스케줄러가 돌고 있나 -> 노트를 찾아서 예약했나
  -> 노드가 destination까지 연결됐나 -> 마스터 게인이 0은 아닌가 -> 트랙이 뮤트는 아닌가
```

박자가 밀리거나 흔들릴 때:

```text
노트의 음악적 시간(틱) -> 템포로 초 변환 -> 예약 시각이 ctx.currentTime 기준 절대값인가
  -> setTimeout/rAF로 직접 울리고 있지 않은가 -> lookahead가 충분한가
  -> 메인 스레드가 재생 중 무거운 작업으로 막히지 않았나
```

편집한 게 안 들릴 때:

```text
편집 UI의 setState -> 곡 데이터가 새 객체로 교체됐나(제자리 변형 아님)
  -> 엔진이 그 변경을 언제 읽는가 -> 이미 예약된 구간이라 다음 틱에 반영되는 게 정상 아닌가
```

빌드/타입 실패:

```text
첫 번째 에러 -> 소유 파일 -> import/타입 사슬 -> 최근 diff -> 같은 패턴의 동작하는 파일
```

## 오디오 쪽 상습범

React를 의심하기 전에 여기부터 본다.

- **`AudioContext`가 `suspended`.** 자동재생 정책 때문에 사용자 제스처 없이는 소리가 안 난다. "재생 버튼을 눌렀는데 무음"의 1순위 원인. `ctx.state`를 먼저 찍어 본다.
- **모듈 스코프의 `new AudioContext()`.** SSR/빌드 중 실행돼 `AudioContext is not defined`로 깨진다. `use client`가 있어도 모듈 최상위는 서버에서 평가될 수 있다.
- **`setTimeout`/`rAF`로 노트를 직접 울리고 있음.** 타이밍이 흔들리는 문제의 거의 유일한 근본 원인이다. look-ahead 스케줄러로 `ctx.currentTime` 절대 시각에 예약해야 한다 (`audio-engine.md`).
- **`start()`한 노드를 재사용.** `OscillatorNode`/`AudioBufferSourceNode`는 일회용이다. 두 번째 `start()`는 예외를 던지거나 무음이 된다.
- **노드 누수.** `disconnect()`를 안 하면 긴 재생에서 노드가 쌓여 점점 느려지고 결국 끊긴다. "처음엔 괜찮은데 몇 분 지나면 이상해짐" 증상.
- **`exponentialRampToValueAtTime(0, ...)`.** 목표값 0은 예외를 던진다. 무음 엔벨로프가 통째로 실패하는 원인.
- **클리핑.** 5개 악기가 동시에 울리면 합산 진폭이 1.0을 넘어 지직거린다. 소리가 "깨진다"면 마스터 게인부터 본다.
- **부동소수 드리프트.** 재생 위치를 `pos += delta`로 누적하면 몇 분 뒤 박자가 어긋난다. 정수 틱에서 계산해야 한다.
- **초 단위로 저장된 노트.** 템포를 바꾼 뒤에만 어긋난다면 이게 원인이다.

## 수정 규율

- 한 번에 하나의 근본 원인만 고친다.
- 버그 수정에 정리 작업을 끼워 넣지 않는다.
- 두 번 고쳐서 안 되면 멈추고 가설을 다시 세운다.
- 순수 로직 버그(시간 변환, 스케줄러 구간 선택)는 브라우저 없이 확인한다. 재생·렌더 버그는 `pnpm dev`로 **실제로 들어보고** 확인한다 — 타입 검사가 통과했다는 건 소리에 대해 아무 말도 하지 않는다.
