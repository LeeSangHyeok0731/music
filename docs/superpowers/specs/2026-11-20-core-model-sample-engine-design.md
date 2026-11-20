# 코어 모델과 샘플 엔진 재설계

작성일: 2026-11-20
상태: 설계 승인됨, 구현 계획 전

Bandline을 "음악 비전공자의 아이디어 스케치 도구"로 다시 잡는다. 이 문서는 그 재구상의 **하위 프로젝트 1** — 곡 데이터 모델과 샘플 기반 오디오 엔진 — 만 다룬다.

## 1. 재구상의 결정 사항

| 항목 | 결정 |
| --- | --- |
| 제품 | 음악 비전공자의 아이디어 스케치 도구 |
| 핵심 조작 | 코드·패턴 블록 조립 + 음 단위 편집, 둘 다 가능 |
| 출구 | 오디오 파일 내보내기, URL 인코딩 링크 공유, JSON 내보내기 |
| 후속(이 문서 범위 밖) | 악보 PDF를 화면에 찍어 주는 가져오기 |
| 음원 | 샘플 기반. CC0·퍼블릭 도메인 샘플 팩만 쓴다 |
| 기기 | 편집은 데스크톱. 재생·공유 링크는 모바일 지원 |
| 작업자 보호 | 이름 새기기 + 공개키 서명 검증. 서버 없음 |
| 기존 코드 | 새로 짠다. 검증된 순수 로직만 새 모델에 맞춰 옮긴다 |

### 하위 프로젝트 분해

각각 spec → plan → 구현 사이클을 따로 돈다.

1. **코어 모델 + 샘플 엔진** (이 문서)
2. 편집 UI — 블록 조립 화면, 음 단위 편집, 되돌리기
3. 공유·모바일 재생 — URL 코덱, 서명 검증, 재생 전용 뷰
4. 오디오 내보내기 — `OfflineAudioContext` 렌더링
5. (후속) 악보 PDF 가져오기

## 2. 이 하위 프로젝트의 범위

**한다:** `lib/score/`(새 모델, 펼치기, 스키마), `lib/audio/`(스케줄러 이식, 샘플 엔진), 이를 검증하는 테스트, 소리를 직접 듣기 위한 최소 검증 화면.

**하지 않는다:** 편집 UI, 링크 코덱, 서명 생성·검증 로직, 오디오 내보내기, PDF 가져오기. 단, 뒤의 하위 프로젝트가 모델을 다시 깨지 않도록 **필드 자리는 이 문서에서 확정한다**(3.4절).

**기존 `components/`와 `state/`는 이 단계에서 삭제한다.** 옛 곡 모델에 묶여 있어 새 모델과 함께 타입 검사를 통과시킬 수 없고, 하위 프로젝트 2에서 새로 짠다. 그 사이 앱의 사용자 화면은 6절의 최소 검증 화면뿐이다.

## 3. 곡 데이터 모델 (`lib/score/`)

순수 TS. Web Audio도 React도 import하지 않는다. 브라우저 없이 전부 검증할 수 있어야 한다.

### 3.1 타입

```text
Song     { v: 2, tempo, timeSignature: [number, number], bars, tracks: Track[], meta: SongMeta }
Track    { id, instrument: InstrumentId, clips: Clip[] }
Clip     { id, start, length, body: ChordBody | NotesBody }
ChordBody { type: "chord", chord: Chord, pattern: PatternId }
NotesBody { type: "notes", notes: Note[] }
Chord    { root: 0..11, quality: "maj" | "min" | "dom7" | "maj7" | "min7" }
Note     { start, length, pitch: 0..127, velocity: 0..1 }
```

- 시간 단위는 `PPQ = 480` 정수 틱이다. `Clip.start`, `Clip.length`, `Note.start`, `Note.length`는 모두 정수다.
- `Note.start`는 **클립 시작 기준 상대 틱**이다. 클립을 옮겨도 음을 다시 쓰지 않는다.
- 곡 길이는 `bars`(마디 수, 정수)이고 전체 틱은 `bars × ticksPerBar`로 파생한다. 상한은 500마디다. 음악적 제한이 아니라 렌더 비용 가드다.
- `InstrumentId`는 `"piano" | "guitar" | "bass" | "drums"`로 시작한다. 현재 코드가 가진 4종과 같고, 일렉기타는 이 단계에서 만들지 않는다. 값을 늘리는 것은 하위 호환이다.
- `Chord.quality`는 닫힌 열거형이다. 새 값은 추가만 한다. 새 값이 든 링크를 옛 앱이 열면, 조용히 다른 코드로 읽지 않고 **거부**한다.
- 드럼 트랙은 `kind` 분기가 없다. 드럼 트랙의 음은 GM 드럼 번호를 `pitch`로 가진 일반 `Note`다. 스케줄러와 펼치기는 트랙 종류를 읽지 않는다.

### 3.2 불변식

- `Track.clips`는 `start` 오름차순이다.
- **같은 트랙의 클립은 시간상 겹치지 않는다.** `clips[i].start + clips[i].length <= clips[i+1].start`. 화음은 이와 무관하다 — `notes` 클립 안에서 같은 시각의 음은 몇 개든 가질 수 있다.
- 모든 클립은 곡 안에 들어간다: `0 <= start`, `start + length <= bars × ticksPerBar`.
- `Clip.id`는 트랙 안에서, `Track.id`는 곡 안에서 유일하다.
- `NotesBody.notes`는 `start` 오름차순이고, 모든 음은 클립 안에 들어간다: `0 <= note.start`, `note.start + note.length <= clip.length`.
- `length >= 1` (틱). 길이 0인 클립·음은 만들지 않는다.

겹침 불가는 편집 함수가 지킨다. 겹치는 곳에 클립을 놓으려 하면 놓을 수 없다(밀어내기 같은 자동 보정은 하지 않는다). 스키마 검증은 겹침을 **거부**한다 — 순서는 복구해도 겹침은 의도를 알 수 없다.

### 3.3 패턴 카탈로그와 펼치기

패턴은 곡 파일에 저장하지 않는다. 코드에 내장한 카탈로그(`lib/score/patterns.ts`)에서 `PatternId`로 참조한다. 그래서 공유 URL이 작다.

```text
Pattern { id, length, steps: PatternStep[] }          // length는 틱. 클립 길이에 맞춰 반복된다
PatternStep（화음 악기） { at, length, degree, octave, velocity }
PatternStep（드럼）      { at, length, pitch, velocity }
```

- 화음 악기 패턴의 `degree`는 코드 구성음의 순번이다(0 = 근음, 1 = 3음, 2 = 5음, 3 = 7음). `pitch`는 `Chord`와 `octave`에서 계산한다. 드럼 패턴은 코드를 읽지 않는다.
- **패턴 id는 불변이다.** 패턴을 고치고 싶으면 새 id를 만든다. 옛 링크가 다른 소리로 재생되는 것을 막는 유일한 방법이다. 이 규칙은 테스트로 지킨다(5절).
- 반복은 패턴 길이마다 끊고, 클립 끝을 넘는 음은 클립 끝에서 자른다.

펼치기는 순수 함수다.

```text
expandSong(song) → TrackEvents[]
TrackEvents      { trackId, instrument, events: ScheduledNote[] }
ScheduledNote    { tick, length, pitch, velocity }      // tick은 곡 시작 기준 절대 틱
```

- `events`는 `tick` 오름차순이고 같은 `tick`은 입력 순서를 유지한다(안정 정렬). 정렬은 불변식이다.
- **재생과 내보내기는 같은 `expandSong`을 쓴다.** 들은 것과 내보낸 것이 다를 수 없게 하는 구조다.
- `bake(clip, track, song) → Clip`: `chord` 클립을 같은 `id`·`start`·`length`의 `notes` 클립으로 바꾼다. 한 방향이다. 음 단위 편집을 시작하면 이 변환이 먼저 일어나고, 되돌리기 스택에서는 이 변환이 한 칸이다.
- 악보 PDF 가져오기는 결국 `notes` 클립을 만드는 또 하나의 입력 경로다. 이 모델은 그 때문에 바뀌지 않는다.

### 3.4 작업자·서명 자리 (필드만 확정)

```text
SongMeta { title, author?: Author, editors: Author[], signature?: string }
Author   { name, publicKey }
```

- 이 단계에서는 필드와 스키마 검증(문자열 길이 상한 등 형식)만 둔다. **서명을 만들고 검증하는 로직, 서명 대상 바이트열의 정규화 규칙은 하위 프로젝트 3의 spec에서 정한다.**
- 그때 서명 대상에서 `meta`를 제외할지, 편집자 이력을 어떻게 연쇄 서명할지를 정한다. 필드가 지금 있으므로 그 결정이 `v: 2` 링크를 깨지 않는다.
- 서버 없이 강제할 수 있는 것은 "누가 만들었는지의 증명"까지다. "작업자만 편집"은 UI 수준의 제한이며 암호학적 보장이 아니다. 이 한계는 하위 프로젝트 3의 UI 문구에도 드러낸다.

### 3.5 스키마와 복구 정책

zod 스키마가 구조를 검증한다. 기존 정책을 그대로 따른다.

- **거부:** 구조가 틀림, 알 수 없는 `v`, 알 수 없는 `InstrumentId`·`Chord.quality`·`PatternId`, 클립 겹침, 클립이 곡 밖.
- **복구하고 복구했다고 알림:** 정렬이 어긋남, 소수점이 있는 틱(반올림), 범위를 넘은 `velocity`(클램프), 클립 밖으로 나간 음(클립 끝에서 자름).
- 유한한 수만 받는다(`Infinity`, `NaN` 거부).

## 4. 오디오 엔진 (`lib/audio/`)

React를 import하지 않는다. UI는 명령형 메서드로만 이 레이어를 건드린다.

### 4.1 유지하는 골격

- AudioContext는 앱 전체에 하나이고 첫 사용자 제스처 뒤에 지연 생성한다. 모듈 스코프에서 만들지 않는다.
- 25ms 타이머가 100ms lookahead 안의 이벤트를 `ctx.currentTime` 기준 절대 시각에 예약한다. 노트를 `setTimeout`/`rAF`로 하나씩 울리지 않는다.
- `Scheduler`는 앵커 방식이다. 재생 위치를 `pos += delta`로 굴리지 않고 저장된 앵커에서 매번 계산한다. 템포를 바꾸면 이미 예약된 구간은 옛 템포로 두고, 예약 경계에 새 앵커를 놓는다. `prevAnchor`로 `currentTick()`이 거꾸로 튀지 않게 한다.
- `Engine.play()`는 `await` 앞에서 세션 번호를 발급해 play/stop 레이스를 막는다.
- `AudioContextProvider`를 주입받는다. 브라우저 없이 `fake-audio`로 엔진을 테스트하고, 내보내기에서는 같은 구조로 `OfflineAudioContext`를 끼운다.
- `VoicePool`(폴리포니 상한, 보이스 스틸링)과 마스터 게인 스테이지를 유지한다.

### 4.2 바뀌는 것

**스케줄러의 입력이 `Song`이 아니라 `TrackEvents[]`다.** `events`가 시간순이므로 트랙별 커서 인덱스로 다음 구간만 보는 방식이 그대로 유효하고, 틱 안에서 전체 스캔을 하지 않는다.

**`Engine.setSong(song)`이 템포까지 한 번에 적용한다.** 옛 설계는 `Engine.setSong`이 `bpm`을 건드리지 않아서, 곡을 통째로 바꾸는 호출부가 `setTempo`를 따로 불러야 했다. 빠뜨리면 화면과 재생 속도가 영구히 갈라졌다. 새 설계에서 `song.tempo`는 유일한 진실이고, `setSong`이 다음을 원자적으로 한다.

1. `expandSong`으로 이벤트를 만들고
2. 템포를 적용하고
3. 트랙 구성(id·instrument 순서)이 바뀌었으면 악기 맵을 다시 채우고
4. 곡에 쓰인 악기의 샘플 로딩을 요청한다

재생 중에는 `setSong`을 거부한다(트랙 커서가 이벤트 인덱스라, 재생 중 이벤트가 바뀌면 노트가 조용히 누락된다). 재생 중 허용되는 곡 변경은 `setTempo`뿐이다.

### 4.3 샘플 계층

```text
SampleBank   악기별 샘플 로딩·디코드·캐시
             load(instrument) → Promise<void>
             status(instrument) → "idle" | "loading" | "ready" | "error"
Instrument   play(pitch, when, dur, velocity)           // 시그니처는 옛 설계와 같다
```

- **`Instrument.play()` 시그니처는 바꾸지 않는다.** 스케줄러·엔진·테스트가 악기 구현과 분리된 채 남는다. 구현만 오실레이터 신스에서 샘플 재생으로 바뀐다. 신스는 폴백으로도 남기지 않는다.
- 악기마다 `public/samples/<instrument>/manifest.json`이 존(zone) 목록을 가진다: `{ file, centerPitch, loPitch, hiPitch }`.
- 음 높이는 `loPitch..hiPitch`를 덮는 존의 샘플을 `playbackRate = 2^((pitch - centerPitch) / 12)`로 보정해 만든다. 건반마다 샘플을 두지 않고 몇 음 간격으로만 둔다.
- 드럼은 GM 번호마다 샘플 하나이고 음높이 보정을 하지 않는다.
- 음 길이는 `when + dur`에 짧은 릴리즈 페이드로 끝낸다. 샘플이 음 길이보다 길면 페이드로 자르고, 짧으면 그대로 끝난다.
- `AudioBufferSourceNode`는 일회용이다. 노트마다 새로 만들고 `onended`에서 `disconnect()`한다. `decodeAudioData`는 악기당 한 번, 캐시된 `AudioBuffer`를 재사용한다.
- 샘플 파일 형식은 대상 브라우저(Chrome, Firefox, Safari 데스크톱·모바일)가 전부 디코드하는 하나로 정한다. 구현 계획의 첫 작업에서 Safari 디코드를 직접 확인하고 확정한다.

**지연 로딩:** 곡에 실제로 쓰인 악기의 샘플만 받는다. 공유 링크를 열면 그 곡의 트랙 목록으로 필요한 악기를 알 수 있다.

**재생 전 보장:** 곡이 쓰는 악기가 하나라도 `ready`가 아니면 `play()`는 소리를 시작하지 않고 로딩 상태를 돌려준다. 로딩되지 않은 악기가 조용히 무음이 되는 경로를 만들지 않는다. 옛 설계에서 라인이 조용히 무음이 된 사고가 있었다.

**다운로드 예산:** 첫 재생에 필요한 샘플 총량은 **약 5MB 이내**, 악기당 약 1MB 안팎이다. 이 값은 테스트로 지킨다(5절).

**샘플 출처:** CC0·퍼블릭 도메인 팩만 쓴다. 팩마다 이름·출처 URL·라이선스·내려받은 날짜를 `public/samples/LICENSES.md`에 기록한다. 구현 계획 단계에서 후보 팩을 고르고 이 파일을 채운다. 라이선스가 확인되지 않은 파일은 저장소에 넣지 않는다.

## 5. 이식 대상

| 옮긴다 (새 모델에 맞춰 수정) | 버린다 |
| --- | --- |
| `Scheduler`의 앵커·`prevAnchor` 로직과 테스트 (입력만 `TrackEvents[]`로) | 신스 악기(`lib/audio/instruments/*`) |
| `Engine`의 세션 번호 레이스 방어, `AudioContextProvider` 주입, `fake-audio` | `components/` 전체, `state/StudioProvider` |
| `VoicePool` | 타일 중심 편집 함수(`lib/score/edit.ts`)의 API — 클립 모델로 다시 쓴다 |
| zod 스키마의 "구조는 거부, 정렬·범위는 복구" 정책 | `assignLanes` (클립 겹침 불가로 필요 없다) |
| `useSongHistory`의 히스토리 규칙(제자리에 놓으면 기록하지 않음 등)과 테스트 | 옛 곡 파일 형식과 `docs/song-file-format.md`의 v1 규칙 |

`useSongHistory`는 하위 프로젝트 2의 편집 UI가 쓰는 것이므로, 이 단계에서는 **순수 히스토리 규칙 함수만** `state/` 밖의 `lib/`로 옮겨 테스트와 함께 둔다. 훅 본체는 하위 프로젝트 2에서 새로 짠다.

옛 v1 파일은 이 하위 프로젝트에서 읽지 않는다. 아직 외부에 공개된 링크나 사용자가 없다는 전제이며, 필요하면 하위 프로젝트 3에서 변환기를 따로 정한다.

## 6. 최소 검증 화면

소리를 직접 듣고 검증하기 위한 화면이다. **편집 UI가 아니다.** `app/`의 한 라우트에 둔다.

- 데모 곡(코드 클립 몇 개와 `notes` 클립 하나, 드럼 트랙 포함)을 코드에 내장해 불러온다.
- 재생/정지, 템포 슬라이더, 메트로놈 토글.
- 악기별 샘플 로딩 상태(`idle`/`loading`/`ready`/`error`)와 실패 시 재시도 버튼.
- 현재 마디·박(10Hz 샘플링). 플레이헤드처럼 매 프레임 바뀌는 값은 엔진 안에만 있고 `useState`에 넣지 않는다.

## 7. 테스트 전략

최근 결함이 모두 `state/`와 `components/`에서 나왔고 그 계층에는 테스트가 없었다. 새 설계는 처음부터 다르게 간다.

- **규칙이 든 로직은 훅과 컴포넌트에 두지 않고 `lib/`의 순수 함수로 뺀다.** 예를 들어 "곡을 갈아끼울 때 엔진에 무엇을 맞춰야 하는가"는 호출부의 암묵적 책임이 아니라 `Engine.setSong` 하나가 맡는다(4.2절).
- `@testing-library/react`와 `jsdom`을 이 하위 프로젝트에서 설치하고 `vitest.config.mts`를 환경별로 나눈다. `lib/**`는 `node`, `state/**`·`components/**`는 `jsdom`이다. 이 단계의 컴포넌트는 6절 화면뿐이지만, 하위 프로젝트 2가 시작할 때 설정이 이미 있어야 한다.
- 파일 내용을 정규식으로 파싱하는 테스트는 `\r?\n`을 쓴다. CI(Linux, LF)가 초록이어도 Windows(CRLF)가 깨질 수 있다.

검증할 항목:

| 영역 | 확인할 것 |
| --- | --- |
| `expandSong` | 코드 클립이 코드·패턴대로 펼쳐진다, 클립 끝에서 음이 잘린다, `events`가 시간순·안정 정렬이다, 클립 시작 위치가 절대 틱에 반영된다 |
| `bake` | 펼친 결과와 같은 음이 `notes` 클립이 된다, `id`·`start`·`length`가 유지된다 |
| 불변식·스키마 | 겹침 거부, 곡 밖 클립 거부, 알 수 없는 id 거부, 정렬·범위·소수 틱 복구, `Infinity`·`NaN` 거부 |
| 패턴 카탈로그 | 패턴 id의 **고정 샘플 테스트** — 각 패턴을 펼친 결과를 스냅샷으로 저장하고, 바뀌면 실패한다. 패턴이 몰래 바뀌어 옛 링크 소리가 달라지는 것을 막는다 |
| `Scheduler` | 기존 테스트를 이식. 구간 선택, 템포 변경 앵커, `currentTick`이 뒤로 튀지 않음 |
| `Engine` | play/stop 레이스, `setSong`이 템포·악기 맵·샘플 로딩을 한 번에 맞춘다, 재생 중 `setSong` 거부, 로딩되지 않은 악기가 있으면 재생이 시작되지 않음 |
| 샘플 계층 | 존 선택, `playbackRate` 계산, 로딩 실패 상태와 재시도, 노드 `disconnect`. `fake-audio`로 검증 |
| 예산 | 각 `manifest.json`이 가리키는 파일이 실제로 존재하고, 첫 재생에 필요한 총 크기가 5MB 이내다 |
| 히스토리 규칙 | 이식한 규칙 테스트 |

**소리 자체는 자동으로 검증되지 않는다.** 정적 검사와 테스트가 모두 통과해도 소리가 나는지는 알 수 없다. 이 하위 프로젝트는 완료 기준에 **`pnpm dev`로 6절 화면에서 직접 듣기**를 포함한다. 들어서 확인할 것: 악기 4종이 동시에 울리는 구간에서 끊김이 없는지, 메트로놈을 켜고 30초 이상 재생해도 박자가 밀리지 않는지. 직접 듣지 못했으면 그렇게 명시한다.

## 8. 오류 처리

- **샘플 로딩 실패:** 해당 악기를 `error` 상태로 두고 UI에 보여 주며 재시도를 준다. 곡의 다른 악기는 영향을 받지 않는다. 조용히 무음이 되지 않는다.
- **손상되었거나 알 수 없는 버전의 곡:** 구조가 틀리거나 알 수 없는 `v`면 열지 않고 이유를 알려 준다. 범위·정렬 문제는 복구하고 복구했다고 알린다.
- **`AudioContext`:** 자동재생 정책으로 `resume()`이 거부되면 `play()`가 실패하고, `playing` 플래그는 그 세션이 자기 것일 때만 되돌린다(기존 방어 유지).
- **지원하지 않는 브라우저:** `isAudioSupported()`가 거짓이면 재생 UI를 막고 이유를 보여 준다.

## 9. 완료 기준

1. `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build`가 통과한다.
2. 7절의 모든 항목에 테스트가 있다.
3. 샘플 예산 테스트가 통과하고 `public/samples/LICENSES.md`가 모든 팩을 기록한다.
4. `pnpm dev`로 6절 화면에서 데모 곡을 직접 들었다. 못 들었으면 그렇게 명시한다.
5. `AGENTS.md`의 "현재 상태"와 "아직 없는 것", `docs/known-gaps.md`, `.claude/rules/frontend-architecture.md`의 디렉터리 구조가 새 모델·삭제된 계층을 반영한다. 문서가 코드를 따라오지 못한 전례가 있다.

## 10. 알려진 위험

- **샘플 품질:** CC0 팩은 팩마다 품질이 다르다. 고른 팩이 "곡 같은" 소리를 못 내면 이 제품의 핵심 가치가 약해진다. 구현 계획의 초반에 후보 팩으로 짧은 청취를 하고 고른다.
- **Safari 디코드:** 파일 형식 선택(4.3절)이 모바일 Safari에서 실제로 동작하는지 직접 확인해야 한다. 정적 검사는 이를 알려 주지 않는다.
- **편집 UI가 없는 기간:** 하위 프로젝트 2가 끝나기 전에는 사용자가 곡을 만들 수 없다.
