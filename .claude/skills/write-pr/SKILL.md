---
name: write-pr
description: 'Create an actual GitHub pull request for Bandline from the current branch. Gathers commits and diff, generates a Korean PR title/body following the repository template, selects labels, asks for title confirmation, then runs gh pr create. Use only when the user explicitly asks to create/open/write a PR.'
allowed-tools: Bash(git *:*), Bash(gh pr *:*), Bash(gh repo *:*), Bash(bash *create-pr.sh:*), Bash(cat *:*), Bash(mkdir:*), Bash(rm:*), Read, Write
---

# Write PR

사용자가 명시적으로 PR 생성을 요청할 때만 쓴다.

## Step 1: Gather Context

```bash
git branch --show-current
git log origin/main..HEAD --oneline 2>/dev/null || git log --oneline -15
git diff origin/main...HEAD --stat 2>/dev/null || git diff HEAD~5...HEAD --stat
git diff origin/main...HEAD 2>/dev/null || git diff HEAD~5...HEAD
cat .github/PULL_REQUEST_TEMPLATE.md
```

## Step 2: Select Labels

`${CLAUDE_SKILL_DIR}/references/labels.md`를 읽고 PR에 쓸 수 있는 라벨 1-2개를 고른다.

## Step 3: Generate PR Content

제목:

- 3가지 안을 만든다.
- `[scope] 설명` 형식.
- 간결한 한국어.

본문:

- `.github/PULL_REQUEST_TEMPLATE.md`(개요 / 작업내용 / 검증 / 관련 issue)를 따른다.
- 한국어 산문으로 쓴다.
- 템플릿 지시대로, 관련 이슈가 없으면 해당 섹션을 지운다.
- 실행한 검증 명령과 건너뛴 검사를 작업내용에 포함한다.
- **재생 동작이나 소리가 바뀌었으면 소리가 포함된 짧은 화면 녹화를 첨부하라고 상기시킨다 — diff는 소리를 보여주지 못한다.** UI만 바뀌었으면 스크린샷.
- 필요하면 `.pr-tmp/`를 만들고 본문을 `.pr-tmp/PR_BODY.md`에 쓴다.

미리보기를 보여주고 어떤 제목을 쓸지 사용자에게 물은 뒤 PR을 만든다.

## Step 4: Create PR

제목 확정 후:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/create-pr.sh" "<confirmed-title>" ".pr-tmp/PR_BODY.md" "<label1>,<label2>"
```

`gh`가 반환한 PR URL을 보고한다.

## Step 5: Cleanup

이 스킬이 만든 임시 본문 파일만 지운다:

```bash
rm -f .pr-tmp/PR_BODY.md
```
