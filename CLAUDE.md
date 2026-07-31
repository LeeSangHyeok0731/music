@AGENTS.md

# Harness

이 저장소의 Claude harness는 `.claude/`에 있다. 변경 이력은 `.claude/CHANGELOG.md`.

## 트리거

| 요청                                                      | 사용할 것                       |
| --------------------------------------------------------- | ------------------------------- |
| 기능 구현, 리팩터링, 버그 수정 등 여러 단계가 필요한 작업 | `orchestrator` 스킬             |
| 구조 / 상태 소유권 / 레이어 경계 결정                     | `frontend-architecture` 스킬    |
| 오디오 엔진, 스케줄러, 악기, Web Audio 그래프             | `audio-engine` 스킬             |
| 피아노롤, 타임라인, 트랙 UI, Tailwind 스타일              | `ui-implementation` 스킬        |
| 버그, 빌드 실패, 타입 오류, 소리가 이상함                 | `systematic-debugging` 스킬     |
| 변경 파일 리뷰, PR 전 점검                                | `code-review` 스킬              |
| 구현 후 검증                                              | `quality-gate` 스킬             |
| 실제 커밋 생성                                            | `commit` 스킬                   |
| 실제 PR 생성                                              | `write-pr` 스킬                 |
| PR 리뷰 코멘트 대응 및 답변                               | `review-pr` 스킬                |

## 규칙 파일

`.claude/rules/*.md`는 경로 스코프로 주입된다. 충돌 시 우선순위:

```text
AGENTS.md > CLAUDE.md > .claude/rules/** > 주변 소스 패턴
```

## 하네스 런타임 산출물

`_workspace/`, `.claude/command.log`, `.pr-tmp/`는 gitignore 대상이다. 커밋하지 않는다.
