---
name: review-pr
description: 'Collect Bandline GitHub PR review comments, assess each comment against project rules, apply valid fixes when safe, optionally commit and push fixes, and post Korean replies with gh api. Use only when the user explicitly asks to address PR review comments or reply to review comments.'
allowed-tools: Bash(bash *get-pr-data.sh:*), Bash(bash *reply-review-comment.sh:*), Bash(gh api:*), Bash(gh pr view:*), Bash(gh repo view:*), Bash(git add:*), Bash(git commit:*), Bash(git log:*), Bash(git push:*), Bash(git rev-parse:*), Bash(rm:*), Edit, Read
---

# Review PR

사용자가 명시적으로 PR 리뷰 코멘트 대응이나 답변 작성을 요청할 때만 쓴다.

## Step 1: Collect PR Data

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/get-pr-data.sh"
```

출력 파일:

- `.pr-tmp/pr_comments.json`
- `.pr-tmp/pr_changed_files.txt`
- `.pr-tmp/pr_commits.txt`
- `.pr-tmp/pr_diff.txt`
- `.pr-tmp/pr_meta.env`

## Step 2: Load Rules

```bash
find .claude/rules -name "*.md" 2>/dev/null
```

우선순위:

```text
AGENTS.md > CLAUDE.md > .claude/rules/** > 주변 소스 패턴
```

## Step 3: Assess Comments

각 코멘트에 대해:

- `VALID`: 리뷰어가 맞다. 가장 작고 안전한 수정을 적용한다.
- `INVALID`: 리뷰어가 틀렸거나 프로젝트 규칙과 충돌한다. 코드를 고치지 않는다.
- `PARTIAL`: 의도는 타당하지만 범위나 구현이 모호하다. 편집 전에 사용자에게 묻는다.

각 판단의 근거를 인용한다.

## Step 4: Commit and Push Valid Fixes

유효한 수정을 했으면:

```bash
git add <changed-files>
git commit -m "<message>"
git rev-parse --short=7 HEAD
git push
```

무관한 변경이나 gitignore된 하네스 산출물을 포함하지 않는다.

## Step 5: Post Replies

`${CLAUDE_SKILL_DIR}/references/reply-formats.md`를 읽는다.

답변할 코멘트마다:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/reply-review-comment.sh" "<repo>" "<pr_number>" "<comment_id>" "<reply_body>"
```

답변은 한국어로 쓴다.

## Step 6: Report and Cleanup

요약 표를 출력한다:

```text
comment | verdict | action | commit/reply
```

임시 PR 파일만 정리한다:

```bash
rm -rf .pr-tmp
```
