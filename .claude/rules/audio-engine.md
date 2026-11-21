---
description: 'Web Audio lifecycle, look-ahead scheduling, musical time, voice/node management, and sample loading rules for Bandline audio code.'
paths:
  - 'lib/audio/**/*'
  - 'lib/score/**/*'
  - 'state/**/*'
  - 'components/studio/**/*'
  - '.claude/skills/audio-engine/**/*'
---

# Audio Engine Rules

브라우저 오디오는 UI 코드와 실패 방식이 다르다. 여기 있는 규칙은 대부분 "안 지키면 소리가 밀리거나, 튀거나, 아예 안 난다"는 종류다.

## AudioContext 수명주기

- **AudioContext는 앱 전체에 하나.** 컴포넌트마다, 악기마다 만들지 않는다. 브라우저는 동시 컨텍스트 수를 제한하고, 여러 개면 시간축이 서로 다르다.
- **모듈 스코프에서 `new AudioContext()`를 호출하지 않는다.** 서버 렌더링/빌드 중에 실행되어 `AudioContext is not defined`로 깨진다. 지연 생성(첫 사용자 제스처 시점)만 허용한다.
- 브라우저 자동재생 정책상 컨텍스트는 `suspended` 상태로 시작한다. **사용자 제스처(클릭·키다운) 핸들러 안에서 `await ctx.resume()`** 을 호출해야 소리가 난다. "재생 버튼을 눌렀는데 아무 일도 안 남" 버그의 1순위 원인이다.
- 탭이 백그라운드로 가면 컨텍스트가 다시 suspend될 수 있다. 복귀 시 상태를 확인한다.

## 스케줄링 — 가장 중요한 규칙

**노트를 `setTimeout`이나 `requestAnimationFrame`으로 하나씩 울리지 않는다.** 두 타이머 모두 메인 스레드에 묶여 있어 수십 ms씩 밀리고, 사람은 그 흔들림을 리듬 오류로 듣는다.

look-ahead 스케줄러 패턴을 쓴다 (Chris Wilson, *A Tale of Two Clocks*):

```text
느린 타이머(≈25ms 간격 setInterval 또는 Worker)
  -> 지금부터 lookahead 구간(≈100ms) 안에 시작하는 노트를 모두 찾는다
  -> 각 노트를 audioContext.currentTime 기준 절대 시각으로 예약한다
       osc.start(when) / source.start(when) / gain.gain.setValueAtTime(v, when)
  -> 예약 커서를 전진시킨다
```

- 예약에 쓰는 시각은 **항상 `audioContext.currentTime` 기준의 절대 초**다. `Date.now()`, `performance.now()`, rAF의 timestamp를 오디오 예약에 섞지 않는다.
- 한 번 예약한 노드는 타이머가 늦어도 정확한 시각에 울린다. 타이머의 역할은 "충분히 미리 예약했는가"뿐이다.
- lookahead 구간을 늘리면 안정적이지만 템포·시크 변경 반응이 느려진다. 트레이드오프를 코드 주석에 남긴다.
- 화면의 플레이헤드는 별개다. rAF에서 `audioContext.currentTime`을 읽어 그린다 — 오디오 예약 로직과 공유하지 않는다.

## 음악적 시간 vs 실제 시간

- 노트는 **음악적 시간**(마디/박/틱, 또는 PPQ 정수)으로 저장한다. **초로 저장하지 않는다.** 초로 저장하면 템포를 바꾸는 순간 곡 전체가 어긋난다.
- 초 변환은 예약 직전에 현재 템포로 한 번만 한다.
- 부동소수 누적 오차를 피한다. 재생 위치를 `pos += delta`로 굴리지 말고 정수 틱 카운터에서 계산한다.
- 템포 변경 시 이미 예약된 노트는 그대로 울린다. 어디서부터 새 템포를 적용할지(보통 다음 스케줄 틱) 정하고 지킨다.

## 노드와 보이스 관리

- `OscillatorNode`와 `AudioBufferSourceNode`는 **일회용**이다. `start()`한 노드는 재사용할 수 없다. 노트마다 새로 만든다.
- 만든 노드는 반드시 정리한다. `stop(when)` 예약 + `onended`에서 `disconnect()`. 이걸 빼먹으면 긴 곡에서 노드가 수천 개 쌓여 메모리와 CPU가 샌다.
- 엔벨로프는 `setValueAtTime` / `linearRampToValueAtTime` / `exponentialRampToValueAtTime`으로 예약한다. **`exponentialRampToValueAtTime`의 목표값은 0이 될 수 없다** (예외 발생) — `0.0001` 같은 작은 값을 쓰고 그 뒤에 `setValueAtTime(0, ...)`.
- 동시 발음 수(polyphony)에 상한을 둔다. 드럼 연타나 코드 스트로크에서 보이스가 무제한으로 늘면 클리핑과 CPU 스파이크가 난다. 상한 초과 시 가장 오래된 보이스를 페이드아웃시켜 훔친다(voice stealing).
- 마스터 출력 앞에 게인 스테이지를 둔다. 악기 4종이 동시에 울리면 합산 진폭이 1.0을 쉽게 넘어 디지털 클리핑이 난다.

## AudioWorklet

- `AudioWorkletProcessor.process()`는 **오디오 스레드**에서 128프레임마다 돌아간다. 그 안에서 **할당하지 않는다** — 객체 생성, 배열 생성, 클로저 생성 금지. GC가 돌면 버퍼를 놓치고 뚝뚝 끊긴다.
- worklet 안에서 `console.log`, `fetch`, React, DOM 접근 금지. 메인 스레드와는 `port.postMessage`로만 통신한다.
- worklet 모듈은 별도 파일로 `audioWorklet.addModule()` 해야 한다. Next.js 번들러가 이 파일을 어떻게 다루는지 확인하고 경로를 고정한다.

## 샘플 로딩

- 피아노·기타·드럼·베이스 샘플은 **한 번만 디코드해서 `AudioBuffer`로 캐시**한다. 노트마다 `decodeAudioData`를 부르지 않는다 — 디코드는 비싸고 비동기다.
- 첫 재생 전에 필요한 샘플이 다 로드됐는지 보장한다. 로딩 중 상태를 UI에 노출한다.
- 샘플 세트는 용량이 크다. 악기별 지연 로딩과 총 다운로드 예산을 계획에 명시한다.
- `public/samples/`의 경로는 실제 존재하는 파일을 가리켜야 한다.

## 성능 예산

- 오디오 글리치(뚝뚝 끊김)는 메인 스레드가 막혀서 나는 경우가 대부분이다. 재생 중에는 무거운 동기 작업(큰 배열 정렬, 레이아웃 스래싱, 대량 리렌더)을 하지 않는다.
- 피아노롤은 노트가 수천 개가 될 수 있다. 플레이헤드가 움직일 때마다 노트 전체가 리렌더되면 안 된다 — 플레이헤드는 transform만 바꾸는 별도 레이어로 분리한다.
- 스케줄러 틱 안에서 O(전체 노트) 스캔을 하지 않는다. 시간순 정렬 + 커서 인덱스로 다음 구간만 본다.

## 검증

- 타입 검사와 빌드는 소리에 대해 아무것도 증명하지 않는다. `pnpm dev`로 실제로 들어본다.
- 리듬 정확도는 눈이 아니라 귀로 확인한다. 메트로놈과 함께 30초 이상 재생해 드리프트가 없는지 본다.
- 악기를 4종 다 올리고 동시 발음이 많은 구간에서 끊김이 없는지 본다.
- 순수 로직(`lib/score/`의 시간 변환, 스케줄러의 구간 선택, `lib/audio/testing/`의 가짜 Web Audio로 도는 샘플 뱅크·엔진 경합 로직)은 `pnpm test`(vitest)가 덮는다. 이쪽 버그는 회귀 테스트를 쓰거나 늘린다. 소리 자체는 테스트로 검증되지 않으므로 반드시 들어본다.
