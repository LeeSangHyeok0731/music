"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { isAudioSupported } from "@/lib/audio/context";
import { Engine, type PlayResult } from "@/lib/audio/engine";
import {
  defaultSampleBank,
  type SamplePort,
  type SampleStatus,
} from "@/lib/audio/samples/bank";
import { buildDemoSong } from "@/lib/score/demo-song";
import {
  INSTRUMENT_IDS,
  MAX_TEMPO,
  MIN_TEMPO,
  type InstrumentId,
  type Song,
} from "@/lib/score/model";
import { songLengthTicks, ticksToBarBeat } from "@/lib/score/time";

/** 화면이 엔진에서 쓰는 부분. 테스트가 가짜를 끼운다. */
export type VerifyEngine = {
  play(): Promise<PlayResult>;
  stop(): void;
  setSong(song: Song): boolean;
  setTempo(bpm: number): void;
  setMetronome(on: boolean): void;
  currentTick(): number;
  dispose(): void;
  onStop: (() => void) | null;
};

export type VerifyBank = Pick<SamplePort, "prefetch"> & {
  getSnapshot(): Readonly<Record<InstrumentId, SampleStatus>>;
  subscribe(listener: () => void): () => void;
};

export type VerifyDeps = { engine: VerifyEngine; bank: VerifyBank };

function createRealDeps(): VerifyDeps {
  const bank = defaultSampleBank();
  // 두 번째 인자를 undefined로 두면 브라우저용 AudioContext 제공자가 쓰인다.
  return { engine: new Engine(buildDemoSong(), undefined, bank), bank };
}

const POSITION_SAMPLE_MS = 100;

const INSTRUMENT_LABEL: Record<InstrumentId, string> = {
  piano: "피아노",
  guitar: "기타",
  bass: "베이스",
  drums: "드럼",
};

const STATUS_LABEL: Record<SampleStatus, string> = {
  idle: "대기",
  loading: "불러오는 중",
  downloaded: "받음 (재생 때 마무리)",
  ready: "준비됨",
  error: "실패",
};

// isAudioSupported()는 window를 읽으므로 SSR 스냅샷과 다르다.
// SSR에서는 true를, 마운트 후에는 실제 값을 돌려준다.
function subscribeNever() {
  return () => {};
}
const serverSupported = () => true;

// 서버의 뱅크는 받지 않으므로 전부 대기다. 클라이언트에서는 엔진 생성자의
// prefetch가 렌더 중에 이미 loading을 알리므로, 하이드레이션 때 클라이언트
// 스냅샷을 쓰면 서버 HTML과 어긋난다. 모듈 상수라 참조가 안정적이다.
const IDLE_STATUSES = Object.fromEntries(
  INSTRUMENT_IDS.map((id) => [id, "idle"]),
) as Readonly<Record<InstrumentId, SampleStatus>>;
const serverStatuses = () => IDLE_STATUSES;

/**
 * 엔진의 자동 정지 콜백을 단다. 엔진은 useState에 든 외부 객체라 effect
 * 안에서 직접 대입하면 react-hooks/immutability가 막는다. 엔진은 React가
 * 관찰하는 값이 아니고 콜백 슬롯일 뿐이므로 대입을 여기로 옮긴다.
 */
function bindAutoStop(engine: VerifyEngine, handler: (() => void) | null) {
  engine.onStop = handler;
}

/**
 * 소리를 귀로 확인하기 위한 최소 화면. 편집 UI가 아니다.
 *
 * 매 프레임 바뀌는 재생 위치는 엔진 안에만 있다. 여기서는 10Hz로 샘플링한
 * 마디·박만 상태로 둔다.
 */
export function VerifyScreen({
  createDeps = createRealDeps,
}: {
  createDeps?: () => VerifyDeps;
}) {
  const [{ engine, bank }] = useState(createDeps);
  const [song] = useState(buildDemoSong);

  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(song.tempo);
  const [metronome, setMetronome] = useState(false);
  const [position, setPosition] = useState({ bar: 1, beat: 1 });
  const [message, setMessage] = useState<string | null>(null);

  // 정지 때 엔진에 다시 맞출 템포. 핸들러에서만 쓰고 렌더 중에는 읽지 않는다.
  const tempoRef = useRef(tempo);

  const statuses = useSyncExternalStore(
    bank.subscribe,
    bank.getSnapshot,
    serverStatuses,
  );
  const supported = useSyncExternalStore(
    subscribeNever,
    isAudioSupported,
    serverSupported,
  );

  useEffect(() => {
    // 곡 끝 도달로 인한 자동 정지도 사용자가 정지를 누른 것과 같은 결과여야 한다.
    bindAutoStop(engine, () => {
      engine.setSong({ ...song, tempo: tempoRef.current });
      setPlaying(false);
      setPosition({ bar: 1, beat: 1 });
    });
    return () => {
      bindAutoStop(engine, null);
      engine.dispose();
    };
  }, [engine, song]);

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

  async function handlePlay() {
    setMessage(null);
    try {
      const result = await engine.play();
      if (result.status === "playing") {
        setPlaying(true);
      } else if (result.status === "not-ready") {
        const names = result.failed.map((i) => INSTRUMENT_LABEL[i]).join(", ");
        setMessage(
          `샘플을 불러오지 못한 악기가 있어 재생하지 않았습니다: ${names}`,
        );
      }
    } catch {
      setMessage("소리를 시작하지 못했습니다. 재생 버튼을 다시 눌러 주세요.");
    }
  }

  function handleStop() {
    engine.stop();
    // 재생 중 바뀐 템포를 곡에도 반영한다 — song.tempo가 유일한 진실이다.
    engine.setSong({ ...song, tempo: tempoRef.current });
    setPlaying(false);
    setPosition({ bar: 1, beat: 1 });
  }

  function handleTempo(value: number) {
    tempoRef.current = value;
    setTempo(value);
    // 재생 중에는 setTempo만 먹고, 정지 중에는 setSong이 곡과 템포를 함께 맞춘다.
    // 둘 다 부르면 지금 재생 상태를 화면이 추측하지 않아도 된다.
    engine.setTempo(value);
    engine.setSong({ ...song, tempo: value });
  }

  return (
    <main className="mx-auto max-w-xl space-y-6 p-8 text-zinc-100">
      <header>
        <h1 className="text-lg font-semibold">Bandline — 소리 검증</h1>
        <p className="mt-1 text-sm text-zinc-400">
          데모 곡을 재생해 소리를 확인하는 화면입니다. 편집은 아직 없습니다.
        </p>
      </header>

      {!supported && (
        <p role="alert" className="text-sm text-amber-400">
          이 브라우저는 Web Audio를 지원하지 않습니다.
        </p>
      )}

      <section className="flex items-center gap-4">
        {playing ? (
          <button
            type="button"
            onClick={handleStop}
            className="rounded bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900"
          >
            정지
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePlay}
            disabled={!supported}
            className="rounded bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-40"
          >
            재생
          </button>
        )}
        <span className="font-mono text-sm tabular-nums text-zinc-300">
          {position.bar}마디 · {position.beat}박
        </span>
      </section>

      {message && (
        <p role="alert" className="text-sm text-amber-400">
          {message}
        </p>
      )}

      <section className="space-y-3">
        <label className="flex items-center gap-3 text-sm">
          <span className="w-12">템포</span>
          <input
            type="range"
            min={MIN_TEMPO}
            max={MAX_TEMPO}
            value={tempo}
            onChange={(e) => handleTempo(Number(e.target.value))}
            aria-label="템포"
            className="flex-1"
          />
          <span className="w-16 font-mono tabular-nums">{tempo} BPM</span>
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={metronome}
            onChange={(e) => {
              setMetronome(e.target.checked);
              engine.setMetronome(e.target.checked);
            }}
            aria-label="메트로놈"
          />
          메트로놈
        </label>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">샘플 상태</h2>
        <ul className="space-y-1 text-sm">
          {INSTRUMENT_IDS.map((id) => (
            <li key={id} className="flex items-center gap-3">
              <span className="w-16">{INSTRUMENT_LABEL[id]}</span>
              <span className="text-zinc-400">{STATUS_LABEL[statuses[id]]}</span>
              {statuses[id] === "error" && (
                <button
                  type="button"
                  aria-label={`${INSTRUMENT_LABEL[id]} 다시 시도`}
                  onClick={() => bank.prefetch([id])}
                  className="rounded border border-zinc-600 px-2 py-0.5 text-xs"
                >
                  다시 시도
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
