# Git Scope Guide

브랜치 이름, 커밋 스코프, PR 제목 스코프, 논리적 커밋 묶음을 고를 때 쓴다.

## Runtime Discovery

추측보다 실제 변경 파일을 쓴다:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/discover-changed-areas.sh" auto
```

스테이징된 변경을 특정해 물으면:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/discover-changed-areas.sh" staged
```

## Scope Priority

가장 구체적이고 의미 있는 스코프를 고른다:

1. 제품 영역: `audio`, `score`, `editor`, `ui`, `state`, `app`
2. 교차 영역: `harness`, `docs`, `ci`, `config`, `assets`, `global`

## Common Scope Mapping

| 변경 영역                                                | 스코프    | 언제                                                       |
| -------------------------------------------------------- | --------- | ---------------------------------------------------------- |
| `lib/audio/**`                                           | `audio`   | AudioContext, 트랜스포트, 스케줄러, 악기, 노드 그래프, 믹싱 |
| `lib/score/**`                                           | `score`   | 노트·트랙·패턴 모델, 템포, 시간 변환                       |
| `components/editor/**`                                   | `editor`  | 피아노롤, 타임라인, 트랙 헤더, 노트 편집 인터랙션           |
| `components/ui/**`                                       | `ui`      | 버튼, 슬라이더, 패널 등 공용 컨트롤                        |
| `state/**`                                               | `state`   | StudioProvider, Context, setter                            |
| `app/**`                                                 | `app`     | 라우트 엔트리포인트, 레이아웃, 메타데이터, 전역 CSS        |
| `public/**`                                              | `assets`  | 악기 샘플, 아이콘 등 정적 파일                             |
| `.claude/**`                                             | `harness` | 에이전트, 스킬, 규칙, 훅, 설정 변경                        |
| `.github/**`                                             | `ci`      | 워크플로나 PR 템플릿 변경                                  |
| `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/**`         | `docs`    | 문서만 변경                                                |
| `package.json`, `tsconfig`, `eslint.config`, `next.config`, `postcss` | `config` | TypeScript, ESLint, Next, 패키지 설정          |

엔진 변경과 그것을 쓰는 UI 변경이 함께 있으면, 사용자에게 보이는 의도에 맞는 스코프를 고른다. 함께여야 빌드가 되는 변경은 나누지 않는다.

## Commit Type Selection

| 타입       | 용도                                                     |
| ---------- | -------------------------------------------------------- |
| `feat`     | 사용자에게 보이거나 들리는 새 기능                       |
| `fix`      | 버그 수정, 회귀 수정                                     |
| `refactor` | 동작 변화 없는 내부 구조 변경                            |
| `perf`     | 동작 변화 없는 성능 개선 (끊김 감소, 렌더 비용 감소 등)  |
| `style`    | 시각적 스타일이나 포매팅만 변경                          |
| `chore`    | 하네스, 툴링, 의존성, 유지보수                           |
| `docs`     | 문서만 변경                                              |
| `test`     | 테스트만 변경                                            |
| `ci`       | GitHub Actions나 CI 변경                                 |

## Examples

```text
chore(harness): Claude harness를 Bandline에 맞게 이식
feat(audio): look-ahead 스케줄러 추가
fix(audio): 사용자 제스처에서 AudioContext resume 처리해 무음 문제 해결
feat(editor): 피아노롤 노트 드래그 이동 추가
perf(editor): 플레이헤드를 별도 레이어로 분리해 노트 리렌더 제거
feat(score): 템포 변경에 대응하도록 노트를 정수 틱으로 저장
docs: README에 실행 방법 추가
```
