# Bandline

브라우저에서 직접 작곡하고 바로 들어보는 웹 시퀀서. 피아노, 기타, 드럼, 베이스를 한 타임라인 위에 올려 한 곡을 만든다.

## 현재 할 수 있는 것

16마디 데모 곡으로 시작해서 타임라인 위에서 곡을 편집하고 재생한다.

- 타일을 찍고, 옮기고, 늘리고, 지운다 (스냅 1/16)
- 드럼은 격자 칸을 토글하고 드래그로 이어 칠한다
- 타일을 클릭하면 음·세기·길이를 고치는 팝오버가 뜬다
- 템포·메트로놈 조절, `Ctrl+Z` 실행취소
- **곡을 JSON 파일로 저장하고 다시 불러온다** → [파일 형식](docs/song-file-format.md)

**편집은 정지 중에만 된다.** 재생 중 타임라인은 읽기 전용이다.

악기는 아직 전부 오실레이터 신스다. 다시실행, 다중 선택, 복사/붙여넣기, 라인 추가/삭제, 루프, 시크, 줌, 샘플 음원은 아직 없다.

## 기술 스택

- Next.js 16 (App Router) / React 19 / TypeScript
- Tailwind CSS 4
- zod (곡 파일 검증)
- Web Audio API (브라우저 네이티브 오디오 — 서버 렌더링 불가, 전부 클라이언트)
- vitest (순수 로직 테스트)

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
| `pnpm test`         | vitest 실행                   |
| `pnpm lint`         | ESLint 검사                   |
| `pnpm format`       | ESLint 자동 수정              |
| `pnpm check-types`  | TypeScript 타입 검사          |

## 구조

```text
app/                    Next.js App Router 엔트리포인트
lib/score/              곡 데이터 모델 — 타입, 시간 변환, 편집 함수, 파일 형식 (순수 TS)
lib/audio/              오디오 엔진 — AudioContext, 스케줄러, 악기, 보이스 풀 (순수 TS)
components/timeline/    타임라인 — 라인, 타일, 드럼 격자, 눈금자, 플레이헤드
components/transport/   트랜스포트 — 재생/정지, 템포, 메트로놈, 저장/불러오기
state/                  StudioProvider — 엔진 인스턴스 + React UI 상태
docs/                   문서
```

계층 경계가 핵심이다. `lib/score/`는 Web Audio도 React도 모르고, `lib/audio/`는 React를 모른다. UI는 명령형 메서드로만 엔진을 건드린다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [곡 파일 형식](docs/song-file-format.md) | 저장/불러오기 `.json`의 구조와 검증 규칙. 손으로 고칠 때 참고 |
| [알려진 공백](docs/known-gaps.md) | 무엇이 검증되지 않는지, 무엇이 미뤄졌는지. 작업 시작 전에 읽을 것 |
| [`AGENTS.md`](AGENTS.md) | 프로젝트 개요와 절대 규칙 |
| [`.claude/rules/`](.claude/rules/) | 아키텍처 경계, 오디오 엔진, UI 컨벤션, 디버깅 규칙 |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | 각 기능 슬라이스의 설계 근거 |

## 개발 규칙

`AGENTS.md`와 `.claude/rules/*.md`에 아키텍처 경계, 오디오 상태 소유권, 스케줄링 규칙이 정리돼 있다. 코드를 쓰기 전에 읽을 것.

특히 두 가지는 어기면 조용히 깨진다.

- **`AudioContext`를 모듈 스코프에서 만들지 않는다.** SSR/빌드가 깨진다.
- **노트를 `setTimeout`으로 하나씩 울리지 않는다.** look-ahead 스케줄러로 `audioContext.currentTime` 절대 시각에 미리 예약한다.

검증은 `pnpm lint` · `pnpm check-types` · `pnpm test` · `pnpm build`. 다만 정적 검사는 소리에 대해 아무것도 증명하지 않는다 — 재생 동작을 건드렸으면 `pnpm dev`로 실제로 들어볼 것.
