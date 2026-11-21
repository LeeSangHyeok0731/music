<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Bandline

브라우저에서 곡 아이디어를 스케치하고 재생하는 웹 시퀀서. 피아노 / 기타 / 베이스 / 드럼 4종을 다룬다.

## 현재 상태

음악 비전공자의 아이디어 스케치 도구다. 곡은 "코드·패턴 클립"과 "음 클립"으로 만들고 브라우저에서 샘플 음원으로 재생한다. 하위 프로젝트 1(코어 모델 + 샘플 엔진)과 **2a(블록 조립 편집 화면)** 가 구현됐다. `public/samples/`에 CC0 샘플 팩(16비트 PCM 모노 22.05kHz WAV, 약 2.27MB)이 커밋돼 있고 `pnpm build:samples`로 고정 커밋의 원본에서 다시 만든다 — 출처·라이선스는 `public/samples/LICENSES.md`, 손으로 고치지 않는다. 기타는 일렉트릭 직결 녹음이다(CC0 어쿠스틱 기타를 찾지 못했다).

**검증되지 않은 것: 아무도 직접 조립해 들어 보지 않았다.** 코드 변경이 세 악기에 따라오는 음높이, 마디 중간 코드 변경, 패턴·템포 변경 소리는 모두 미확인이다. 통제자가 Chrome에서 레이아웃과 조작(드래그·팝오버·삭제·되돌리기·Space 재생/정지·자동 저장 복원)만 스모크 점검했고 소리는 듣지 못했다. Safari는 지원 대상이 아니다. 남은 것과 듣기 체크리스트는 `docs/known-gaps.md`.

설계는 `docs/superpowers/specs/`에 있다: 모델·엔진은 `2026-11-20-core-model-sample-engine-design.md`(§3 모델은 v3로 대체됨), 편집 화면과 v3 모델은 `2026-11-21-arrangement-editor-design.md`. 그 이전 날짜의 문서는 철거된 옛 설계다.

**지금 있는 것:**
- `lib/score/` — 곡 모델 v3(`model.ts`), 틱·마디 변환(`time.ts`), 코드 음정(`chords.ts`), 패턴 카탈로그(`patterns.ts`), 코드 진행 조회(`progression.ts`: `chordAt`), 펼치기·베이크(`expand.ts`: `expandSong`/`bakeClip`), 불변식 검증(`validate.ts`), zod 스키마와 복구(`song-schema.ts`: `parseSong`), 데모 곡(`demo-song.ts`), **편집 규칙(`edit.ts`)**, 실행취소 순수 규칙(`history.ts`, 50칸), 자동 저장 직렬화(`autosave.ts`), 마디 축소 판정(`bars.ts`), 패턴 표시 이름(`pattern-labels.ts`)
- `lib/audio/` — AudioContext, look-ahead 스케줄러, 보이스 풀, 메트로놈, `SampleBank`(`samples/`), 샘플 악기(`instruments/sampler.ts`), `Engine`
- `state/` — `StudioProvider`(Engine 하나·곡 히스토리·재생 상태 기계·자동 저장을 소유), `useStudio()`
- `components/studio/` — `/`의 편집 화면: 코드 진행 레인 + 고정 4트랙(피아노·기타·베이스·드럼, 추가·삭제 없음), 패턴 클립 추가·이동·길이·삭제, 코드·패턴 팝오버, 마디 1~64(UI 한도) 추가·삭제, 되돌리기(다시실행 없음), 단축키(Space, Ctrl/Cmd+Z, Delete/Backspace, Esc 겹겹이 닫기). 곡은 `localStorage` 키 `bandline:song:v3`에 자동 저장·복원한다

**규칙의 단일 출처:** 편집 규칙(스냅 960틱·클램프·겹침 방지·최소 길이)은 `lib/score/edit.ts`의 순수 함수에만 둔다. 같은 참조를 돌려주면 no-op이고, 결과는 항상 `validateSong`을 통과한다. 훅·컴포넌트에 규칙을 두지 않는다. **편집은 정지 중에만** 된다(엔진 `setSong`이 재생 중·재생 대기 중 `false`이므로).

**곡 모델의 규칙** (상세는 2026-11-21 spec 3절)
- **곡 모델은 v3다**(`SONG_VERSION = 3`, v2는 거부하고 마이그레이션하지 않는다). 코드 진행(`progression`)은 곡이 소유하고, 클립 본문은 `pattern`(패턴 id만) 또는 `notes`다. 진행은 곡 전체를 빈틈·겹침 없이 덮는다(`validateSong`이 검사). `expandSong(song)`은 시그니처 그대로이고, 각 스텝의 코드를 그 스텝의 절대 시각으로 진행에서 찾는다 — 마디 중간에서 코드가 바뀌면 그 시각의 스텝부터 새 코드다.
- 시간은 `PPQ = 480` 정수 틱이고, 음의 `start`는 클립 기준 상대 틱이다. 곡 길이는 `bars × ticksPerBar`(모델 `bars` 1~500, UI는 64까지)이고, 박자표는 분자 1~32 / 분모 1·2·4·8·16·32로 제한한다(2026-11-20 spec 3.1절). 편집 화면은 4/4만 다룬다.
- **같은 트랙의 클립은 겹치지 않는다.** 화음은 `notes` 클립 안에서 된다.
- **패턴 id는 불변이다.** 고치려면 새 id를 만든다. 패턴별 스냅샷·고정 id 목록·깊은 freeze가 지킨다. 패턴을 추가하면 로컬에서 스냅샷을 기록해 함께 커밋한다 — CI는 스냅샷을 새로 쓰지 않는다(2026-11-20 spec 3.3절).
- 재생은 `expandSong`으로 펼친 이벤트를 쓴다. 오디오 내보내기(하위 프로젝트 4)도 같은 함수를 써야 한다.

**엔진 계약** (상세는 2026-11-20 spec 4절)
- **템포는 `song.tempo`가 유일한 진실이다.** `Engine.setSong`이 곡·이벤트·템포·악기 맵을 한 번에 맞춘다.
- **재생 중에는 곡을 바꿀 수 없다.** `setSong`은 `false`를 돌려주고 아무것도 바꾸지 않는다(재생 중 허용되는 것은 `setTempo`뿐). `play()`가 컨텍스트 재개(`ensureRunning`)와 샘플 로딩을 기다리는 동안에도 `false`이고 `isPlaying()`은 `true`다. 편집 UI는 이 구간을 "재생 중"으로 표시하지 말고 `false`를 반드시 처리해야 한다.
- 타입이 맞는 `Song` 기준으로, `setSong`이 던지는 것은 패턴이 잘못된 곡(모르는 패턴 id, 트랙 악기와 맞지 않는 패턴)뿐이고 그때 엔진은 그대로다. 겹침·`bars`·박자표·정수 틱 같은 나머지 불변식은 검사하지 않는다. 파일·링크처럼 믿을 수 없는 입력은 반드시 `parseSong`을 거친다(모르는 `quality`·악기·패턴·버전을 거부한다) — `validateSong`은 이미 타입이 맞는 곡의 구조 불변식(진행이 곡을 덮는지, 코드 값 `invalid-chord` 포함)만 보며 `parseSong`의 대체가 아니다.
- `play()`는 `PlayResult`를 돌려준다. 곡이 쓰는 악기의 샘플 준비(다운로드·디코드)가 끝나야 시작하고, 준비에 실패한 악기가 있으면 `not-ready`다. 샘플은 AudioContext 없이 `prefetch`로 받고(생성자·`setSong`이 부른다) 디코드는 컨텍스트가 생긴 `play()`에서 한다. `play()`의 await는 둘이고 `ensureRunning`이 먼저(사용자 제스처 안)이며 그다음이 `bank.ensureReady`다 — 각각 뒤에서 세션 번호를 다시 확인한다.

아직 없는 것: **편집 UI의 나머지(하위 프로젝트 2b) — 음 단위 편집·피아노롤, 클립 복사/붙여넣기, 다시실행, 트랙 추가·삭제, 곡 파일 열기·저장 UI**, 루프·시크·줌, **링크 공유·서명 검증·모바일 재생 뷰(3), 오디오 내보내기(4), 악보 PDF 가져오기(5)**. (`pnpm gen:dev-samples`의 합성 톤은 파이프라인 점검용이고 `public/samples-dev/`(gitignore)에 쓴다.)

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

**무엇이 검증되지 않는지는 `docs/known-gaps.md`에 있다.** vitest는 `lib/**`를 node로, `components/**`·`state/**`를 jsdom으로 돌린다. `components/studio/**`·`state/**`에 jsdom 테스트가 많지만 실제 브라우저의 포인터·포커스·레이아웃 동작은 증명하지 못한다(좌표는 `getBoundingClientRect` 스텁, 포인터는 `components/studio/testing/pointer.ts` 헬퍼). 옛 설계의 심각한 결함은 전부 테스트가 없던 UI·상태 계층에서 나왔다 — 규칙이 든 로직은 `lib/`의 순수 함수로 빼고, UI·상태 코드를 고쳤다면 통과한 검사 목록을 근거로 삼지 말 것.
