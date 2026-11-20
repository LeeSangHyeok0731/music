/**
 * 곡 데이터 모델 v2. 순수 타입과 상수만 둔다 — Web Audio도 React도 모른다.
 *
 * 시간은 전부 PPQ 정수 틱이다. 초로 저장하지 않는다(템포를 바꾸면 곡이 어긋난다).
 */

/** 4분음표 하나에 해당하는 틱 수. 모든 음악적 시간의 기준 단위. */
export const PPQ = 480;

/** 곡 파일 형식 버전. 이 값이 아니면 열지 않는다. */
export const SONG_VERSION = 2;

export const MIN_TEMPO = 40;
export const MAX_TEMPO = 240;

/**
 * 곡 길이 상한(마디). 음악적 제한이 아니라 렌더 비용 가드다 — 손으로 고친
 * 파일이 `bars: 1e9`를 담고 들어와도 화면이 멈추지 않게 한다.
 */
export const MAX_BARS = 500;

/** GM 관행에 따른 드럼 번호. */
export const DRUM_KICK = 36;
export const DRUM_SNARE = 38;
export const DRUM_HIHAT = 42;

export const INSTRUMENT_IDS = ["piano", "guitar", "bass", "drums"] as const;
export type InstrumentId = (typeof INSTRUMENT_IDS)[number];

/** 닫힌 열거형이다. 값은 추가만 한다. 옛 앱이 모르는 값을 만나면 거부한다. */
export const CHORD_QUALITIES = ["maj", "min", "dom7", "maj7", "min7"] as const;
export type ChordQuality = (typeof CHORD_QUALITIES)[number];

export type Chord = {
  /** 0=C … 11=B */
  root: number;
  quality: ChordQuality;
};

/** 패턴 카탈로그(`patterns.ts`)의 id. 패턴 id는 불변이다. */
export type PatternId = string;

export type Note = {
  /** 클립 시작 기준 상대 틱. 정수. */
  start: number;
  /** 틱. 정수, 1 이상. */
  length: number;
  /** MIDI 번호. 드럼 트랙에서는 GM 드럼 번호. */
  pitch: number;
  /** 0..1 */
  velocity: number;
};

export type ChordBody = {
  type: "chord";
  chord: Chord;
  pattern: PatternId;
};

export type NotesBody = {
  type: "notes";
  /** start 오름차순. 같은 start의 음은 몇 개든 가질 수 있다(화음). */
  notes: Note[];
};

export type ClipBody = ChordBody | NotesBody;

export type Clip = {
  id: string;
  /** 곡 시작 기준 절대 틱. 정수. */
  start: number;
  /** 틱. 정수, 1 이상. */
  length: number;
  body: ClipBody;
};

export type Track = {
  id: string;
  instrument: InstrumentId;
  /** start 오름차순이고 서로 겹치지 않는 것이 불변식이다. */
  clips: Clip[];
};

export type Author = {
  name: string;
  /** 서명 검증용 공개키. 형식과 검증 로직은 공유 하위 프로젝트에서 정한다. */
  publicKey: string;
};

export type SongMeta = {
  title: string;
  author?: Author;
  /** 작업자 이후에 곡을 고친 사람들. 원 작업자는 `author`에 그대로 남는다. */
  editors: Author[];
  signature?: string;
};

export type Song = {
  v: typeof SONG_VERSION;
  tempo: number;
  timeSignature: [number, number];
  /** 마디 수. 곡 길이는 `bars × ticksPerBar`로 파생한다. */
  bars: number;
  tracks: Track[];
  meta: SongMeta;
};
