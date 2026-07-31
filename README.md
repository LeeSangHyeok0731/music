# Bandline

브라우저에서 직접 작곡하고 바로 들어보는 웹 시퀀서. 피아노, 어쿠스틱 기타, 일렉기타, 드럼, 베이스를 한 타임라인 위에 올려 한 곡을 만드는 것이 목표다.

> 현재 상태: `create-next-app` 스캐폴드 단계. 아래 구조와 기능은 설계 방향이며 아직 구현되지 않았다.

## 기술 스택

- Next.js 16 (App Router) / React 19 / TypeScript
- Tailwind CSS 4
- Web Audio API (브라우저 네이티브 오디오 — 서버 렌더링 불가, 전부 클라이언트)

## 실행

```bash
pnpm install
pnpm dev
```

http://localhost:3000 에서 확인.

## 스크립트

| 명령                | 설명                          |
| ------------------- | ----------------------------- |
| `pnpm dev`          | 개발 서버                     |
| `pnpm build`        | 프로덕션 빌드                 |
| `pnpm start`        | 빌드 결과 실행                |
| `pnpm lint`         | ESLint 검사                   |
| `pnpm format`       | ESLint 자동 수정              |
| `pnpm check-types`  | TypeScript 타입 검사          |

## 구조 (계획)

```text
app/                Next.js App Router 엔트리포인트
lib/score/          곡 데이터 모델 — 노트, 트랙, 패턴, 템포 (순수 TS)
lib/audio/          오디오 엔진 — AudioContext, 트랜스포트, 스케줄러, 악기 (순수 TS)
components/editor/  피아노롤 / 타임라인 / 트랙 UI
components/ui/      공용 컨트롤
state/              StudioProvider — 엔진 인스턴스 + React UI 상태
public/samples/     악기 샘플
```

## 개발 규칙

`AGENTS.md`와 `.claude/rules/*.md`에 아키텍처 경계, 오디오 상태 소유권, 스케줄링 규칙이 정리돼 있다. 코드를 쓰기 전에 읽을 것.
