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
import { buildDemoSong } from "@/lib/score/fixture";
import { ticksToBarBeat } from "@/lib/score/time";
import type { Song } from "@/lib/score/types";

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
};

const StudioContext = createContext<StudioValue | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const song = useMemo(() => buildDemoSong(), []);
  const engineRef = useRef<Engine | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
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
      const engine = new Engine(song);
      engine.onStop = () => setIsPlaying(false);
      engineRef.current = engine;
    }
    return engineRef.current;
  }, [song]);

  // 언마운트 시 타이머와 노드를 정리한다
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // 표시용 위치만 10Hz로 샘플링한다. 매 프레임 값이 아니다.
  useEffect(() => {
    if (!isPlaying) return;

    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setPosition(ticksToBarBeat(engine.currentTick(), song.timeSignature));
    }, POSITION_SAMPLE_MS);

    return () => window.clearInterval(id);
  }, [isPlaying, song.timeSignature]);

  const play = useCallback(() => {
    setError(null);
    // 이 호출은 클릭 핸들러 안에서 시작되므로 resume이 허용된다
    getEngine()
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => {
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
