---
name: audio-engine
description: 'Implement and review Bandline audio: AudioContext lifecycle, look-ahead scheduling, transport, the Web Audio node graph, instruments (piano, acoustic/electric guitar, drums, bass), sample loading, polyphony, and the lib/score musical data model. Use for any playback, timing, sound, or instrument work.'
---

# Audio Engine

소리가 나는 부분을 만들거나 고칠 때 쓴다. 기준 문서는 `.claude/rules/audio-engine.md`이며 이 스킬은 그것을 작업 순서로 옮긴 것이다.

## 시작 전에

1. `.claude/rules/audio-engine.md`를 읽는다.
2. `lib/audio/`와 `lib/score/`의 현재 상태를 확인한다. **아직 없으면 새로 만드는 것이다** — `.claude/rules/frontend-architecture.md`의 구조를 따른다.
3. UI가 엔진의 어떤 API에 의존하고 있는지 확인한다 (`state/StudioProvider.tsx`). 그 API를 깨면 UI도 같이 고쳐야 한다.

## 계층 규칙

```text
lib/score/  곡 데이터. Web Audio도 React도 import하지 않는다. 브라우저 없이 검증 가능.
lib/audio/  엔진. React를 import하지 않는다. AudioContext와 재생 상태를 소유한다.
```

UI는 명령형 메서드로만 엔진을 건드린다 (`play()`, `stop()`, `seek()`, `setTempo()`). 엔진은 리렌더를 일으키지 않는다.

## AudioContext

- 앱 전체에 하나. 컴포넌트나 악기마다 만들지 않는다.
- **모듈 스코프에서 생성 금지.** SSR/빌드에서 `AudioContext is not defined`로 깨진다. 첫 사용자 제스처에서 지연 생성한다.
- 제스처 핸들러 안에서 `await ctx.resume()`. 이게 없으면 자동재생 정책 때문에 무음이다.
- 탭 복귀 시 `ctx.state`를 다시 확인한다.

## 스케줄링

노트를 `setTimeout`/`rAF`로 하나씩 울리지 않는다. look-ahead 패턴:

```text
느린 틱(≈25ms setInterval 또는 Worker)
  -> [scheduledUntil, ctx.currentTime + lookahead) 구간의 노트를 찾는다
  -> ctx.currentTime 기준 절대 시각으로 예약: source.start(when), gain.setValueAtTime(v, when)
  -> scheduledUntil을 전진시킨다
```

- 예약 시각은 항상 `ctx.currentTime` 기준. `Date.now()`, `performance.now()`, rAF 타임스탬프를 섞지 않는다.
- lookahead를 늘리면 안정적이지만 템포·시크 반응이 느려진다. 선택한 값과 이유를 주석에 남긴다.
- 틱 안에서 전체 노트를 스캔하지 않는다. 시간순 정렬 + 커서 인덱스.
- 화면 플레이헤드는 별개다. rAF에서 `ctx.currentTime`을 읽어 그린다.

## 음악적 시간

- 노트는 정수 틱(PPQ 기준)으로 저장한다. **초로 저장하지 않는다** — 템포 변경 시 곡 전체가 어긋난다.
- 초 변환은 예약 직전에 현재 템포로 한 번만.
- 재생 위치를 `pos += delta`로 누적하지 않는다. 정수 틱에서 계산한다.
- 템포 변경 시 이미 예약된 노트는 그대로 울린다. 새 템포 적용 시점(보통 다음 틱)을 정하고 지킨다.

## 노드와 보이스

- `OscillatorNode`/`AudioBufferSourceNode`는 일회용. 노트마다 새로 만든다.
- 정리 경로를 반드시 만든다: `stop(when)` 예약 + `onended`에서 `disconnect()`. 없으면 긴 곡에서 노드가 쌓여 샌다.
- 엔벨로프는 `setValueAtTime` / `linearRampToValueAtTime` / `exponentialRampToValueAtTime`로 예약한다. **`exponentialRampToValueAtTime`의 목표값은 0이 될 수 없다** — 작은 양수 뒤 `setValueAtTime(0, ...)`.
- 동시 발음 상한을 두고, 초과 시 가장 오래된 보이스를 페이드아웃해 훔친다.
- 마스터 게인 스테이지를 둔다. 악기 5종이 겹치면 합산 진폭이 1.0을 쉽게 넘어 클리핑한다.

## 악기

피아노 / 어쿠스틱 기타 / 일렉기타 / 드럼 / 베이스를 지원하는 것이 목표다.

- 악기마다 공통 인터페이스를 두고(노트 온/오프, 벨로시티, 예약 시각) 구현을 갈아끼울 수 있게 한다. 합성으로 시작해 샘플로 바꾸더라도 호출부가 안 바뀌게.
- 샘플 기반이면 **한 번만 디코드해 `AudioBuffer`로 캐시**한다. 노트마다 `decodeAudioData`를 부르지 않는다.
- 첫 재생 전에 필요한 샘플 로드를 보장하고, 로딩 상태를 UI에 노출한다.
- 샘플 세트는 용량이 크다. 악기별 지연 로딩과 총 다운로드 예산을 계획에 적는다.
- 드럼은 피치가 아니라 슬롯(킥/스네어/하이햇...) 단위다. 피치 악기와 같은 데이터 모델을 억지로 쓰지 말고, `lib/score/`에서 트랙 타입으로 구분한다.
- `public/samples/` 경로는 실제 존재하는 파일을 가리켜야 한다.

## AudioWorklet

쓴다면:

- `process()`는 오디오 스레드에서 128프레임마다 돈다. **할당 금지** — 객체·배열·클로저 생성 금지. GC가 돌면 끊긴다.
- `console.log`, `fetch`, React, DOM 접근 금지. 메인 스레드와는 `port.postMessage`로만.
- 별도 파일로 `audioWorklet.addModule()` 해야 한다. Next.js 번들러가 이 파일을 어떻게 다루는지 확인하고 경로를 고정한다.

## 검증

```bash
pnpm lint
pnpm check-types
pnpm build
```

정적 검사는 소리에 대해 아무 말도 하지 않는다. 그다음:

1. `pnpm dev`로 띄우고 재생을 눌러 **첫 소리가 나는지** 확인한다.
2. 메트로놈과 함께 30초 이상 재생해 드리프트가 없는지 듣는다.
3. 악기를 여러 개 올리고 동시 발음이 많은 구간에서 끊김·지직거림을 확인한다.
4. 재생 중 편집, 시크, 템포 변경을 각각 눌러 본다.
5. 몇 분간 재생해 두고 점점 느려지지 않는지 본다 (노드 누수 검출).

들어보지 못했으면 그렇게 적는다.
