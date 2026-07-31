---
name: orchestrator
description: 'Coordinate the Bandline agent team for features, bug fixes, refactors, editor UI work, audio engine and scheduling work, QA, code review, debugging, branch names, actual commits, PR creation, PR review comment replies, and project architecture. Use this skill for implementation tasks, reviews, reruns, updates, revisions, partial reruns, follow-up fixes, Git workflow tasks, and requests to improve previous results. Simple one-off questions may be answered directly.'
---

# Orchestrator

Bandline 하네스를 조율한다. 작업을 맞는 전문가에게 배분하고 구현을 작고 검증 가능하며 저장소에 맞게 유지한다.

## Execution Mode

기본은 에이전트 팀 모드다.

| Agent                        | Type   | Model  | Role                                  | Skill                               | Primary Output                                              |
| ---------------------------- | ------ | ------ | ------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| `frontend-architect`         | custom | sonnet | 구조 계획과 범위 통제                 | `frontend-architecture`             | `_workspace/{phase}_frontend-architect_plan.md`             |
| `audio-engine-engineer`      | custom | sonnet | 오디오 엔진, 스케줄러, 악기, 곡 모델  | `audio-engine`                      | `_workspace/{phase}_audio-engine-engineer_changes.md`       |
| `ui-implementation-engineer` | custom | sonnet | 피아노롤, 타임라인, 트랜스포트, 스타일 | `ui-implementation`                 | `_workspace/{phase}_ui-implementation-engineer_changes.md`  |
| `qa-inspector`               | custom | sonnet | 검증과 회귀 검사                      | `quality-gate`                      | `_workspace/{phase}_qa-inspector_report.md`                 |
| `code-reviewer`              | custom | sonnet | 변경 파일 리뷰                        | `code-review`                       | `_workspace/{phase}_code-reviewer_review.md`                |
| `bug-investigator`           | custom | sonnet | 근본 원인 디버깅                      | `systematic-debugging`              | `_workspace/{phase}_bug-investigator_report.md`             |
| `git-workflow-assistant`     | custom | haiku  | 커밋, PR, 리뷰 워크플로               | `commit` / `write-pr` / `review-pr` | `_workspace/{phase}_git-workflow-assistant_git.md`          |

이 프로젝트에는 서버, API 레이어, 데이터 페칭 스택이 없으므로 데이터 통합 에이전트가 없다. **소리가 나는 쪽(`lib/audio/`, `lib/score/`)과 보이는 쪽(`components/`)은 분리된 역할이다** — 두 계층을 동시에 건드리는 작업은 두 에이전트에게 각각의 경계를 주고 배분한다.

모델 선택을 지원하는 하네스에서는 사용자가 다른 모델을 명시하지 않는 한 각 에이전트 frontmatter의 `model` 값을 쓴다.

## Phase 0: Context Check

작업 시작 전에:

1. `_workspace/`가 있는지 확인한다.
2. 실행 모드를 정한다:
   - `_workspace/` 없음: 초기 실행.
   - `_workspace/` 있고 좁은 수정 요청: 부분 재실행. 관련 이전 산출물을 읽고 영향 받는 영역만 갱신한다.
   - `_workspace/` 있고 넓은 새 요청: 새 실행. 기존 워크스페이스를 `_workspace_{YYYYMMDD_HHMMSS}/`로 옮겨 보존하고 새로 만든다.
3. `package.json`, 동적으로 찾은 `.claude/rules/*.md`, 루트 지시 파일(`CLAUDE.md`, `AGENTS.md`), 그리고 관련 소스를 읽은 뒤 작업을 배분한다.

`AGENTS.md`는 프레임워크 레벨 코드 전에 `node_modules/next/dist/docs/`의 해당 가이드를 읽으라고 요구한다. Next.js 작업을 하는 에이전트에게 이 요구를 전달한다.

**이 저장소는 아직 스캐폴드 단계다.** `.claude/rules/*.md`가 설명하는 디렉터리 대부분은 존재하지 않는다. 첫 구현이 실제 구조를 만들면 규칙 문서를 사실에 맞게 갱신하는 것까지 작업에 포함시킨다.

## Phase 1: Classify the Task

- 구조, 상태 소유권, 계층 경계, 범위: `frontend-architect`.
- 재생, 타이밍, 스케줄링, 악기, 소리, 곡 데이터 모델: `audio-engine-engineer`.
- 피아노롤, 타임라인, 트랜스포트 UI, 노트 편집 인터랙션, Tailwind: `ui-implementation-engineer`.
- 리뷰, 회귀, 최종 수용: `qa-inspector`.
- 명시적 코드 리뷰, 스테이징 diff 리뷰, PR 전 리뷰: `code-reviewer`.
- 버그, 빌드 실패, 린트 실패, 타입 오류, 런타임 실패, 소리가 이상함: 구현 전에 `bug-investigator`.
- 브랜치 이름, 실제 커밋, 커밋 분할, PR 생성, PR 리뷰 코멘트 답변: `git-workflow-assistant`.

작은 작업에는 필요한 에이전트만 쓴다. 교차 작업에는 팀 전체를 쓴다.

## Phase 2: Assign Work

supervisor + producer-reviewer 방식:

1. `frontend-architect`가 범위, 소유권, 상태 배치를 정한다.
2. 실패나 불명확한 동작에서 시작하는 작업이면 수정 전에 `bug-investigator`가 먼저 돈다.
3. `audio-engine-engineer`와 `ui-implementation-engineer`가 각자 소유한 영역만 구현한다. **엔진 API가 바뀌면 UI 작업 전에 확정한다.**
4. `qa-inspector`가 마지막이 아니라 의미 있는 경계마다 검증한다.
5. 다중 파일 또는 PR 전 작업이면 `code-reviewer`가 변경 파일을 리뷰한다.
6. 명시적 요청이 있을 때 `git-workflow-assistant`가 커밋·PR·리뷰 워크플로를 준비하거나 실행한다.
7. 오케스트레이터가 결과를 통합하고 최종 응답을 간결하게 유지한다.

예상 작업 형태:

```text
TeamCreate(
  team_name: "bandline-team",
  members: [
    { name: "frontend-architect", agent_type: "frontend-architect", model: "sonnet" },
    { name: "audio-engine-engineer", agent_type: "audio-engine-engineer", model: "sonnet" },
    { name: "ui-implementation-engineer", agent_type: "ui-implementation-engineer", model: "sonnet" },
    { name: "qa-inspector", agent_type: "qa-inspector", model: "sonnet" },
    { name: "code-reviewer", agent_type: "code-reviewer", model: "sonnet" },
    { name: "bug-investigator", agent_type: "bug-investigator", model: "sonnet" },
    { name: "git-workflow-assistant", agent_type: "git-workflow-assistant", model: "haiku" }
  ]
)
```

위 예시는 예시일 뿐이다. 각 에이전트 frontmatter와 동기화된 상태로 유지한다.

## Data Flow

중간 산출물은 `_workspace/`에 둔다:

- `_workspace/00_input_request.md`
- `_workspace/01_frontend-architect_plan.md`
- `_workspace/01_bug-investigator_report.md`
- `_workspace/02_audio-engine-engineer_changes.md`
- `_workspace/02_ui-implementation-engineer_changes.md`
- `_workspace/03_qa-inspector_report.md`
- `_workspace/03_code-reviewer_review.md`
- `_workspace/04_git-workflow-assistant_git.md`

`_workspace/`는 gitignore 대상이다. 감사와 후속 작업을 위해 완료 후에도 보존한다.

## Bundled Resources

활성 작업에 도움이 될 때만 쓴다:

- `commit/scripts/discover-changed-areas.sh` — 커밋·PR 스코프 탐색
- `commit/references/scope-guide.md` — 스코프/타입 선택
- `write-pr/scripts/create-pr.sh` — 명시적 PR 생성 요청
- `write-pr/references/labels.md` — PR 라벨 선택
- `review-pr/scripts/get-pr-data.sh` — 명시적 PR 리뷰 코멘트 처리
- `review-pr/scripts/reply-review-comment.sh` — 명시적 GitHub 리뷰 답변
- `review-pr/references/reply-formats.md` — 한국어 답변 템플릿
- `code-review/references/review-checklist.md` — 다중 파일 또는 PR 전 리뷰
- `systematic-debugging/references/root-cause-tracing.md` — 경계를 넘는 실패

## Error Handling

| 상황                          | 전략                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| 에이전트 하나가 실패하거나 멈춤 | 같은 좁은 작업으로 한 번 재시도. 또 실패하면 최종 보고에 공백을 명시하고 진행. |
| 대부분의 에이전트가 실패      | 멈추고 부분 결과로 계속할지 사용자에게 묻는다.                                |
| 상충하는 발견 사항            | 파일 근거와 함께 양쪽 주장을 남기고, 소스를 직접 확인한 뒤 결정한다.          |
| 검증 명령이 환경 때문에 실패  | 환경 원인을 코드 문제와 분리해 보고하고 정적 검사를 계속한다.                 |
| 범위가 예상 밖으로 커짐       | 구현을 계속하기 전에 `frontend-architect`로 돌아가 범위를 줄인다.             |

## Quality Gate

최종 전달 전에 실행하거나 요청한다:

- `pnpm lint`
- `pnpm check-types`
- `pnpm build`

**정적 검사는 소리가 제대로 나는지 증명하지 않는다.** 재생 동작이 바뀌었으면 `pnpm dev`로 실제로 들어보거나, 그것을 잔여 위험으로 보고한다.

## Test Scenarios

일반 흐름:

1. 사용자가 편집 UI와 재생을 동시에 건드리는 기능을 요청한다.
2. 아키텍트가 상태 소유권과 계층 배치를 정한다.
3. 엔진 에이전트가 스케줄링·소리를, UI 에이전트가 편집 화면을 구현한다.
4. QA가 명령을 돌리고, 실제로 재생해 듣는다.
5. 최종 응답이 바뀐 동작과 검증 결과를 보고한다.

부분 재실행 흐름:

1. 사용자가 이전 UI 동작만 수정해 달라고 한다.
2. 오케스트레이터가 `_workspace/` 산출물을 읽는다.
3. `ui-implementation-engineer`와 `qa-inspector`만 배정된다.
4. 해당 산출물을 갱신하고 영향 영역만 재검증한다.

디버깅 흐름:

1. 사용자가 버그, 실패한 명령, 또는 "소리가 이상하다"를 보고한다.
2. `bug-investigator`가 에러 전문을 읽고 해당 경계를 추적한다.
3. 소유 에이전트가 근본 원인 수정 하나를 적용한다.
4. `qa-inspector`가 가장 작은 의미 있는 검사를 돌린 뒤, 가능하면 넓은 게이트를 돌린다.

Git 워크플로 흐름:

1. 사용자가 브랜치 이름, 커밋, PR 생성, 리뷰 코멘트 처리를 요청한다.
2. `git-workflow-assistant`가 실제 git 상태와 관련 템플릿을 확인한다.
3. 커밋 요청은 `commit`, PR 생성은 `write-pr`, 리뷰 코멘트 처리는 `review-pr`.
4. 사용자가 명시적으로 요청하지 않은 커밋·푸시·PR·답변을 실행하지 않는다.
