# Bandline

음악 비전공자가 브라우저에서 곡 아이디어를 스케치하는 도구. 코드·패턴 블록으로 뼈대를 만들고, 필요하면 음 단위로 고친다.

## 현재 상태

**재구상 중이다.** 지금 있는 것은 곡 데이터 모델(`lib/score/`)과 샘플 기반 오디오 엔진(`lib/audio/`), 그리고 데모 곡을 재생해 소리를 확인하는 최소 화면(`/`)뿐이다. 이 화면은 편집 UI가 아니다.

편집 UI, 곡 파일 저장·불러오기 화면, 링크 공유, 오디오 내보내기는 아직 없다. 실제 샘플 팩도 아직 커밋되지 않았다 — 지금 들을 수 있는 소리는 스크립트가 만드는 개발용 톤뿐이다. 자세한 범위는 [`AGENTS.md`](AGENTS.md)와 [설계 문서](docs/superpowers/specs/2026-11-20-core-model-sample-engine-design.md)를 본다.

## 기술 스택

- Next.js 16 (App Router) / React 19 / TypeScript
- Tailwind CSS 4
- zod (곡 데이터 검증)
- Web Audio API (브라우저 네이티브 오디오 — 서버 렌더링 불가, 전부 클라이언트)
- vitest (`lib/**`는 node 환경, `components/**`·`state/**`는 jsdom + Testing Library)

## 실행

```bash
pnpm install
pnpm gen:dev-samples   # public/samples에 개발용 톤을 만든다 (gitignore, 커밋되지 않음)
pnpm dev
```

http://localhost:3000 에서 확인. 개발용 톤이 없으면 샘플을 받지 못해 재생이 시작되지 않는다.

## 스크립트

| 명령                   | 설명                                   |
| ---------------------- | -------------------------------------- |
| `pnpm dev`             | 개발 서버                              |
| `pnpm build`           | 프로덕션 빌드                          |
| `pnpm start`           | 빌드 결과 실행                         |
| `pnpm test`            | vitest 실행                            |
| `pnpm lint`            | ESLint 검사                            |
| `pnpm format`          | ESLint 자동 수정                       |
| `pnpm check-types`     | TypeScript 타입 검사                   |
| `pnpm gen:dev-samples` | `public/samples/`에 개발용 톤 팩 생성  |

## 구조

```text
app/                    Next.js App Router 엔트리포인트 (`/` = 소리 확인 화면)
lib/score/              곡 데이터 모델 v2 — 모델, 코드·패턴, 펼치기, 검증, 스키마, 데모 곡, 실행취소 규칙 (순수 TS)
lib/audio/              오디오 엔진 — AudioContext, 스케줄러, 보이스 풀, 샘플 뱅크, 샘플 악기 (순수 TS)
components/verify/      소리 확인 화면 (편집 UI가 아니다)
scripts/                개발용 톤 생성 스크립트
docs/                   문서
```

계층 경계가 핵심이다. `lib/score/`는 Web Audio도 React도 모르고, `lib/audio/`는 React를 모른다. UI는 명령형 메서드로만 엔진을 건드린다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [알려진 공백](docs/known-gaps.md) | 무엇이 검증되지 않는지, 무엇이 미뤄졌는지. 작업 시작 전에 읽을 것 |
| [`AGENTS.md`](AGENTS.md) | 프로젝트 현재 상태와 절대 규칙 |
| [`.claude/rules/`](.claude/rules/) | 아키텍처 경계, 오디오 엔진, UI 컨벤션, 디버깅 규칙 |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | 설계 근거. 현재 코드의 설계는 `2026-11-20-core-model-sample-engine-design.md`. 그 이전 날짜의 문서는 철거된 옛 설계다 |

## 개발 규칙

`AGENTS.md`와 `.claude/rules/*.md`에 아키텍처 경계, 오디오 상태 소유권, 스케줄링 규칙이 정리돼 있다. 코드를 쓰기 전에 읽을 것.

특히 두 가지는 어기면 조용히 깨진다.

- **`AudioContext`를 모듈 스코프에서 만들지 않는다.** SSR/빌드가 깨진다.
- **노트를 `setTimeout`으로 하나씩 울리지 않는다.** look-ahead 스케줄러로 `audioContext.currentTime` 절대 시각에 미리 예약한다.

검증은 `pnpm lint` · `pnpm check-types` · `pnpm test` · `pnpm build`. 다만 정적 검사는 소리에 대해 아무것도 증명하지 않는다 — 재생 동작을 건드렸으면 `pnpm dev`로 실제로 들어볼 것.
