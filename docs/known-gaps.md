# 알려진 공백

지금 이 저장소에서 **검증되지 않는 것**과 **미뤄진 작업**을 모아 둔다. 새 세션을 시작하는 사람(또는 에이전트)이 "무엇을 믿어도 되고 무엇을 직접 확인해야 하는지" 알기 위한 문서다.

기능 목록(무엇이 아직 없는지)은 `AGENTS.md`에 있다. 여기는 **품질과 검증**에 대한 것이다.

최종 갱신: 2026-08-03 (곡 파일 저장·불러오기 슬라이스 직후)

## 1. `state/`와 `components/`에 테스트가 없다

가장 크고, 세 슬라이스 연속으로 미뤄진 항목이다.

```text
lib/score/     두껍다 — edit, schema, serialize, time, notes
lib/audio/     fake-audio로 커버 — scheduler, voices, engine, instruments
state/         순수 함수 pushHistory 4개뿐. 훅 본체는 0
components/    0 — vitest include 밖이다
```

`vitest.config.mts`가 `environment: "node"`이고 `include`는 `lib/**`와 `state/**`뿐이다. `@testing-library/react`도 `jsdom`도 설치돼 있지 않다. 그래서 훅 본체와 컴포넌트는 **자동 테스트로 검증할 방법이 아예 없다.**

### 왜 중요한가 — 실제로 여기서만 사고가 났다

| 슬라이스 | 결함 | 언제 잡혔나 |
| --- | --- | --- |
| 타일 편집 | `useSongHistory`의 no-op 가드가 죽은 코드였다. 타일을 끌었다 제자리에 놓으면 히스토리에 빈 항목이 쌓이고 `Ctrl+Z`가 먹통 | 최종 리뷰 |
| 타일 편집 | `StudioProvider`의 곡 동기화가 가드 세 개의 합의에 기대다 화면과 엔진이 영구히 갈라짐 | 최종 리뷰 |
| 곡 파일 | `loadSong`이 엔진의 악기 맵을 갱신하지 않아, 라인 `id`가 다른 파일을 불러오면 그 라인이 조용히 무음 (Critical) | 최종 리뷰 |
| 곡 파일 | `undo`가 현재 템포를 버림 | 최종 리뷰 |

**전부 최종 리뷰에서야 잡혔다.** 구현 중에도, 태스크 리뷰에서도, 수동 확인에서도 통과했다. 넷 다 테스트가 있었다면 구현 단계에서 걸렸을 종류다.

### 시작점

`@testing-library/react` + `jsdom`을 넣고 `vitest.config.mts`를 나눈다 — `lib/**`는 `node` 환경 그대로 두고 `state/**`·`components/**`만 `jsdom`으로. 첫 대상은 `useSongHistory`(히스토리 규칙이 미묘하다), `StudioProvider`(가드가 많다), `useTileDrag`(포인터 취소 경로).

## 2. 정적 검사는 소리를 증명하지 않는다

`pnpm lint` · `check-types` · `test` · `build`가 전부 통과해도 **소리가 나는지는 아무것도 말해주지 않는다.** 재생·타이밍·악기를 건드렸으면 `pnpm dev`로 직접 들어야 한다.

`pnpm build`만은 예외적으로 의미가 있다 — 모듈 스코프에서 `AudioContext`를 만들면 서버 렌더링 중에 평가되어 여기서 깨진다. 정적 검사로는 안 잡힌다.

## 3. 확인하지 못한 것

| 항목 | 상태 | 확인 방법 |
| --- | --- | --- |
| **장시간 재생 드리프트** | 미확인 (2026-08-01부터) | 메트로놈을 켜고 30초 이상 완주시켜 박자가 밀리는지 듣는다. 짧은 청취로는 판단할 수 없다 |
| **Firefox·Safari에서 곡 저장** | 미확인 | `⭳ 저장`을 눌러 파일이 실제로 받아지는지. `revokeObjectURL` 지연 수정이 코드 리뷰만 거쳤다. Chrome은 이 패턴 없이도 동작하므로 Chrome 확인은 근거가 되지 않는다 |

## 4. CI 초록이 Windows 동작을 보장하지 않는다

저장소는 LF로 커밋하지만 Windows 체크아웃에서는 `core.autocrlf`가 CRLF로 바꾼다. CI는 `ubuntu-latest`라 LF로 받는다.

**파일 내용을 정규식으로 파싱하는 테스트는 `\r?\n`을 써야 한다.** `\n`만 쓰면 CI는 통과하고 Windows 로컬만 깨진다 — 2026-08-03에 `lib/score/format-doc.test.ts`가 정확히 그렇게 초록불로 머지됐다.

새로 만든 파일은 작성 직후에는 LF라 그 세션에서는 통과하고, `git checkout`으로 브랜치를 옮기는 순간 변환되어 깨진다. **작성한 세션에서는 절대 재현되지 않는다.**

## 5. 문서가 코드를 따라오지 못한 전례

- `README.md`가 "`create-next-app` 스캐폴드 단계, 아직 구현되지 않았다"고 말하는 동안 실제로는 편집·재생·저장이 다 되고 있었다
- `AGENTS.md`의 "아직 없는 것" 목록에 방금 만든 기능이 남아 있었다
- 설계 문서의 `file:line` 인용이 리팩터링 후 어긋났다

기능을 하나 끝내면 `AGENTS.md`와 `README.md`가 여전히 사실인지 확인한다. 특히 `AGENTS.md`는 에이전트가 매 세션 자동으로 읽으므로, 틀린 내용이 그대로 다음 작업의 전제가 된다.

`docs/song-file-format.md`는 `lib/score/format-doc.test.ts`가 지킨다 — 문서의 JSON 예시를 실제로 파싱해 보고 적힌 상수가 코드 값과 같은지 확인한다. 다른 문서에는 이런 장치가 없다.
