---
description: 'Branch, commit, PR text, and change grouping conventions for Bandline Git workflow and GitHub metadata.'
paths:
  - '.github/**/*'
  - '.claude/skills/commit/**/*'
  - '.claude/skills/write-pr/**/*'
  - '.claude/skills/review-pr/**/*'
  - '.claude/rules/git-workflow.md'
---

# Git Workflow Rules

브랜치 이름, 커밋, PR 텍스트, 변경 묶음에 쓴다.

## 브랜치 이름

```text
<type>/<kebab-case-description>
```

타입: `feat`, `fix`, `refactor`, `style`, `chore`, `docs`, `test`, `ci`

예시:

- `feat/piano-roll-note-drag`
- `fix/audio-context-suspended-on-first-play`
- `chore/setup-claude-harness`

## 커밋 메시지

Conventional Commit 형식에 설명은 한국어로 쓴다.

```text
<type>: <한국어 설명>
```

명확해질 때만 스코프를 붙인다:

```text
feat(audio): look-ahead 스케줄러 추가
```

이 저장소의 스코프:

| 스코프    | 대상                                     |
| --------- | ---------------------------------------- |
| `audio`   | `lib/audio/` — 엔진, 스케줄러, 악기      |
| `score`   | `lib/score/` — 곡 데이터 모델            |
| `editor`  | `components/editor/` — 피아노롤, 타임라인 |
| `ui`      | `components/ui/` — 공용 컨트롤           |
| `state`   | `state/` — StudioProvider                |
| `app`     | 라우트, 레이아웃, 전역 CSS               |
| `assets`  | `public/` — 악기 샘플 등                 |
| `harness` | `.claude/**`                             |
| `config`  | package/tsconfig/eslint/next/postcss     |
| `docs`    | README, CLAUDE.md, AGENTS.md, `docs/**`  |
| `ci`      | `.github/**`                             |

커밋 하나는 논리적 변경 하나에 집중한다. 소스 변경, 포매팅 잡음, 하네스 설정을 같은 작업이 아닌 이상 섞지 않는다.

`_workspace/`, `.claude/command.log`, `.pr-tmp/`는 gitignore 대상이다. 스테이징하지 않는다.

## Pull Request

- `.github/PULL_REQUEST_TEMPLATE.md`를 따른다.
- 목적, 작업 내용, 관련 이슈를 쓴다.
- **소리와 관련된 변경은 diff로 리뷰할 수 없다.** 재생 동작이나 타이밍이 바뀌었으면 짧은 화면 녹화(소리 포함)를 첨부하라고 명시한다. UI 변경은 스크린샷.
- 실행한 검증 명령과 실행하지 못한 검사를 적는다.
- base 브랜치는 `main`이다.
