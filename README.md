# Bandline

음악 비전공자가 브라우저에서 곡 아이디어를 스케치하는 도구. 코드·패턴 블록으로 뼈대를 만들고, 필요하면 음 단위로 고친다.

## 현재 상태

곡 데이터 모델 v3(`lib/score/`), 샘플 기반 오디오 엔진(`lib/audio/`), 그리고 코드 진행과 악기별 패턴을 블록으로 조립하는 **편집 화면(`/`)** 이 있다(하위 프로젝트 2a). 코드 진행 레인과 고정 4트랙(피아노·기타·베이스·드럼)에 패턴 클립을 놓고 끌어 옮기고 늘리고 지우며, 되돌리기(50칸)와 브라우저 자동 저장(`localStorage`)을 쓴다. 편집은 정지 중에만 된다.

화음 악기(피아노·기타·베이스)의 패턴 클립은 "음으로 바꾸기"(굽기)나 빈 음 클립으로 만든 뒤 **모달 피아노롤**에서 음 단위로 고친다(하위 프로젝트 2b-1): 음 추가·선택(박스 포함)·이동·길이·삭제, 세기 레인, 키보드 이동, 격자 단위 1/4·1/8·1/16. 굽기는 그 시점의 코드 진행으로 음을 굳히는 한 방향 변환이라 이후 진행을 바꿔도 따라가지 않는다.

드럼 그리드(2b-2)·음 미리듣기·반복 재생·복사/붙여넣기·다시실행·줌·트랙 추가·곡 파일 저장·불러오기 화면(하위 프로젝트 2b의 나머지), 링크 공유, 오디오 내보내기는 아직 없다. 샘플은 `public/samples/`에 커밋된 CC0 팩(피아노·일렉트릭 기타·베이스·드럼, 약 2.27MB)이다 — 출처와 라이선스는 [`public/samples/LICENSES.md`](public/samples/LICENSES.md). **아직 아무도 직접 조립해 귀로 들어 보지 않았다**(레이아웃과 조작만 Chrome에서 점검했다. 피아노롤도 들어 보지 않았다). 기타는 일렉트릭 기타 직결 녹음이다(CC0 어쿠스틱 기타 단음 샘플을 찾지 못했다). 자세한 범위는 [`AGENTS.md`](AGENTS.md), 설계 문서([편집 화면](docs/superpowers/specs/2026-11-21-arrangement-editor-design.md), [피아노롤](docs/superpowers/specs/2026-11-21-piano-roll-design.md)), [알려진 공백](docs/known-gaps.md)을 본다.

## 기술 스택

- Next.js 16 (App Router) / React 19 / TypeScript
- Tailwind CSS 4
- zod (곡 데이터 검증)
- Web Audio API (브라우저 네이티브 오디오 — 서버 렌더링 불가, 전부 클라이언트)
- vitest (`lib/**`는 node 환경, `components/**`·`state/**`는 jsdom + Testing Library)

## 실행

```bash
pnpm install
pnpm dev
```

http://localhost:3000 에서 확인. 샘플 팩은 저장소에 들어 있으므로 따로 만들 필요가 없다.

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
| `pnpm build:samples`   | 고정 커밋의 CC0 원본을 받아(`.sample-cache/`) `public/samples/` 팩을 다시 만든다(라이선스 확인·가공·점검 포함) |
| `pnpm gen:dev-samples` | 파이프라인 점검용 합성 톤을 `public/samples-dev/`에 생성(gitignore) |

## 구조

```text
app/                    Next.js App Router 엔트리포인트 (`/` = 편집 화면)
lib/score/              곡 데이터 모델 v3 — 모델, 코드 진행, 코드·패턴, 펼치기, 검증, 스키마, 데모 곡, 편집 규칙(edit.ts), 음 클립 편집 규칙(notes.ts), 실행취소 규칙, 자동 저장 직렬화 (순수 TS)
lib/audio/              오디오 엔진 — AudioContext, 스케줄러, 보이스 풀, 샘플 뱅크, 샘플 악기 (순수 TS)
components/studio/      편집 화면 UI — 코드 레인, 트랙 레인, 팝오버, 드래그, 단축키, 모달 피아노롤(pianoroll/)
state/                  StudioProvider — 엔진·곡 히스토리·재생 상태·자동 저장을 소유하는 React 상태
scripts/                샘플 팩 빌드(build-sample-pack.mjs + sample-pack.config.mjs + sample-pack/), 개발용 톤 생성
public/samples/         샘플 팩(커밋됨, 스크립트 출력 — 손으로 고치지 않는다)
docs/                   문서
```

계층 경계가 핵심이다. `lib/score/`는 Web Audio도 React도 모르고, `lib/audio/`는 React를 모른다. UI는 명령형 메서드로만 엔진을 건드린다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [알려진 공백](docs/known-gaps.md) | 무엇이 검증되지 않는지, 무엇이 미뤄졌는지. 작업 시작 전에 읽을 것 |
| [`AGENTS.md`](AGENTS.md) | 프로젝트 현재 상태와 절대 규칙 |
| [`.claude/rules/`](.claude/rules/) | 아키텍처 경계, 오디오 엔진, UI 컨벤션, 디버깅 규칙 |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | 설계 근거. 현재 코드의 설계는 `2026-11-21-arrangement-editor-design.md`(편집 화면, 모델 v3), `2026-11-21-piano-roll-design.md`(피아노롤)와 `2026-11-20-core-model-sample-engine-design.md`(엔진·샘플, §3 모델은 v3로 대체됨). 그 이전 날짜의 문서는 철거된 옛 설계다 |

## 개발 규칙

`AGENTS.md`와 `.claude/rules/*.md`에 아키텍처 경계, 오디오 상태 소유권, 스케줄링 규칙이 정리돼 있다. 코드를 쓰기 전에 읽을 것.

특히 두 가지는 어기면 조용히 깨진다.

- **`AudioContext`를 모듈 스코프에서 만들지 않는다.** SSR/빌드가 깨진다.
- **노트를 `setTimeout`으로 하나씩 울리지 않는다.** look-ahead 스케줄러로 `audioContext.currentTime` 절대 시각에 미리 예약한다.

검증은 `pnpm lint` · `pnpm check-types` · `pnpm test` · `pnpm build`. 다만 정적 검사는 소리에 대해 아무것도 증명하지 않는다 — 재생 동작을 건드렸으면 `pnpm dev`로 실제로 들어볼 것.
