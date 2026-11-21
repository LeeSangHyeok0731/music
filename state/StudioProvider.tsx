"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Engine, type PlayResult } from "@/lib/audio/engine";
import { defaultSampleBank, type SampleStatus } from "@/lib/audio/samples/bank";
import { AUTOSAVE_KEY, loadSong, serializeSong } from "@/lib/score/autosave";
import { buildDemoSong } from "@/lib/score/demo-song";
import * as Edit from "@/lib/score/edit";
import {
  canUndo as historyCanUndo,
  commit,
  createHistory,
  replaceWithoutHistory,
  undo as historyUndo,
  type History,
} from "@/lib/score/history";
import { INSTRUMENT_IDS, type InstrumentId, type Song } from "@/lib/score/model";
import { songLengthTicks, ticksToBarBeat } from "@/lib/score/time";

import type {
  Selection,
  StudioApi,
  StudioDeps,
  StudioEdits,
  StudioEngine,
  StudioStorage,
} from "./types";
import { StudioContext } from "./useStudio";

/**
 * 편집 상태·엔진 동기화·실행취소·자동 저장을 한곳에서 소유한다.
 *
 * 재생 상태 기계(`phase`):
 * - `idle` → `play()` → `pending`(엔진의 `play()`를 기다림. 편집 불가)
 * - `pending` → `{status:"playing"}` → `playing`
 * - `pending` → `not-ready`·`superseded`·`already-playing`·거부 → `idle`
 * - `pending`/`playing` → `stop()`·엔진 자동 정지 → `idle`
 * 엔진의 `isPlaying()`은 `pending` 동안에도 참이라 쓰지 않는다. `phase`는 렌더용
 * 상태와, 같은 틱 안의 연속 호출을 막는 ref에 함께 쓴다(핸들러에서만 바꾼다).
 *
 * 곡을 엔진에 맞추는 길은 하나뿐이다: `phase`가 `idle`일 때 곡이 바뀌거나
 * `idle`로 돌아오면 `engine.setSong(song)`. 엔진은 `pending`·`playing` 동안
 * `setSong`을 거절하므로, 그동안 바뀐 곡(템포)은 `idle`로 돌아올 때 맞춘다.
 */

const POSITION_SAMPLE_MS = 100;
const AUTOSAVE_DEBOUNCE_MS = 300;
const START_POSITION = { bar: 1, beat: 1 };

const INSTRUMENT_LABEL: Record<InstrumentId, string> = {
  piano: "피아노",
  guitar: "기타",
  bass: "베이스",
  drums: "드럼",
};

const PLAY_FAILED = "소리를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.";
const SAVE_FAILED = "브라우저에 저장하지 못했습니다";
const EDIT_FAILED = "편집을 적용하지 못했습니다";

function notReadyMessage(failed: readonly InstrumentId[]): string {
  const names = failed.map((i) => INSTRUMENT_LABEL[i]).join(", ");
  return `샘플을 불러오지 못한 악기가 있어 재생하지 않았습니다: ${names}`;
}

// 서버의 뱅크는 받지 않으므로 전부 대기다. 클라이언트에서는 엔진 생성자의
// prefetch가 렌더 중에 이미 loading을 알리므로, 하이드레이션 때 클라이언트
// 스냅샷을 쓰면 서버 HTML과 어긋난다. 모듈 상수라 참조가 안정적이다.
const IDLE_STATUSES = Object.fromEntries(
  INSTRUMENT_IDS.map((id) => [id, "idle"]),
) as Readonly<Record<InstrumentId, SampleStatus>>;
const serverStatuses = () => IDLE_STATUSES;

function browserStorage(): StudioStorage | null {
  if (typeof window === "undefined") return null;
  try {
    // 저장소가 차단된 환경에서는 접근만으로 SecurityError가 난다.
    return window.localStorage;
  } catch {
    return null;
  }
}

function createRealDeps(): StudioDeps {
  const bank = defaultSampleBank();
  // 두 번째 인자를 undefined로 두면 브라우저용 AudioContext 제공자가 쓰인다.
  // 엔진은 데모 곡으로 만들고, 마운트 뒤 동기화 effect가 지금 곡으로 맞춘다.
  return {
    engine: new Engine(buildDemoSong(), undefined, bank),
    bank,
    storage: browserStorage(),
  };
}

function readStored(storage: StudioStorage | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
}

/** 실패하면 false. 용량 초과·차단으로 던지는 것을 삼킨다. */
function writeStored(storage: StudioStorage, song: Song): boolean {
  try {
    storage.setItem(AUTOSAVE_KEY, serializeSong(song));
    return true;
  } catch {
    return false;
  }
}

function clipExists(song: Song, selection: NonNullable<Selection>): boolean {
  return song.tracks.some(
    (t) =>
      t.id === selection.trackId &&
      t.clips.some((c) => c.id === selection.clipId),
  );
}

/**
 * 엔진의 자동 정지 콜백을 단다. 엔진은 useState에 든 외부 객체라 effect
 * 안에서 직접 대입하면 react-hooks/immutability가 막는다. 엔진은 React가
 * 관찰하는 값이 아니고 콜백 슬롯일 뿐이므로 대입을 여기로 옮긴다.
 */
function bindAutoStop(engine: StudioEngine, handler: (() => void) | null) {
  engine.onStop = handler;
}

type Phase = "idle" | "pending" | "playing";

export function StudioProvider({
  createDeps = createRealDeps,
  children,
}: {
  createDeps?: () => StudioDeps;
  children: ReactNode;
}) {
  const [{ engine, bank, storage }] = useState(createDeps);

  // 서버 렌더와 클라이언트 첫 렌더는 항상 데모 곡이다(하이드레이션 일치).
  // 저장된 곡은 마운트 뒤 아래 effect가 교체한다.
  const [history, setHistory] = useState(() => createHistory(buildDemoSong()));
  // 핸들러가 읽는 최신 히스토리. 핸들러와 복원 effect에서만 바꾼다 — 한 이벤트
  // 안의 연속 편집이 렌더를 기다리지 않고 앞 편집 위에 쌓이게 한다.
  const historyRef = useRef(history);

  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  /** play() 시작·stop()·자동 정지·언마운트마다 올린다. 옛 play() 결과를 버린다. */
  const sessionRef = useRef(0);

  const [position, setPosition] = useState(START_POSITION);
  const [message, setMessage] = useState<string | null>(null);
  const [storedSelection, setSelection] = useState<Selection>(null);
  const [metronome, setMetronomeState] = useState(false);
  /** 사용자 편집(실행취소·템포 포함)마다 오른다. 0이면 아직 저장할 것이 없다. */
  const [saveRequest, setSaveRequest] = useState(0);
  const saveFailedNotifiedRef = useRef(false);

  const song = history.present;
  const playing = phase === "playing";
  const pending = phase === "pending";
  const editable = phase === "idle";
  const selection =
    storedSelection && clipExists(song, storedSelection) ? storedSelection : null;

  const sampleStatuses = useSyncExternalStore(
    bank.subscribe,
    bank.getSnapshot,
    serverStatuses,
  );

  // 저장된 곡 복원. 한 번만 읽는 브라우저 전용 값이라 첫 렌더에서 읽으면 서버
  // HTML과 어긋난다. 복원은 실행취소에 쌓지 않고 저장도 걸지 않는다 — 읽지 못한
  // 저장값(옛 v2 곡 등)을 안내를 보기도 전에 데모 곡으로 덮어쓰지 않기 위해서다.
  useEffect(() => {
    const raw = readStored(storage);
    if (raw === null) return;
    const loaded = loadSong(raw);
    const restored = createHistory(loaded.song);
    historyRef.current = restored;
    /* eslint-disable react-hooks/set-state-in-effect -- 브라우저 저장소를 마운트 뒤 한 번 읽는 두 단계 렌더(하이드레이션 일치)다. */
    setHistory(restored);
    if (loaded.notice) setMessage(loaded.notice);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [storage]);

  // 곡을 엔진에 맞춘다. pending·playing 동안은 엔진이 거절하므로 건너뛰고,
  // idle로 돌아올 때(not-ready·정지·자동 정지) 그동안 바뀐 곡으로 다시 맞춘다.
  useEffect(() => {
    if (playing || pending) return;
    engine.setSong(song);
  }, [engine, song, playing, pending]);

  useEffect(() => {
    // 곡 끝 도달로 인한 자동 정지도 사용자가 정지를 누른 것과 같은 결과여야 한다.
    bindAutoStop(engine, () => {
      sessionRef.current += 1;
      phaseRef.current = "idle";
      setPhase("idle");
      setPosition(START_POSITION);
    });
    return () => {
      bindAutoStop(engine, null);
      // 언마운트 뒤에 끝나는 play()가 상태를 건드리지 않게 한다.
      sessionRef.current += 1;
      engine.dispose();
    };
  }, [engine]);

  useEffect(() => {
    if (!playing) return;
    // 곡 끝 뒤 릴리즈 꼬리 동안 엔진 틱은 곡 길이를 넘는다. 마지막 틱에서 멈춘다.
    const lastTick = songLengthTicks(song) - 1;
    const id = window.setInterval(() => {
      const tick = Math.min(engine.currentTick(), lastTick);
      const next = ticksToBarBeat(tick, song.timeSignature);
      // 같으면 이전 객체를 유지해 불필요한 리렌더를 막는다.
      setPosition((prev) =>
        prev.bar === next.bar && prev.beat === next.beat ? prev : next,
      );
    }, POSITION_SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [playing, engine, song]);

  // 자동 저장. 사용자 편집 뒤 300ms 디바운스, pagehide 때는 즉시. 대기 중
  // 저장은 다음 편집(새 타이머)이나 언마운트에서 버린다.
  useEffect(() => {
    if (saveRequest === 0 || !storage) return;
    let done = false;
    const save = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", save);
      if (!writeStored(storage, song) && !saveFailedNotifiedRef.current) {
        saveFailedNotifiedRef.current = true;
        setMessage(SAVE_FAILED);
      }
    };
    const timer = window.setTimeout(save, AUTOSAVE_DEBOUNCE_MS);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [saveRequest, song, storage]);

  /** 사용자 편집으로 생긴 새 히스토리를 반영하고 저장을 건다. */
  const accept = useCallback((next: History<Song>) => {
    historyRef.current = next;
    setHistory(next);
    setSaveRequest((n) => n + 1);
    // 사라진 클립의 선택은 지운다(남겨 두면 같은 id로 다시 생긴 클립이나 실행취소로
    // 되살아난 클립이 사용자가 고르지 않았는데 선택된다 — 클립 id는 재사용된다).
    setSelection((sel) => (sel && clipExists(next.present, sel) ? sel : null));
  }, []);

  const select = useCallback((next: Selection) => {
    setSelection(next && clipExists(historyRef.current.present, next) ? next : null);
  }, []);

  /** 편집은 idle일 때만. 던지는 편집은 곡을 그대로 두고 안내한다. */
  const applyEdit = useCallback(
    (update: (song: Song) => Song) => {
      if (phaseRef.current !== "idle") return;
      const current = historyRef.current;
      let next: History<Song>;
      try {
        next = commit(current, update);
      } catch {
        setMessage(EDIT_FAILED);
        return;
      }
      if (next === current) return;
      accept(next);
    },
    [accept],
  );

  const edit = useMemo<StudioEdits>(
    () => ({
      setChord: (...a) => applyEdit((s) => Edit.setChord(s, ...a)),
      splitSegment: (...a) => applyEdit((s) => Edit.splitSegment(s, ...a)),
      moveBoundary: (...a) => applyEdit((s) => Edit.moveBoundary(s, ...a)),
      mergeSegments: (...a) => applyEdit((s) => Edit.mergeSegments(s, ...a)),
      addClip: (...a) => applyEdit((s) => Edit.addClip(s, ...a)),
      moveClip: (...a) => applyEdit((s) => Edit.moveClip(s, ...a)),
      resizeClip: (...a) => applyEdit((s) => Edit.resizeClip(s, ...a)),
      removeClip: (...a) => applyEdit((s) => Edit.removeClip(s, ...a)),
      setClipPattern: (...a) => applyEdit((s) => Edit.setClipPattern(s, ...a)),
      setTrackPattern: (...a) =>
        applyEdit((s) => Edit.setTrackPattern(s, ...a)),
      setBars: (...a) => applyEdit((s) => Edit.setBars(s, ...a)),
    }),
    [applyEdit],
  );

  const undo = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    const previous = historyUndo(historyRef.current);
    if (previous) accept(previous);
  }, [accept]);

  const setTempo = useCallback(
    (bpm: number) => {
      // 템포는 곡 전체 설정이라 실행취소에 쌓지 않고, 재생 중에도 바꾼다.
      const current = historyRef.current;
      const next = replaceWithoutHistory(current, (s) => Edit.setTempo(s, bpm));
      if (next === current) return;
      accept(next);
      // 재생 중에는 이것만 먹는다. 정지 중에는 동기화 effect의 setSong도 맞춘다.
      engine.setTempo(next.present.tempo);
    },
    [accept, engine],
  );

  const play = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    const session = ++sessionRef.current;
    phaseRef.current = "pending";
    setPhase("pending");

    let result: PlayResult;
    try {
      // 사용자 제스처 안의 첫 await가 엔진의 play()여야 한다.
      result = await engine.play();
    } catch {
      if (sessionRef.current !== session) return;
      phaseRef.current = "idle";
      setPhase("idle");
      setMessage(PLAY_FAILED);
      return;
    }
    // 그 사이 stop()·자동 정지·언마운트가 있었으면 이 결과는 버린다.
    if (sessionRef.current !== session) return;
    if (result.status === "playing") {
      phaseRef.current = "playing";
      setPhase("playing");
      return;
    }
    phaseRef.current = "idle";
    setPhase("idle");
    if (result.status === "not-ready") {
      setMessage(notReadyMessage(result.failed));
    }
  }, [engine]);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    engine.stop();
    phaseRef.current = "idle";
    setPhase("idle");
    setPosition(START_POSITION);
  }, [engine]);

  const setMetronome = useCallback(
    (on: boolean) => {
      setMetronomeState(on);
      engine.setMetronome(on);
    },
    [engine],
  );

  const retrySamples = useCallback(
    (instrument: InstrumentId) => bank.prefetch([instrument]),
    [bank],
  );
  const dismissMessage = useCallback(() => setMessage(null), []);
  const getEngine = useCallback(() => engine, [engine]);

  const api = useMemo<StudioApi>(
    () => ({
      song,
      selection,
      select,
      playing,
      pending,
      editable,
      position,
      message,
      dismissMessage,
      sampleStatuses,
      retrySamples,
      canUndo: historyCanUndo(history),
      undo,
      play,
      stop,
      setTempo,
      metronome,
      setMetronome,
      getEngine,
      edit,
    }),
    [
      song,
      selection,
      select,
      playing,
      pending,
      editable,
      position,
      message,
      dismissMessage,
      sampleStatuses,
      retrySamples,
      history,
      undo,
      play,
      stop,
      setTempo,
      metronome,
      setMetronome,
      getEngine,
      edit,
    ],
  );

  return <StudioContext.Provider value={api}>{children}</StudioContext.Provider>;
}
