# 곡 파일 저장·불러오기 — 설계

작성일 2026-08-02 · 이전 슬라이스: [타일 편집](2026-08-01-tile-editing-design.md)

## 무엇을 만드는가

만든 곡을 JSON 파일로 내보내고 다시 가져온다. 지금은 새로고침하면 작업이 전부 사라진다 — 데모 곡이 다시 로드될 뿐이다.

```text
⭳ 저장       현재 곡을 bandline-song.json으로 다운로드
⭱ 불러오기   .json 파일을 골라 현재 곡을 교체 (Ctrl+Z로 되돌림)
```

## 범위

**포함**

- `lib/score/schema.ts` — zod 스키마
- `lib/score/serialize.ts` — `serializeSong` / `parseSong` 순수 함수
- 트랜스포트 바의 저장·불러오기 버튼
- 잘못된 파일 거부와 한국어 에러 문구
- **템포 소유권 정리** — 저장 기능이 드러내는 기존 결함 (아래 참고)

**제외** — 이후 슬라이스로

여러 곡 관리, localStorage 자동저장, MIDI/WAV 내보내기, 곡 이름 필드, 드래그앤드롭으로 열기, 최근 파일 목록, 자동 백업.

## 확정된 결정

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 저장 위치 | **파일만.** localStorage 자동저장은 안 한다 | 범위를 작게 유지한다. 파일은 백업과 기기 이동까지 되지만 자동저장은 둘 다 안 된다 |
| 검증 | **zod 도입** | 런타임 검증이 필요한 첫 지점이다. 스키마 하나로 검증·타입 추론·에러 경로가 다 나온다. 손으로 쓴 타입 가드는 필드를 더할 때 같이 고치는 걸 잊기 쉽다 |
| 잘못된 파일 | **구조는 거부, 값은 복구** | 구조가 틀리면 무엇을 의도했는지 알 수 없다. 정렬·범위처럼 의도가 명확한 것만 조용히 고친다 |
| 파일 형식 | `{ format, version, song }` 봉투 | `format`이 "Bandline 파일인가"를 판별한다. 봉투가 없으면 아무 JSON이나 떨궜을 때 "필드가 없습니다"밖에 말할 수 없다 |
| 덮어쓰기 사고 | **실행취소 스택에 쌓는다.** 확인 대화상자 없음 | `commitWith(() => loaded)` 한 줄이면 다른 편집과 규칙이 같아진다. 확인 창은 매번 뜨면 사람이 안 읽고 누른다 |
| 템포 | **`song.tempo`로 일원화** | 저장이 정확하려면 현재 템포가 곡 안에 있어야 한다. 아래 전용 절 참고 |
| 재생 중 | **저장·불러오기 둘 다 잠근다** | 불러오기는 `commitWith`를 쓰므로 `editable` 가드가 필수다. 저장만 열어두면 "왜 이건 되고 저건 안 되나"가 된다 |

## 파일 형식

```json
{
  "format": "bandline-song",
  "version": 1,
  "song": {
    "tempo": 120,
    "timeSignature": [4, 4],
    "lengthTicks": 30720,
    "lines": [
      {
        "id": "piano",
        "name": "피아노",
        "kind": "pitched",
        "instrument": "piano",
        "tiles": [
          { "id": "piano-0", "start": 0, "length": 480, "velocity": 0.7, "notes": [60, 64, 67] }
        ]
      }
    ]
  }
}
```

`song`은 `lib/score/types.ts`의 `Song`과 필드가 같다. 봉투만 새로 씌운다.

`Song`에 곡 이름 필드가 없으므로 다운로드 파일명은 `bandline-song.json` 고정이다. 같은 이름이 이미 있으면 브라우저가 `(1)`을 붙인다. 곡 이름은 이 슬라이스의 범위가 아니다 — 이름을 넣으려면 편집 UI와 곡 목록이 같이 필요하고, 그건 "여러 곡 관리" 슬라이스다.

`version`은 정수 하나다. **`1`이 아니면 거부한다.** 더 큰 값은 모르는 형식이고, 더 작은 값은 존재한 적이 없으므로 손으로 고쳤거나 손상된 파일이다. 둘 다 추측해서 열면 안 된다.

## 검증 레이어

파일 I/O는 브라우저 API다. `lib/score/`에 들어가면 순수성이 깨지고 브라우저 없이 테스트할 수 없게 된다.

```text
lib/score/schema.ts      zod 스키마. 순수. Web Audio도 React도 File API도 모른다
lib/score/serialize.ts   serializeSong(song): string
                         parseSong(text): ParseResult
                         순수 함수. vitest로 전부 커버된다
components/transport/    <input type="file"> · Blob 다운로드 · FileReader
```

```ts
export type ParseResult =
  | { ok: true; song: Song }
  | { ok: false; reason: string };
```

**`parseSong`은 예외를 던지지 않는다.** 호출부가 `try/catch` 없이 `reason`을 그대로 화면에 띄우기 위해서다. JSON 파싱 실패도 결과 객체로 감싼다.

`reason`은 이미 한국어 완성 문장이다. UI가 코드를 문구로 번역하지 않는다 — 번역표가 두 곳에 생기면 한쪽만 고치게 된다.

## 검증 정책

### 거부

| 항목 | 이유 |
| --- | --- |
| JSON으로 파싱되지 않음 | 파일이 아니다 |
| `format !== "bandline-song"` | 우리 파일이 아니다 |
| `version > 1` | 미래 버전이다. 모르는 필드를 추측해서 열면 조용히 곡이 망가진다 |
| 필드 누락·타입 불일치 | 무엇을 의도했는지 알 수 없다 |
| `kind`가 `pitched`/`drum` 밖 | 그릴 컴포넌트가 없다 |
| `instrument`가 4종 밖 | 엔진에 없는 악기다. 통과시키면 그 라인만 조용히 무음이 된다 |
| `notes`가 빈 배열 | 소리 안 나는 타일은 화면만 차지한다 |
| `notes`의 값이 0..127 정수 밖 | MIDI 범위 밖이다. **여기만은 클램프하지 않는다** — 세기를 클램프하면 소리 크기만 달라지지만 음높이를 클램프하면 곡이 조용히 다른 곡이 된다 |
| `lines`가 빈 배열 | 라인 추가 UI가 아직 없다. 빈 곡은 복구할 방법이 없는 상태다 |
| `lengthTicks < 120` | 타일 하나도 들어가지 않는 곡이다. 아래 복구 계산의 전제이기도 하다 |
| 라인 `id` 중복 | 편집 함수가 `find`로 첫 번째만 잡아 두 번째 라인은 영원히 편집되지 않는다 |
| 한 라인 안에서 타일 `id` 중복 | 같은 이유. 곡 전체 유일성은 요구하지 않는다 — `edit.ts`가 라인까지 확인하도록 이미 짜여 있다 |

### 복구

값이 명확히 잘못됐지만 의도가 분명한 경우다. 조용히 고쳐서 받는다.

| 항목 | 처리 |
| --- | --- |
| `start` / `length` / `lengthTicks`가 비정수 | 반올림. 틱은 정수가 불변식이다 |
| `velocity`가 0..1 밖 | 클램프. 넘치면 클리핑만 유발한다 |
| `tempo`가 40..240 밖 | 클램프. 트랜스포트 슬라이더의 범위와 같다 |
| `length`가 1스냅 미만 | `MIN_TILE_LENGTH`(120)로 올린다 |
| `start + length`가 곡 밖 | 경계에서 클램프. `edit.ts`의 규칙과 같다 |
| `tiles`가 `start` 오름차순이 아님 | 정렬 |

**정렬이 가장 중요하다.** 스케줄러의 커서가 `tiles[]` 인덱스라, 정렬이 깨진 곡을 받으면 재생 중 노트가 조용히 누락된다. 귀로도 잡기 어렵다. 파일 불러오기는 이 불변식을 바깥에서 깰 수 있는 첫 번째 입구다.

**겹침은 그대로 통과시킨다.** 이전 슬라이스가 "화음 안의 음마다 길이·세기를 다르게 주려면 타일을 겹쳐 놓는다"를 탈출구로 정해뒀다. 겹침은 버그가 아니라 기능이다.

### 두 단계로 나눈다

```text
schema.ts   타입·enum·필수 필드 검사 + 값 단위 복구(반올림, velocity·tempo 클램프)
              → 실패하면 여기서 끝. 거부 사유를 만든다
serialize.ts  곡 전체를 알아야 하는 복구(경계 클램프, 정렬, 최소 길이)
              → 스키마 통과 후에만 돈다
```

경계 클램프는 `lengthTicks`를 알아야 하므로 타일 하나만 보는 스키마 레벨에서 할 수 없다.

타일 하나를 고치는 순서는 이렇다. 각 단계가 앞 단계의 결과에 기대므로 순서를 바꿀 수 없다.

```text
1. start  = clamp(start, 0, lengthTicks - MIN_TILE_LENGTH)
2. length = clamp(length, MIN_TILE_LENGTH, lengthTicks - start)
3. 라인의 tiles를 start 오름차순 정렬
```

1번이 `start`를 먼저 당겨두므로 2번의 상한이 항상 `MIN_TILE_LENGTH` 이상이다. 곡 맨 끝에 붙은 짧은 타일도 최소 길이를 확보한다.

이 계산이 성립하려면 `lengthTicks >= MIN_TILE_LENGTH`여야 한다. **`lengthTicks`가 120 미만이면 거부한다** — 타일 하나도 들어가지 않는 곡이다.

정렬이 마지막인 이유는 앞 두 단계가 `start`를 바꾸기 때문이다.

## 템포 소유권

**이건 새 기능이 아니라 저장 기능이 드러내는 기존 결함이다.**

`lib/audio/engine.ts:177`의 `setSong`은 의도적으로 `bpm`을 건드리지 않는다. 주석이 이유를 적어뒀다.

> `bpm`은 건드리지 않는다. 생성자에서 곡의 템포로 시작한 뒤로는 `setTempo`가 소유한다. 여기서 `song.tempo`를 다시 넣으면 사용자가 슬라이더로 올려둔 템포가 편집 한 번에 곡의 원래 값으로 되돌아간다.

그 결과 `song.tempo`는 **현재 템포가 아니라 곡을 만들 때의 초기값**이다. `StudioProvider`는 별도로 `useState(song.tempo)`를 들고 있고, 슬라이더는 그쪽만 바꾼다.

지금까지는 아무도 `song.tempo`를 다시 읽지 않아서 문제가 되지 않았다. 저장은 정확히 그걸 한다.

```text
슬라이더를 160에 맞춤 → song.tempo는 여전히 120 → 저장하면 파일에 120
  → 다시 열면 120으로 재생된다
```

### 해결

`song.tempo`를 유일한 진실로 만든다.

```text
useSongHistory        replaceWithoutHistory(updater) 추가
StudioProvider        tempo useState 제거. song.tempo를 그대로 노출
  setTempo(bpm)       replaceWithoutHistory((s) => ({ ...s, tempo: bpm }))
                      + getEngine().setTempo(bpm)
```

**슬라이더는 히스토리에 쌓지 않는다.** 드래그 한 번에 `onChange`가 수십 번 불린다. `commitWith`를 쓰면 `Ctrl+Z` 50칸이 전부 템포로 채워져 실제 편집을 되돌릴 수 없게 된다.

이 선택의 이득:

- 저장이 정확해진다 — 화면의 템포가 곧 파일의 템포다
- 불러오기를 `Ctrl+Z`로 되돌리면 **곡과 템포가 같이** 돌아온다. 템포가 곡 안에 있으므로 공짜다
- 상태가 한 곳으로 모인다

`engine.ts`의 `setSong`은 그대로 둔다. 여전히 `bpm`을 건드리지 않고, `StudioProvider`가 필요할 때 `setTempo`를 명시적으로 부른다. 주석의 우려("편집 한 번에 원래 값으로 되돌아감")는 `setSong`이 `bpm`을 무시하는 한 계속 막혀 있다.

### 렌더 비용

`{ ...song, tempo: bpm }`은 `lines` 배열 참조를 그대로 넘긴다. 각 `line` 객체도 동일하므로 `TileLine`(`components/timeline/TileLine.tsx:151`의 `memo`)과 `DrumGrid`의 memo가 유지된다.

`Timeline` 자체는 리렌더되지만, context value가 바뀌면 지금도 리렌더되고 있다. 프로파일은 달라지지 않는다.

## 상태 반영

`StudioProvider`에 액션 하나를 더한다.

```ts
loadSong: (song: Song) => void
```

동작 순서:

1. 재생 중이면 아무것도 하지 않는다 (`playingRef` 가드 — 편집 핸들러와 같다)
2. `commitWith(() => song)` — 실행취소 스택에 쌓인다
3. `getEngine().setTempo(song.tempo)` — 엔진의 bpm을 새 곡에 맞춘다
4. `setSelection(null)` — 불러온 곡에 이전 선택이 있을 리 없다. 안 지우면 존재하지 않는 타일의 팝오버가 뜬다
5. `setError(null)` — 이전 실패 문구를 지운다

`song`이 바뀌면 기존 effect(`StudioProvider.tsx:160`)가 `getEngine().setSong(song)`을 부른다. 별도 처리가 필요 없다.

**3번이 2번보다 뒤에 있어야 한다.** `setTempo`를 먼저 부르면 `replaceWithoutHistory`가 옛 곡의 템포를 갱신하고, 그 직후 `commitWith`가 그걸 통째로 덮어쓴다.

## UI

트랜스포트 바의 실행 취소 버튼 오른쪽에 둘을 더한다.

```text
[▶ 재생] [↩ 실행 취소] [⭳ 저장] [⭱ 불러오기] │ 001:1 │ ♩ ──── 120 │ ☐ 메트로놈
```

기존 버튼과 같은 클래스를 쓴다. 둘 다 `disabled={!editable}`이다.

### 내보내기

`serializeSong(song)` → `Blob` → `URL.createObjectURL` → `<a download>` 클릭 → **`URL.revokeObjectURL`**.

마지막을 빼면 곡 하나가 탭이 닫힐 때까지 메모리에 남는다.

### 가져오기

숨은 `<input type="file" accept="application/json,.json" className="sr-only">`를 버튼이 `click()`으로 연다.

> **`onChange` 처리가 끝나면 `event.target.value = ""`로 비운다.**
>
> 안 그러면 같은 파일을 두 번 연속 고를 때 `change`가 오지 않는다 — 값이 안 바뀌었으니까. 파일을 고쳐서 다시 여는 게 정확히 그 시나리오라 반드시 밟게 된다.

읽기는 `await file.text()`다. `FileReader` 콜백보다 짧고, 실패는 `try/catch`로 잡아 `파일을 읽지 못했습니다.`로 바꾼다.

접근성: 두 버튼 모두 실제 `<button>`이고 `aria-label`을 단다. 파일 input은 `sr-only`로 숨기되 DOM에서 제거하지 않는다.

## 에러 문구

`StudioProvider`의 기존 `error` state와 트랜스포트 바의 `notice` 자리를 재사용한다.

zod 이슈는 **첫 번째 것만 한 줄로** 줄인다. `notice`가 `ml-auto`로 오른쪽에 붙는 구조라 여러 줄이 들어가면 레이아웃이 밀린다.

| 상황 | 문구 |
| --- | --- |
| JSON 파싱 실패 | `JSON 파일이 아닙니다.` |
| `format` 불일치 | `Bandline 곡 파일이 아닙니다.` |
| `version`이 미래 | `더 새로운 버전에서 만든 파일입니다.` |
| 스키마 위반 | `파일이 손상되었습니다 (lines[2].tiles[7].velocity)` |
| 파일 읽기 실패 | `파일을 읽지 못했습니다.` |

## 테스트

`lib/score/serialize.test.ts` — 순수 함수라 브라우저 없이 vitest로 전부 커버된다.

- **왕복** — `parseSong(serializeSong(buildDemoSong()))`가 원본과 깊은 값이 같다
- **거부** — 위 거부 표의 각 항목마다 하나씩
- **복구** — 뒤섞인 `tiles`가 정렬돼 나온다 · `velocity: 1.5` → `1` · 곡 밖 `start` 클램프 · 비정수 `start` 반올림 · `length: 30` → `120`
- **복구의 경계** — 곡 맨 끝(`start = lengthTicks - 20`)에 붙은 타일이 `start`를 당겨서라도 `MIN_TILE_LENGTH`를 확보한다. 위 3단계 순서가 실제로 지켜지는지 보는 케이스다
- **복구 결과가 다시 유효하다** — 복구된 곡을 `edit.ts`의 함수에 넣어도 정렬 불변식이 유지된다
- **거부는 예외를 던지지 않는다** — 모든 실패 경로가 `{ ok: false }`를 반환한다

`useSongHistory.replaceWithoutHistory`도 테스트한다 — 곡은 바뀌고 `canUndo`는 그대로여야 한다.

파일 I/O(`Blob`, `URL.createObjectURL`, `file.text()`)는 브라우저 API라 테스트하지 않는다.

## 검증

```bash
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

정적 검사는 소리에 대해 아무것도 증명하지 않는다. `pnpm dev`로 다음을 직접 확인한다.

1. 타일 몇 개를 찍고 **템포를 슬라이더로 바꾼 뒤** 저장한다
2. 새로고침한다 (데모 곡으로 돌아간다)
3. 저장한 파일을 불러온다 — 타일과 **템포 슬라이더 위치**가 그대로여야 한다
4. 재생해서 **바꾼 템포로 울리는지 귀로 확인한다** — 이게 템포 일원화의 핵심 검증이다
5. `Ctrl+Z` — 곡과 템포가 함께 데모 곡으로 돌아와야 한다
6. 같은 파일을 연속 두 번 불러온다 — 두 번째도 동작해야 한다 (input value 리셋)
7. 아무 `.json`(예: `package.json`)을 불러온다 — `Bandline 곡 파일이 아닙니다.`가 떠야 한다
8. 재생 중에는 두 버튼이 비활성화돼 있어야 한다
