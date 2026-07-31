# 타일 타임라인 재생 — 설계

작성일 2026-07-31 · 브랜치 `feat/tile-timeline-playback`

## 무엇을 만드는가

Bandline의 첫 수직 슬라이스. 하드코딩된 곡을 악기 라인 위에 타일로 그리고, 재생하면 플레이 플래그가 왼쪽에서 오른쪽으로 지나가며 그 자리의 타일이 소리를 낸다. 여러 라인이 동시에 울린다.

```text
┌─────────────────────────────────┐
│ ▶ ■   ♩120   003:2   [✓]메트로놈 │
├───────┬────▼────────────────────┤
│피아노 │[C4·E4·G4] │[B3·D4·F4]   │
│기타   │ [D3][D3]  │[G3]         │
│베이스 │[C2]       │[G1]         │
│드럼   │■···■···   │■·■·         │
└───────┴─────────────────────────┘
```

편집은 없다. 이 슬라이스의 목적은 **곡 데이터 모델 · 오디오 엔진 · 스케줄러 · 렌더링 · 플래그**가 한 줄로 이어져 실제로 소리가 나고 타이밍이 맞는지를 증명하는 것이다.

## 범위

**포함**

- 곡 데이터 모델 (`lib/score/`)과 틱↔초 변환
- `AudioContext` 수명주기, look-ahead 스케줄러, 트랜스포트
- 오실레이터 기반 신스 악기 4종 (피아노 / 기타 / 베이스 / 드럼)
- 읽기 전용 타임라인 — 라인, 타일, 드럼 격자, 마디선
- rAF로 움직이는 플레이 플래그 + 자동 스크롤
- 트랜스포트 바 — 재생/정지, 템포 슬라이더, 마디:박 표시, 메트로놈 토글
- Vitest 도입과 순수 로직 단위 테스트

**제외** — 이후 슬라이스로

타일 편집(생성·이동·길이 조절·삭제), 타일 설정 패널, 드럼 칸 토글, 루프, 시크, 줌, 라인 추가/삭제, 저장/불러오기, 샘플 음원, 일렉기타(신스 악기 5종째).

## 확정된 결정

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 타일의 단위 | 동시에 울리는 음 묶음 (`notes: number[]`) | 라인 높이가 고정되어 화면이 안정적. 코드 단위로 생각하기 쉬움 |
| 화음 안의 음을 따로 다뤄야 할 때 | 같은 라인·같은 시점에 타일을 겹쳐 놓는다 | 모델을 복잡하게 하지 않고 예외를 처리하는 탈출구 |
| 드럼 | 화면은 16칸 격자, 데이터는 나머지 라인과 동일한 `Tile` | `lib/score`와 스케줄러에 분기가 생기지 않음. 대신 편집 은유가 두 가지가 되는 비용을 받아들임 |
| 음원 | 전부 오실레이터 신스 | 다운로드 0MB, 라이선스 문제 없음, 첫 소리까지 최단. 악기 인터페이스를 고정해 두면 나중에 샘플로 교체 가능 |
| 타임라인 렌더링 | DOM 타일 + 별도 플래그 레이어 | 다음 슬라이스가 편집이라 히트 테스트가 공짜인 쪽이 유리. 성능이 문제되면 윈도잉으로 점진 이행 가능 |
| 검증 | Vitest 단위 테스트 + 메트로놈 청취 | 시간 변환과 스케줄러는 이후 모든 기능이 올라탈 바닥이라 회귀를 자동으로 잡아야 함 |

Canvas 렌더링은 채택하지 않았다. "재생 중 리렌더 0"은 렌더링 방식이 아니라 레이어 분리로 달성되므로 Canvas의 이점이 이 슬라이스에서 나오지 않고, 편집 슬라이스에서 클릭 판정·드래그·텍스트·포커스를 전부 직접 만들어야 하는 비용이 크다. 나중에 파형이나 오토메이션 곡선처럼 픽셀 단위 그리기가 필요해지면 그 레이어만 Canvas로 얹는다.

## 레이어

`.claude/rules/frontend-architecture.md`의 3계층 경계를 그대로 따른다. 이번 슬라이스가 실제로 만드는 파일만 적으면:

```text
lib/score/      순수 TS. Web Audio도 React도 import하지 않는다
  types.ts      Song / Line / Tile
  time.ts       틱 ↔ 초, 틱 → 마디:박
  fixture.ts    하드코딩된 16마디 데모 곡

lib/audio/      순수 TS. React를 import하지 않는다
  context.ts    AudioContext 지연 생성 + resume
  instruments/  신스 4종, 공통 인터페이스
  scheduler.ts  look-ahead 예약
  transport.ts  재생 상태 소유, play/stop/setTempo, 현재 틱

state/
  StudioProvider.tsx   엔진 인스턴스 1개 + React UI 상태

components/
  timeline/     Timeline, LineHeaders, TileLine, DrumGrid, Playflag, BarLines
  transport/    TransportBar
```

임포트는 `@/` alias로 해결한다. `src/`나 feature 레이어는 두지 않는다.

## 데이터 모델

```ts
export const PPQ = 480;          // 4분음표 = 480틱

export type Tile = {
  id: string;
  start: number;                 // 틱, 정수, 곡 시작 기준 절대값
  length: number;                // 틱, 정수
  velocity: number;              // 0..1
  notes: number[];               // 동시에 울릴 MIDI 번호
};

export type Line = {
  id: string;
  name: string;                  // "피아노"
  kind: "pitched" | "drum";      // 렌더러 선택에만 쓰인다
  instrument: InstrumentId;
  tiles: Tile[];                 // start 오름차순 — 불변식
};

export type Song = {
  tempo: number;                 // BPM
  timeSignature: [number, number];
  lengthTicks: number;
  lines: Line[];
};

export type InstrumentId = "piano" | "guitar" | "bass" | "drums";
```

**시간은 전부 정수 틱으로 저장한다.** 초로 저장하면 템포를 바꾸는 순간 곡 전체가 어긋난다. 초 변환은 예약 직전에 그때의 템포로 한 번만 한다.

**드럼도 같은 `Tile`이다.** 격자 한 칸이 켜지면 `notes: [36]`짜리 타일 하나다. GM 관행대로 36 킥 / 38 스네어 / 42 하이햇. `kind`는 어느 컴포넌트로 그릴지만 고르고, 스케줄러와 `lib/score`는 이 필드를 읽지 않는다.

드럼 타일의 `length`는 격자 한 칸에 해당하는 **16분음표 120틱으로 고정**한다. 드럼 소리는 엔벨로프가 스스로 감쇠해 끝나므로 이 값은 실제 울림 길이가 아니라 격자 칸의 폭을 뜻한다. 격자에는 길이 조절이 없다.

**`tiles[]`의 `start` 오름차순은 불변식이다.** 스케줄러가 매 틱마다 전체를 스캔하지 않고 커서 인덱스로 다음 구간만 보기 위한 전제다. 깨지면 노트가 조용히 누락되므로 fixture 로드 시점에 정렬을 보장하고, 단위 테스트로 검사한다.

`time.ts`는 브라우저가 필요 없는 순수 함수다.

```ts
ticksToSeconds(ticks: number, bpm: number): number
secondsToTicks(sec: number, bpm: number): number
ticksToBarBeat(ticks: number, ts: [number, number]): { bar: number; beat: number }
```

## 오디오 엔진

### 컨텍스트 수명주기

`AudioContext`는 모듈 스코프에서 만들지 않는다. 서버 렌더링과 빌드 중에 실행되어 깨진다. 재생 버튼의 클릭 핸들러 안에서 처음 생성하고 `await ctx.resume()`까지 같은 핸들러에서 끝낸다. 탭이 백그라운드로 갔다 오면 다시 `suspended`가 될 수 있으므로 재생 시작마다 상태를 확인한다. 앱 전체에 컨텍스트는 하나다.

### 노드 그래프

```text
보이스(osc/noise + env gain) ──┐
보이스                         ├─→ 라인 게인 ─→ 마스터 게인(0.7) ─→ destination
보이스                       ──┘
```

악기 4종이 동시에 울리면 합산 진폭이 1.0을 넘어 클리핑이 나므로 마스터 앞에 게인 스테이지를 둔다.

보이스 노드는 일회용이다. 노트마다 새로 만들고, `stop(when)` 예약 + `onended`에서 `disconnect()`로 회수한다. 회수하지 않으면 긴 곡에서 노드가 수천 개 쌓여 메모리와 CPU가 샌다.

동시 보이스는 32개로 제한한다. 넘으면 가장 오래된 보이스를 페이드아웃시켜 훔친다.

### 악기 인터페이스

```ts
interface Instrument {
  play(note: number, when: number, dur: number, vel: number): void;
}
```

| 악기 | 구현 |
| --- | --- |
| 피아노 | sine + 배음, 빠른 attack, 지수 감쇠 |
| 기타 | sawtooth + 로우패스, 약간의 디튠 |
| 베이스 | sine 저음 + 소프트 클립 |
| 드럼 | 킥 = sine 피치 드롭 / 스네어 = 노이즈 + 밴드패스 / 하이햇 = 노이즈 + 짧은 게이트 |

엔벨로프는 `setValueAtTime` / `linearRampToValueAtTime` / `exponentialRampToValueAtTime`으로 예약한다. `exponentialRampToValueAtTime`의 목표값은 0이 될 수 없으므로 `0.0001`로 내린 뒤 `setValueAtTime(0, ...)`으로 마무리한다.

### 스케줄러

25ms 간격 타이머가 돌면서 앞으로 100ms 안에 시작할 타일을 절대 시각으로 예약한다.

```text
매 25ms:
  horizon = clock.currentTime + 0.1
  라인마다:
    커서 위치부터 tiles[]를 순회
      tileStartTime = tickToTime(tile.start)
      tileStartTime >= horizon 이면 중단
      tile.notes 각각을 sink.schedule(...)로 예약
      커서++
```

라인마다 커서 인덱스를 들고 있어 매 틱에 전체 타일을 훑지 않는다.

예약에 쓰는 시각은 항상 `audioContext.currentTime` 기준의 절대 초다. `Date.now()`, `performance.now()`, rAF 타임스탬프를 오디오 예약에 섞지 않는다.

lookahead 100ms는 트레이드오프다. 늘리면 안정적이지만 템포 변경 반응이 느려진다. 이 값의 근거를 코드 주석에 남긴다.

### 앵커 방식 시간 변환

```text
앵커  { anchorTick(정수), anchorTime(초), bpm }

tickToTime(tick) = anchorTime + (tick - anchorTick) / PPQ * 60 / bpm
```

재생 위치를 `pos += delta`로 굴리지 않고 항상 정수 앵커에서 다시 계산하므로 부동소수 오차가 쌓이지 않는다.

**템포 변경 정책.** 앵커를 스케줄 커서가 서 있는 지점(이미 예약이 끝난 경계)으로 옮기고 새 BPM을 넣는다. 이미 예약된 노트는 옛 템포로 그대로 울리고, 그 다음 노트부터 새 템포가 이어져 틈도 겹침도 없다.

### 정지

타이머를 끄고, 예약해 둔 보이스를 5ms 페이드아웃으로 끊는다. 뚝 자르면 클릭 노이즈가 난다.

### 메트로놈

별도 라인이 아니라 트랜스포트가 직접 예약하는 짧은 클릭이다. 곡 데이터에 들어가지 않는다.

## 상태 소유권

| 상태 | 사는 곳 | 갱신 주기 |
| --- | --- | --- |
| 재생 커서(틱), 예약 큐, 울리는 보이스 | `lib/audio` 엔진 내부 | 매 스케줄 틱 |
| 플래그 화면 위치 | rAF에서 엔진 값을 읽어 DOM에 직접 씀 | 매 프레임, **리렌더 없음** |
| 재생 중 여부, 템포, 메트로놈 on/off | `StudioProvider`의 `useState` | 사용자 조작 시 |
| 마디:박 표시 | `StudioProvider`, 10Hz 샘플링 | 초당 10회 |
| 곡 데이터 | `StudioProvider` (이번 슬라이스에선 fixture 상수) | 변하지 않음 |

매 프레임 값은 `useState`에 넣지 않는다. UI 조작은 `StudioProvider`의 setter를 통과하고, setter가 엔진을 명령형으로 호출(`engine.setTempo(v)`)하면서 같은 호출에서 React 상태를 갱신한다. 엔진이 스스로 리렌더를 일으키지 않는다.

`use client`는 훅이나 브라우저 API를 쓰는 파일마다 붙인다. 한곳에 몰아주는 루트 컴포넌트를 두지 않는다.

## 렌더링

### 좌표계

```ts
const PX_PER_BAR = 120;
tickToPx(tick) = tick / (PPQ * beatsPerBar) * PX_PER_BAR;
```

fixture 곡은 16마디다. 120BPM 4/4에서 32초라 "메트로놈과 30초 이상 재생해 드리프트 확인"을 루프 없이 채울 수 있다. 16마디 × 120px = 1920px이므로 가로 스크롤이 생긴다. 줌은 이번 슬라이스에 없다.

### DOM 구조

```text
<Timeline>                     grid: [라인 헤더 고정] [스크롤 영역]
  <LineHeaders>                sticky, 이름만
  <Scroller>                   overflow-x: auto
    <Stage>                    position: relative, width = 1920px
      <BarLines/>              CSS repeating-linear-gradient — DOM 노드 0개
      <TileLine> ×3            피아노 / 기타 / 베이스
        <Tile style={{left, width}}/>
      <DrumGrid>               켜진 칸만 노드
      <Playflag/>              형제 레이어, position: absolute
```

라인 높이는 데이터에서 계산하지 않고 `kind`별 상수로 둔다. 음정 라인 32px, 드럼 라인 60px(3행 × 20px). 헤더 열과 스테이지의 행 높이를 맞추기 위해서다.

### 플래그

타일들의 형제로 두고, rAF 루프에서 DOM에 직접 쓴다. React를 통과하지 않는다.

```ts
function frame() {
  const px = tickToPx(transport.currentTick());
  flagEl.style.transform = `translateX(${px}px)`;
  if (px - scroller.scrollLeft > scroller.clientWidth * 0.75) {
    scroller.scrollLeft = px - scroller.clientWidth * 0.5;
  }
  raf = requestAnimationFrame(frame);
}
```

`transform`만 바꾸므로 레이아웃이 다시 계산되지 않고, 타일 DOM은 재생 내내 한 번도 건드려지지 않는다. 자동 스크롤을 같은 루프에 넣은 것은 32초짜리 곡이 화면보다 길기 때문이며, 별도 상태 없이 `scrollLeft` 한 줄이라 비용이 사실상 없다.

### 드럼 격자

빈 칸을 DOM으로 만들지 않는다.

```text
배경     repeating-linear-gradient로 16분 스텝 구분선 + 행 구분선
행       킥 / 스네어 / 하이햇 3줄, 각 20px 고정
켜진 칸  <div style={{left, top: row * 20}}> — 실제 노드는 이것뿐
```

8비트 하이햇 16마디여도 노드가 128개 수준이다. 곧이곧대로 그렸을 때의 768개(16마디 × 16스텝 × 3행)와 차이가 크다.

### 타일 표시와 스타일

`notes[]`를 음 이름으로 변환해 `C4·E4·G4`처럼 쓴다. 타일 폭이 좁아 글자가 안 들어가면 `overflow: hidden`으로 자른다. 읽기 전용이므로 툴팁은 넣지 않는다.

`left` / `width` / `transform`처럼 값이 계산되는 것은 인라인 `style`로 쓴다. Tailwind 4의 클래스는 빌드 타임에 정해져야 하므로 동적 값에 맞지 않는다. 색·간격·테두리 같은 정적인 것만 클래스로 쓴다.

## 검증

### 테스트 가능하게 만드는 설계

스케줄러가 `AudioContext`를 직접 잡으면 브라우저 없이 돌릴 수 없다. 두 개의 좁은 인터페이스에만 의존하게 한다.

```ts
interface AudioClock { readonly currentTime: number }
interface NoteSink {
  schedule(lineId: string, note: number, when: number, dur: number, vel: number): void;
}
```

실제 실행에서는 `clock = audioContext`, `sink = 악기 디스패처`다. 테스트에서는 둘 다 가짜로 넣고 시계를 25ms씩 손으로 전진시키며 sink에 쌓인 예약을 검사한다. 스케줄러가 결정적으로 돌아간다.

### Vitest 단위 테스트

```text
time.ts
  ticksToSeconds(480, 120) === 0.5
  ticksToBarBeat(1920, [4,4]) === { bar: 2, beat: 1 }
  앵커 방식으로 10,000틱을 계산해도 누적 오차 0

스케줄러
  가짜 시계를 32초까지 전진 → 예약된 이벤트 수 == fixture의 총 음 수
  예약 시각이 기대값과 일치 (허용오차 1e-9)
  같은 타일이 두 번 예약되지 않음
  커서가 뒤로 가지 않음
  horizon 경계에 정확히 걸친 타일은 다음 틱에 예약됨
  재생 도중 템포를 바꾸면 앵커 앞뒤로 틈도 겹침도 없음

fixture
  모든 라인의 tiles[]가 start 오름차순
```

### 귀로 확인하는 것

정적 검사도 단위 테스트도 소리에 대해서는 아무것도 증명하지 않는다.

- 메트로놈을 켜고 16마디 32초를 완주한다. 마지막 마디에서 클릭과 곡이 어긋나면 드리프트다
- 4라인 동시 재생 + 드럼 연타 구간에서 뚝뚝 끊기는지 듣는다
- 재생 중 템포 슬라이더를 움직였을 때 소리가 튀거나 멎지 않고 이어지는지 듣는다
- 정지할 때 클릭 노이즈가 나는지 듣는다

### 명령

`package.json`에 `test` 스크립트를 추가한다.

```bash
pnpm lint
pnpm check-types
pnpm build
pnpm test
pnpm dev    # 그리고 실제로 들어본다
```

## 실패 처리

| 상황 | 처리 |
| --- | --- |
| 브라우저가 Web Audio 미지원 | 재생 버튼 비활성 + 안내 문구 |
| `resume()`이 거부됨 | 재생 상태를 되돌리고 다시 누르라는 표시 |
| rAF 루프가 도는 중 언마운트 | `cancelAnimationFrame` + 타이머 정리 |

샘플 로딩 실패는 샘플이 없으므로 해당하지 않고, 저장/불러오기는 범위 밖이다.

## 알려진 한계

- **템포 변경 직후 약 100ms 동안 마디:박 표시가 어긋난다.** 그 구간의 소리는 이미 옛 템포로 예약돼 있는데 표시는 새 앵커로 계산하기 때문이다. 소리는 정확하고 숫자만 잠깐 틀린다. 이번 슬라이스에서는 감수한다
- **화음 안의 음마다 길이·세기를 다르게 줄 수 없다.** 필요하면 같은 시점에 타일을 겹쳐 놓는 방식으로 우회한다
- **편집 은유가 라인 종류마다 다르다.** 음정 라인은 타일 드래그·길이 조절이고 드럼 격자는 칸 토글이다. 편집 슬라이스에서 이 차이를 UI로 분명히 드러내야 한다
- **DOM 렌더링은 타일이 수천 개가 되면 느려진다.** 그 시점에 윈도잉(보이는 구간만 렌더)으로 이행한다

## 구현 후 할 일

`.claude/rules/frontend-architecture.md`와 `AGENTS.md`는 현재 "아래 구조는 합의된 방향이며 아직 존재하지 않는다"고 적고 있다. 이 슬라이스가 `lib/score/`, `lib/audio/`, `state/`, `components/`를 실제로 만들므로, 구현이 끝나면 두 문서를 사실에 맞게 갱신한다.
