---
name: commit
description: 'Create actual Git commits for Bandline by inspecting changed files, splitting logical units, staging the right files, and running git commit with project Conventional Commit messages. Use when the user explicitly asks to commit, make a commit, split commits, or commit staged/unstaged changes. Do not push.'
allowed-tools: Bash(git *:*), Bash(bash *discover-changed-areas.sh:*), Read
---

# Commit

사용자가 명시적으로 커밋을 요청할 때만 쓴다. 커밋 없이 메시지만 추천할 때는 git 상태만 확인하고 `git add`/`git commit`을 실행하지 않는다.

## Step 1: Inspect Git State

```bash
git status --short
git diff --stat
git diff --staged --stat
```

스테이징된 변경만 커밋하라고 하면 `git diff --staged`를 근거로 삼는다.

## Step 2: Determine Scope and Type

변경 영역 탐색:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/discover-changed-areas.sh" auto
```

`${CLAUDE_SKILL_DIR}/references/scope-guide.md`를 읽고 가장 구체적이고 유용한 스코프를 고른다. `.claude/**` 하네스 변경은 `chore(harness)`.

## Step 3: Split Logical Units

독립적인 변경은 나눈다:

- 오디오 엔진 / 스케줄링 / 악기 (`lib/audio/`)
- 곡 데이터 모델 (`lib/score/`)
- 편집 UI와 스타일 (`components/`)
- 하네스나 문서 변경
- CI/config 변경

하나의 요청에 속한 파일들을 억지로 쪼개지 않는다. 엔진 API 변경과 그 API를 쓰는 UI 변경처럼 **함께여야 빌드가 되는 변경은 한 커밋**에 둔다.

## Step 4: Stage and Commit

각 논리 단위마다:

1. 관련 파일만 `git add`.
2. 커밋:

   ```bash
   git commit -m "<type>(<scope>): <설명>"
   ```

3. 확인:

   ```bash
   git log --oneline -n 3
   ```

## Rules

- `git push`를 실행하지 않는다.
- 생성된 캐시, 빌드 산출물, 하네스 런타임 산출물(`_workspace/`, `.claude/command.log`, `.pr-tmp/` — gitignore 대상)을 커밋하지 않는다.
- 무관한 사용자 변경이 있으면 스테이징하지 않고 그대로 두고 보고한다.
