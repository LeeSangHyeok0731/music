"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { isAudioSupported } from "@/lib/audio/context";
import { Engine } from "@/lib/audio/engine";
import {
  addTile,
  moveTile,
  removeTile,
  resizeTile,
  setTileNotes,
  setTileVelocity,
  toggleDrumCell,
} from "@/lib/score/edit";
import { buildDemoSong } from "@/lib/score/fixture";
import { ticksToBarBeat } from "@/lib/score/time";
import type { Song } from "@/lib/score/types";
import { useSongHistory } from "@/state/useSongHistory";

const POSITION_SAMPLE_MS = 100;

// isAudioSupported()는 window를 읽으므로 SSR 스냅샷과 다르다.
// useSyncExternalStore가 SSR에서는 true를, 마운트 후에는 실제 값을 돌려준다.
// 값이 바뀌지 않으므로 구독은 아무것도 하지 않는다.
function subscribeNever() {
  return () => {};
}
function getServerSupportedSnapshot() {
  return true;
}

export type TileRef = { lineId: string; tileId: string };

export type TileEditHandlers = {
  createAt: (lineId: string, tick: number) => void;
  move: (lineId: string, tileId: string, startTicks: number) => void;
  resize: (lineId: string, tileId: string, lengthTicks: number) => void;
  remove: (lineId: string, tileId: string) => void;
  setNotes: (lineId: string, tileId: string, notes: number[]) => void;
  setVelocity: (lineId: string, tileId: string, velocity: number) => void;
  toggleDrum: (
    lineId: string,
    startTicks: number,
    piece: number,
    force?: boolean,
  ) => void;
};

export type StudioValue = {
  song: Song;
  isPlaying: boolean;
  tempo: number;
  metronome: boolean;
  position: { bar: number; beat: number };
  supported: boolean;
  error: string | null;
  play: () => void;
  stop: () => void;
  setTempo: (bpm: number) => void;
  setMetronome: (on: boolean) => void;
  currentTick: () => number;
  selection: TileRef | null;
  select: (ref: TileRef | null) => void;
  edit: TileEditHandlers;
  undo: () => void;
  canUndo: boolean;
  editable: boolean;
};

const StudioContext = createContext<StudioValue | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const initialSong = useMemo(() => buildDemoSong(), []);
  const {
    song,
    commitWith,
    undo: undoSong,
    canUndo,
  } = useSongHistory(initialSong);
  const [selection, setSelection] = useState<TileRef | null>(null);

  const engineRef = useRef<Engine | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);

  // 편집 핸들러가 isPlaying을 클로저에 담으면 재생/정지마다 정체성이 바뀌어
  // 타임라인 memo가 풀린다. ref로 읽는다.
  // ref 쓰기는 렌더 중에 하면 안 된다(react-hooks/refs) — effect에서 커밋 후에 동기화한다.
  const playingRef = useRef(false);
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  const [tempo, setTempoState] = useState(song.tempo);
  const [metronome, setMetronomeState] = useState(false);
  const [position, setPosition] = useState({ bar: 1, beat: 1 });
  // SSR에서는 window가 없다. 마운트 후에 실제 값으로 교체된다.
  const supported = useSyncExternalStore(
    subscribeNever,
    isAudioSupported,
    getServerSupportedSnapshot,
  );
  const [error, setError] = useState<string | null>(null);

  const getEngine = useCallback((): Engine => {
    if (!engineRef.current) {
      const engine = new Engine(initialSong);
      // 곡 끝 도달으로 인한 자동 정지도 사용자가 stop을 누른 것과 같은
      // 결과를 보여줘야 한다 — 안 그러면 재생 헤드가 마지막 샘플 값에
      // 멈춰 있는데 isPlaying만 false가 되어 두 상태가 서로 다른 얘기를 한다.
      engine.onStop = () => {
        setIsPlaying(false);
        setPosition({ bar: 1, beat: 1 });
      };
      engineRef.current = engine;
    }
    return engineRef.current;
  }, [initialSong]);

  // 언마운트 시 타이머와 노드를 정리한다
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // 편집은 정지 중에만 일어나므로 다음 play()부터 반영된다.
  //
  // engineRef.current?. 로 두면 안 된다. 엔진은 지연 생성이라 재생을 한 번도
  // 안 누른 상태에서는 아직 없고, 그때 편집하면 이 갱신이 조용히 사라진다.
  // 그러면 첫 재생이 initialSong으로 만들어진 엔진을 써서 편집 전 곡이 울린다.
  // getEngine()은 AudioContext를 만들지 않으므로(생성자는 곡과 템포만 저장한다)
  // 여기서 불러도 자동재생 정책에 걸리지 않는다.
  useEffect(() => {
    getEngine().setSong(song);
  }, [song, getEngine]);

  // 표시용 위치만 10Hz로 샘플링한다. 매 프레임 값이 아니다.
  useEffect(() => {
    if (!isPlaying) return;

    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setPosition((prev) => {
        const next = ticksToBarBeat(engine.currentTick(), song.timeSignature);
        // bar/beat가 그대로면 이전 객체 identity를 유지한다. 안 그러면
        // 100ms마다 새 객체가 생겨 실제로 안 바뀐 8/10 샘플까지 컨텍스트를
        // 구독하는 전부를 리렌더시킨다 — 재생 중 무거운 리렌더는 글리치의
        // 주된 원인이다.
        if (next.bar === prev.bar && next.beat === prev.beat) return prev;
        return next;
      });
    }, POSITION_SAMPLE_MS);

    return () => window.clearInterval(id);
  }, [isPlaying, song.timeSignature]);

  const play = useCallback(() => {
    setError(null);
    // 이 호출은 클릭 핸들러 안에서 시작되므로 resume이 허용된다
    const engine = getEngine();
    engine
      .play()
      .then(() => {
        // 프로미스가 resolve됐다고 재생 중인 게 아니다 — stop-during-start
        // 레이스에서 엔진은 세션이 뒤집히면 조용히 반환한다(던지지 않음).
        // isPlaying()이 엔진의 진짜 상태이므로 그걸 그대로 반영한다.
        setIsPlaying(engine.isPlaying());
      })
      .catch(() => {
        // 이 실패가 뒤늦게 도착한 것일 수 있다. play -> stop -> play 순서면
        // 나중 시도가 이미 성공해 재생 중인데 먼저 시도의 resume()이 그 뒤에
        // reject될 수 있다. 그때 여기서 stop()을 부르거나 에러를 띄우면 멀쩡히
        // 울리고 있는 세션을 죽인다. 엔진이 지금 재생 중이면 이 실패는 남의
        // 것이므로 무시한다. 실패한 세션의 playing 플래그는 엔진이 스스로
        // 되돌리므로(세션이 자기 것일 때만) 여기서 stop()을 부를 필요는 없다.
        if (engine.isPlaying()) return;
        setIsPlaying(false);
        setError("소리를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.");
      });
  }, [getEngine]);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    setIsPlaying(false);
    setPosition({ bar: 1, beat: 1 });
  }, []);

  const setTempo = useCallback(
    (bpm: number) => {
      setTempoState(bpm);
      getEngine().setTempo(bpm);
    },
    [getEngine],
  );

  const setMetronome = useCallback(
    (on: boolean) => {
      setMetronomeState(on);
      getEngine().setMetronome(on);
    },
    [getEngine],
  );

  const currentTick = useCallback(() => {
    return engineRef.current?.currentTick() ?? 0;
  }, []);

  const editable = !isPlaying;

  const select = useCallback((ref: TileRef | null) => {
    setSelection(ref);
  }, []);

  // 각 핸들러는 편집 함수를 updater로 넘긴다. 현재 곡을 클로저에 담지 않으므로
  // 이 객체의 정체성이 편집마다 바뀌지 않고, 타임라인 memo가 유지된다.
  // 재생 중에는 아무것도 하지 않는다.
  const edit = useMemo<TileEditHandlers>(
    () => ({
      createAt: (lineId, tick) => {
        if (playingRef.current) return;
        commitWith((s) => addTile(s, lineId, tick));
      },
      move: (lineId, tileId, startTicks) => {
        if (playingRef.current) return;
        commitWith((s) => moveTile(s, lineId, tileId, startTicks));
      },
      resize: (lineId, tileId, lengthTicks) => {
        if (playingRef.current) return;
        commitWith((s) => resizeTile(s, lineId, tileId, lengthTicks));
      },
      remove: (lineId, tileId) => {
        if (playingRef.current) return;
        commitWith((s) => removeTile(s, lineId, tileId));
        setSelection((prev) => (prev && prev.tileId === tileId ? null : prev));
      },
      setNotes: (lineId, tileId, notes) => {
        if (playingRef.current) return;
        commitWith((s) => setTileNotes(s, lineId, tileId, notes));
      },
      setVelocity: (lineId, tileId, velocity) => {
        if (playingRef.current) return;
        commitWith((s) => setTileVelocity(s, lineId, tileId, velocity));
      },
      toggleDrum: (lineId, startTicks, piece, force) => {
        if (playingRef.current) return;
        commitWith((s) => toggleDrumCell(s, lineId, startTicks, piece, force));
      },
    }),
    [commitWith],
  );

  const undo = useCallback(() => {
    const restored = undoSong();
    if (!restored) return;
    // 생성을 되돌리면 선택된 타일이 사라진다. 그대로 두면 존재하지 않는
    // 타일의 팝오버가 떠 있게 된다.
    setSelection((prev) => {
      if (!prev) return prev;
      const line = restored.lines.find((l) => l.id === prev.lineId);
      const exists = line?.tiles.some((t) => t.id === prev.tileId);
      return exists ? prev : null;
    });
  }, [undoSong]);

  const value = useMemo<StudioValue>(
    () => ({
      song,
      isPlaying,
      tempo,
      metronome,
      position,
      supported,
      error,
      play,
      stop,
      setTempo,
      setMetronome,
      currentTick,
      selection,
      select,
      edit,
      undo,
      canUndo,
      editable,
    }),
    [
      song,
      isPlaying,
      tempo,
      metronome,
      position,
      supported,
      error,
      play,
      stop,
      setTempo,
      setMetronome,
      currentTick,
      selection,
      select,
      edit,
      undo,
      canUndo,
      editable,
    ],
  );

  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}

export function useStudio(): StudioValue {
  const value = useContext(StudioContext);
  if (!value) {
    throw new Error("useStudio는 StudioProvider 안에서만 쓸 수 있습니다.");
  }
  return value;
}
