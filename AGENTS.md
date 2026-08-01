<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Bandline

브라우저에서 직접 작곡하고 재생하는 웹 시퀀서. 피아노 / 어쿠스틱 기타 / 일렉기타 / 드럼 / 베이스를 한 타임라인 위에서 다룬다.

## 현재 상태

읽기 전용 타임라인이 동작한다. `lib/score/`(곡 데이터·시간 변환), `lib/audio/`(AudioContext·look-ahead 스케줄러·신스 악기 4종), `state/StudioProvider.tsx`, `components/timeline/`, `components/transport/`가 실제로 존재한다.

하드코딩된 16마디 데모 곡(`lib/score/fixture.ts`)을 라인 위에 타일로 그리고, 재생하면 플레이 플래그가 지나가며 소리가 난다. **아직 편집은 없다** — 타일 생성·이동·길이 조절·삭제, 드럼 칸 토글, 루프, 시크, 줌, 저장/불러오기는 모두 미구현이다. 악기는 전부 오실레이터 신스이고 샘플은 없다.

설계 근거는 `docs/superpowers/specs/2026-07-31-tile-timeline-playback-design.md`에 있다.

## 절대 규칙

- **Web Audio는 서버에서 실행되지 않는다.** `AudioContext`를 모듈 스코프에서 생성하면 SSR/빌드가 깨진다. 반드시 사용자 제스처 이후 지연 생성하고, 오디오를 만지는 파일에는 `use client`를 붙인다.
- **오디오 스케줄링에 `setTimeout`/`requestAnimationFrame`으로 노트를 하나씩 울리지 않는다.** look-ahead 스케줄러로 `audioContext.currentTime` 절대 시각에 미리 예약한다. 자세한 내용은 `.claude/rules/audio-engine.md`.
- **재생 중 매 프레임 값(플레이헤드 위치 등)은 `useState`에 넣지 않는다.** 오디오 상태와 React 상태의 소유권 경계는 `.claude/rules/frontend-architecture.md`에 있다.
- 패키지 매니저는 **pnpm**이다. `npm install` / `yarn`을 쓰지 않는다.

## 검증

```bash
pnpm lint
pnpm check-types
pnpm build
```

정적 검사는 소리가 나는지 알려주지 않는다. 재생 동작이 바뀌었으면 `pnpm dev`로 실제로 들어보거나, 듣지 못했다고 명시할 것.
