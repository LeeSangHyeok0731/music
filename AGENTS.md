<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Bandline

브라우저에서 곡 아이디어를 스케치하고 재생하는 웹 시퀀서. 피아노 / 기타 / 베이스 / 드럼 4종을 다룬다.

## 현재 상태

음악 비전공자의 아이디어 스케치 도구로 **재구상 중**이다. 곡은 "코드·패턴 클립"과 "음 클립"으로 만들고, 브라우저에서 샘플 음원으로 재생한다. 하위 프로젝트 1(코어 모델 + 샘플 엔진)은 계획 Task 1~14까지 구현됐고, Task 15(실제 CC0 샘플 팩·`public/samples/LICENSES.md`·용량 예산 테스트·샘플 파일 형식과 Safari 디코드 결정)와 사람의 직접 청취가 남았다. Task 15는 **사람이 필요하다**(팩 선정·라이선스 확인·청취·Safari) — 에이전트가 혼자 시도하거나 팩 이름·라이선스를 지어내지 않는다(`docs/known-gaps.md`).

설계는 `docs/superpowers/specs/2026-11-20-core-model-sample-engine-design.md`(이하 spec)에 있다. 같은 폴더의 그 이전 날짜 문서는 철거된 옛 설계다.

**지금 있는 것:**
- `lib/score/` — 곡 모델 v2(`model.ts`), 틱·마디 변환(`time.ts`: `ticksPerBar`/`songLengthTicks` 등), 코드 음정(`chords.ts`), 패턴 카탈로그(`patterns.ts`), 펼치기·베이크(`expand.ts`: `expandSong`/`bakeClip`), 불변식 검증(`validate.ts`: `validateSong`), zod 스키마와 복구(`song-schema.ts`: `parseSong`), 8마디 데모 곡(`demo-song.ts`), 실행취소 순수 규칙(`history.ts`)
- `lib/audio/` — AudioContext, look-ahead 스케줄러, 보이스 풀, 메트로놈, `SampleBank`(`samples/`), 샘플 악기(`instruments/sampler.ts`), `Engine`
- `components/verify/VerifyScreen.tsx` — `/`의 소리 확인 화면

편집 UI와 `state/` 계층은 **없다**(옛 것은 철거했다).

**곡 모델의 규칙** (상세는 spec 3절)
- 시간은 `PPQ = 480` 정수 틱이고, 음의 `start`는 클립 기준 상대 틱이다. 곡 길이는 `bars × ticksPerBar`(`bars` 1~500)이고, 박자표는 분자 1~32 / 분모 1·2·4·8·16·32로 제한한다(3.1절).
- **같은 트랙의 클립은 겹치지 않는다.** 화음은 `notes` 클립 안에서 된다.
- **패턴 id는 불변이다.** 고치려면 새 id를 만든다. 패턴별 스냅샷·고정 id 목록·깊은 freeze가 지킨다. 패턴을 추가하면 로컬에서 스냅샷을 기록해 함께 커밋한다 — CI는 스냅샷을 새로 쓰지 않는다(3.3절).
- 재생은 `expandSong`으로 펼친 이벤트를 쓴다. 오디오 내보내기(하위 프로젝트 4)도 같은 함수를 써야 한다.

**엔진 계약** (상세는 spec 4절)
- **템포는 `song.tempo`가 유일한 진실이다.** `Engine.setSong`이 곡·이벤트·템포·악기 맵을 한 번에 맞춘다.
- **재생 중에는 곡을 바꿀 수 없다.** `setSong`은 `false`를 돌려주고 아무것도 바꾸지 않는다(재생 중 허용되는 것은 `setTempo`뿐). `play()`가 컨텍스트 재개(`ensureRunning`)와 샘플 로딩을 기다리는 동안에도 `false`이고 `isPlaying()`은 `true`다. 편집 UI는 이 구간을 "재생 중"으로 표시하지 말고 `false`를 반드시 처리해야 한다.
- 타입이 맞는 `Song` 기준으로, `setSong`이 던지는 것은 패턴이 잘못된 곡(모르는 패턴 id, 트랙 악기와 맞지 않는 패턴)뿐이고 그때 엔진은 그대로다. 겹침·`bars`·박자표·정수 틱 같은 나머지 불변식은 검사하지 않는다. 파일·링크처럼 믿을 수 없는 입력은 반드시 `parseSong`을 거친다(모르는 quality·악기·패턴·버전을 거부한다) — `validateSong`은 이미 타입이 맞는 곡의 구조 불변식만 보며(`chord.quality`는 보지 않아, 모르는 값은 `chordPitch`에서 TypeError) `parseSong`의 대체가 아니다.
- `play()`는 `PlayResult`를 돌려준다. 곡이 쓰는 악기의 샘플 준비(다운로드·디코드)가 끝나야 시작하고, 준비에 실패한 악기가 있으면 `not-ready`다. 샘플은 AudioContext 없이 `prefetch`로 받고(생성자·`setSong`이 부른다) 디코드는 컨텍스트가 생긴 `play()`에서 한다. `play()`의 await는 둘이고 `ensureRunning`이 먼저(사용자 제스처 안)이며 그다음이 `bank.ensureReady`다 — 각각 뒤에서 세션 번호를 다시 확인한다.

아직 없는 것: **편집 UI(하위 프로젝트 2), 링크 공유·서명 검증·모바일 재생 뷰(3), 오디오 내보내기(4), 악보 PDF 가져오기(5)**, 곡 파일 저장·불러오기 UI(곡을 읽는 `parseSong`만 있다), 다시실행, 루프, 시크, 줌. 실제 샘플 팩도 없다 — `public/samples/`는 gitignore이고 개발용 톤을 `pnpm gen:dev-samples`로 만든다.

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

**무엇이 검증되지 않는지는 `docs/known-gaps.md`에 있다.** vitest는 `lib/**`를 node로, `components/**`·`state/**`를 jsdom으로 돌리지만, jsdom 쪽 테스트는 아직 소리 확인 화면(`components/verify/VerifyScreen.test.tsx`) 하나뿐이다. 옛 설계의 심각한 결함은 전부 테스트가 없던 UI·상태 계층에서 나왔다 — 편집 UI가 `components/`·`state/`에 들어올 때 규칙이 든 로직은 `lib/`의 순수 함수로 빼고, 그쪽 코드를 고쳤다면 통과한 검사 목록을 근거로 삼지 말 것.
