<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Bandline

브라우저에서 직접 작곡하고 재생하는 웹 시퀀서. 피아노 / 어쿠스틱 기타 / 일렉기타 / 드럼 / 베이스를 한 타임라인 위에서 다룬다.

## 현재 상태

`create-next-app` 스캐폴드 단계다. `app/`에 `layout.tsx`, `page.tsx`, `globals.css`, `favicon.ico`만 있고 오디오 코드는 아직 한 줄도 없다. `.claude/rules/*.md`가 설명하는 디렉터리(`lib/audio/`, `lib/score/`, `components/editor/`, `state/`)는 **합의된 설계 방향이지 현존하는 구조가 아니다.** 첫 구현이 실제 구조를 만들면 그 규칙 문서를 사실에 맞게 갱신할 것.

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
