/** 4분음표 하나에 해당하는 틱 수. 모든 음악적 시간의 기준 단위. */
export const PPQ = 480;

export type LineKind = "pitched" | "drum";

export type InstrumentId = "piano" | "guitar" | "bass" | "drums";

export type Tile = {
  id: string;
  /** 곡 시작 기준 절대 틱. 정수. */
  start: number;
  /** 틱. 정수. 드럼 라인에서는 격자 한 칸 폭(120)으로 고정된다. */
  length: number;
  /** 0..1 */
  velocity: number;
  /** 동시에 울릴 MIDI 번호. 드럼 라인에서는 GM 드럼 번호. */
  notes: number[];
};

export type Line = {
  id: string;
  name: string;
  /** 어느 컴포넌트로 그릴지만 고른다. 스케줄러는 이 필드를 읽지 않는다. */
  kind: LineKind;
  instrument: InstrumentId;
  /** start 오름차순 정렬이 불변식이다. */
  tiles: Tile[];
};

export type Song = {
  tempo: number;
  timeSignature: [number, number];
  lengthTicks: number;
  lines: Line[];
};

/** GM 관행에 따른 드럼 번호. */
export const DRUM_KICK = 36;
export const DRUM_SNARE = 38;
export const DRUM_HIHAT = 42;
