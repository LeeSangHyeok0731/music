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
