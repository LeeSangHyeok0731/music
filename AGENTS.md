<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Bandline

브라우저에서 직접 작곡하고 재생하는 웹 시퀀서. 피아노 / 어쿠스틱 기타 / 일렉기타 / 드럼 / 베이스를 한 타임라인 위에서 다룬다.

## 현재 상태

타임라인에서 곡을 편집하고 재생하고 파일로 저장할 수 있다. `lib/score/`(곡 데이터·시간 변환·편집 함수·파일 형식), `lib/audio/`(AudioContext·look-ahead 스케줄러·신스 악기 4종), `state/`, `components/timeline/`, `components/transport/`가 실제로 존재한다.

16마디 데모 곡(`lib/score/fixture.ts`)으로 시작해서, 타일을 찍고 옮기고 늘리고 지울 수 있다. 드럼은 격자 칸 토글로 만들고 드래그로 이어 칠한다. 타일을 클릭하면 음·세기·길이를 고치는 팝오버가 뜬다. `Ctrl+Z`로 되돌린다.

곡은 JSON 파일로 저장하고 다시 불러온다. 불러오기도 실행취소 스택에 쌓이므로 `Ctrl+Z`로 되돌린다. 파일 형식과 검증 규칙은 `docs/song-file-format.md`에 있다 — 손으로 고친 파일도 받으므로 zod 스키마(`lib/score/schema.ts`)가 구조를 거부하고 정렬·범위는 복구한다.

**템포는 `song.tempo`가 유일한 진실이다.** 슬라이더가 곡을 갱신하고, 곡을 통째로 바꾸는 경로(`loadSong`, `undo`)는 엔진에 `setTempo`를 직접 불러야 한다 — `Engine.setSong`은 `bpm`을 건드리지 않는다. 빠뜨리면 화면과 실제 재생 속도가 갈라지고 스스로 낫지 않는다.

**편집은 정지 중에만 된다** — 재생 중 타임라인은 읽기 전용이다. 스케줄러의 커서가 `tiles[]` 인덱스라 재생 중 곡이 바뀌면 노트가 조용히 누락된다.

아직 없는 것: 다시실행, 다중 선택, 복사/붙여넣기, 라인 추가/삭제, 루프, 시크, 줌, 샘플 음원. 악기는 전부 오실레이터 신스다.

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
