<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Bandline

브라우저에서 곡 아이디어를 스케치하고 재생하는 웹 시퀀서. 피아노 / 기타 / 베이스 / 드럼 4종을 다룬다.

## 현재 상태

음악 비전공자의 아이디어 스케치 도구로 **재구상 중**이다. 곡은 "코드·패턴 클립"과 "음 클립"으로 만들고, 브라우저에서 샘플 음원으로 재생한다. 재구상은 하위 프로젝트로 나뉘어 있고, 지금 끝난 것은 하위 프로젝트 1(코어 모델 + 샘플 엔진)이다. 설계는 `docs/superpowers/specs/2026-11-20-core-model-sample-engine-design.md`에 있다.

**지금 있는 것:**
- `lib/score/` — 곡 모델 v2(`model.ts`: `Song`/`Track`/`Clip`/`Note`), 코드 음정(`chords.ts`), 패턴 카탈로그(`patterns.ts`), 펼치기·베이크(`expand.ts`: `expandSong`/`bakeClip`), 불변식 검증(`validate.ts`), zod 스키마와 복구(`song-schema.ts`: `parseSong`), 8마디 데모 곡(`demo-song.ts`), 실행취소 순수 규칙(`history.ts`)
- `lib/audio/` — AudioContext, look-ahead 스케줄러, 보이스 풀, 메트로놈, `SampleBank`(`samples/`), 샘플 악기(`instruments/sampler.ts`), `Engine`
- `components/verify/VerifyScreen.tsx` — `/`에 뜨는 소리 확인 화면. 데모 곡 재생/정지, 템포, 메트로놈, 악기별 샘플 상태와 다시 시도. **편집 UI가 아니다**

편집 UI와 `state/` 계층은 **없다.** 옛 타임라인·피아노롤·상태 계층은 재구상에서 철거했다.

**곡 모델의 규칙**
- 시간은 `PPQ = 480` 정수 틱이다. 음의 `start`는 클립 시작 기준 **상대 틱**이다. 곡 길이는 `bars × ticksPerBar`로 파생한다(`lengthTicks` 필드는 없다). `bars`는 1~500(`MAX_BARS`).
- 박자표는 분자 1~32 정수(`MAX_BEATS_PER_BAR`), 분모 1·2·4·8·16·32(`BEAT_UNITS`)만 받는다. 렌더 비용 가드(500마디 × 유한한 마디 길이)이자 `ticksPerBeat`를 정수로 두기 위해서다.
- **같은 트랙의 클립은 겹치지 않는다.** 화음(같은 시각의 여러 음)은 `notes` 클립 안에서 항상 된다.
- **패턴 id는 불변이다.** 고치려면 새 id를 만든다 — 아니면 이미 공유된 곡의 소리가 말없이 달라진다. `lib/score/patterns.test.ts`의 패턴별 스냅샷(내용 변경)과 `FROZEN_PATTERN_IDS`(삭제), `patterns.ts`의 모듈 로드 시 깊은 freeze(런타임 변형)가 지킨다. CI는 없는 스냅샷을 쓰지 않으므로 패턴을 추가하면 로컬에서 한 번 테스트를 돌려 스냅샷을 기록하고 함께 커밋한다. 패턴은 4/4 한 마디(1920틱) 기준이라 다른 박자에서는 마디선과 어긋난다(`docs/known-gaps.md`).
- 재생은 `expandSong`으로 편 이벤트를 쓴다. 오디오 내보내기(하위 프로젝트 4)도 같은 함수를 써야 한다.

**템포는 `song.tempo`가 유일한 진실이다.** `Engine.setSong`이 곡·이벤트·템포·악기 맵을 한 번에 맞추므로 호출부가 `setTempo`를 따로 부를 필요가 없다. `setSong`은 먼저 `expandSong`을 부르므로, 잘못된 곡이면 예외를 던지고 엔진은 아무것도 바뀌지 않는다 — 넘기기 전에 `validateSong`/`parseSong`으로 검증한다.

**재생 중에는 곡을 바꿀 수 없다.** 스케줄러의 트랙별 커서가 이벤트 인덱스라 재생 중 이벤트가 바뀌면 노트가 조용히 누락된다. 그래서 `setSong`은 재생 중 `false`를 돌려주고 아무것도 바꾸지 않는다. 재생 중 곡에 대해 허용되는 변경은 `setTempo`뿐이다. 이 `false`(그리고 `isPlaying() === true`)는 `play()`가 기다리는 구간 — 컨텍스트 재개와 **샘플 로딩 대기**까지 — 에도 해당한다. 앞으로의 편집 UI는 이 구간을 "재생 중"으로 표시하지 말고, `setSong`의 `false`를 반드시 처리해야 한다.

**샘플은 컨텍스트 없이 받고, 컨텍스트가 생긴 뒤에 디코드한다.** 엔진 생성자와 `setSong`이 `prefetch`로 파일만 받고, `play()`가 `ensureReady`로 디코드한다. `Engine.play()`는 `PlayResult`(`playing`/`already-playing`/`superseded`/`not-ready`)를 돌려주고, 곡이 쓰는 악기가 하나라도 준비되지 않으면 소리를 시작하지 않는다(`not-ready`). `play()`에는 await가 둘(`ensureRunning`, 샘플 준비)이고 둘 다 뒤에서 세션 번호를 다시 확인한다.

아직 없는 것: **편집 UI(하위 프로젝트 2), 링크 공유·서명 검증·모바일 재생 뷰(3), 오디오 내보내기(4), 악보 PDF 가져오기(5)**, 곡 파일 저장·불러오기 UI(곡을 읽는 `parseSong`만 있다), 다시실행, 루프, 시크, 줌. 실제 샘플 팩은 아직 커밋되지 않았다 — `public/samples/`는 gitignore이고, 개발용 톤을 `pnpm gen:dev-samples`로 만든다(실제 팩·`LICENSES.md`·예산 테스트는 계획 Task 15, 사람이 필요하다).

설계 근거는 `docs/superpowers/specs/`에 있다.

## 절대 규칙

- **Web Audio는 서버에서 실행되지 않는다.** `AudioContext`를 모듈 스코프에서 생성하면 SSR/빌드가 깨진다. 반드시 사용자 제스처 이후 지연 생성하고, 오디오를 만지는 파일에는 `use client`를 붙인다.
- **오디오 스케줄링에 `setTimeout`/`requestAnimationFrame`으로 노트를 하나씩 울리지 않는다.** look-ahead 스케줄러로 `audioContext.currentTime` 절대 시각에 미리 예약한다. 자세한 내용은 `.claude/rules/audio-engine.md`.
- **재생 중 매 프레임 값(플레이헤드 위치 등)은 `useState`에 넣지 않는다.** 오디오 상태와 React 상태의 소유권 경계는 `.claude/rules/frontend-architecture.md`에 있다.
- 패키지 매니저는 **pnpm**이다. `npm install` / `yarn`을 쓰지 않는다.

## 검증

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

정적 검사는 소리가 나는지 알려주지 않는다. 재생 동작이 바뀌었으면 `pnpm dev`로 실제로 들어보거나, 듣지 못했다고 명시할 것.

**무엇이 검증되지 않는지는 `docs/known-gaps.md`에 있다.** `state/`와 `components/`에는 테스트가 없어서 최근 세 슬라이스의 심각한 결함이 전부 그 계층에서 나왔다. 그쪽 코드를 고쳤다면 통과한 검사 목록을 근거로 삼지 말 것.
