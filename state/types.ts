import type { Engine } from "@/lib/audio/engine";
import type { SampleStatus } from "@/lib/audio/samples/bank";
import type * as Edit from "@/lib/score/edit";
import type { InstrumentId, Song } from "@/lib/score/model";

/** Provider가 엔진에서 쓰는 부분. 테스트가 가짜를 끼운다(`state/testing/fake-deps.ts`). */
export type StudioEngine = Pick<
  Engine,
  "play" | "stop" | "setSong" | "setTempo" | "setMetronome" | "currentTick" | "dispose"
> & { onStop: (() => void) | null };

export type StudioBank = {
  prefetch(instruments: readonly InstrumentId[]): void;
  getSnapshot(): Readonly<Record<InstrumentId, SampleStatus>>;
  subscribe(listener: () => void): () => void;
};

export type StudioStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type StudioDeps = {
  engine: StudioEngine;
  bank: StudioBank;
  /** 브라우저 저장소를 못 쓰는 환경(서버 렌더, 차단)이면 null. */
  storage: StudioStorage | null;
};

export type Selection = { trackId: string; clipId: string } | null;

/** `lib/score/edit.ts`에서 Provider가 노출하는 편집 함수들. `setTempo`는 실행취소에 쌓지 않으므로 따로 있다. */
export type EditName =
  | "setChord"
  | "splitSegment"
  | "moveBoundary"
  | "mergeSegments"
  | "addClip"
  | "moveClip"
  | "resizeClip"
  | "removeClip"
  | "setClipPattern"
  | "setTrackPattern"
  | "setBars";

/** 편집 함수의 인자에서 맨 앞의 `song`을 뺀 액션. */
type WithoutSong<F> = F extends (song: Song, ...rest: infer A) => Song
  ? (...args: A) => void
  : never;

export type StudioEdits = { [K in EditName]: WithoutSong<(typeof Edit)[K]> };

export type StudioApi = {
  song: Song;
  /** 지금 곡에 없는 클립을 가리키면 null로 보인다. */
  selection: Selection;
  select(selection: Selection): void;
  /** `engine.play()`가 `{status:"playing"}`으로 끝났을 때만 참. */
  playing: boolean;
  /** `play()`를 기다리는 중(컨텍스트 재개·샘플 준비). 이때도 편집은 막힌다. */
  pending: boolean;
  /** `!playing && !pending`. 편집·실행취소는 이때만 동작한다. */
  editable: boolean;
  /** 10Hz로 샘플링한 표시용 위치(1부터). 플레이헤드는 `getEngine().currentTick()`을 직접 읽는다. */
  position: { bar: number; beat: number };
  message: string | null;
  dismissMessage(): void;
  sampleStatuses: Readonly<Record<InstrumentId, SampleStatus>>;
  retrySamples(instrument: InstrumentId): void;
  canUndo: boolean;
  undo(): void;
  play(): Promise<void>;
  stop(): void;
  /** 실행취소에 쌓지 않는다. 재생 중에도 바로 엔진에 전달한다. */
  setTempo(bpm: number): void;
  metronome: boolean;
  setMetronome(on: boolean): void;
  /** 플레이헤드용 읽기 전용 창. 재생 제어는 `play`/`stop`을 쓴다. */
  getEngine(): Pick<StudioEngine, "currentTick">;
  edit: StudioEdits;
};
