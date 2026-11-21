"use client";

import { useSyncExternalStore } from "react";

import { isAudioSupported } from "@/lib/audio/context";
import { MAX_TEMPO, MIN_TEMPO } from "@/lib/score/model";
import { useStudio } from "@/state/useStudio";

import { SampleStatus } from "./SampleStatus";
import { parseTempoInput } from "./tempo";

// isAudioSupported()는 window를 읽으므로 SSR 스냅샷과 다르다.
// SSR에서는 true를, 마운트 후에는 실제 값을 돌려준다.
function subscribeNever() {
  return () => {};
}
const serverSupported = () => true;

const BUTTON =
  "rounded border border-white/15 px-3 py-1 text-zinc-200 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent";

/** 재생·정지, 위치, 템포, 메트로놈, 되돌리기, 샘플 상태, 안내와 메시지 줄. */
export function TopBar() {
  const {
    song,
    playing,
    pending,
    editable,
    position,
    message,
    dismissMessage,
    canUndo,
    undo,
    play,
    stop,
    setTempo,
    metronome,
    setMetronome,
  } = useStudio();
  const supported = useSyncExternalStore(
    subscribeNever,
    isAudioSupported,
    serverSupported,
  );

  return (
    <header className="border-b border-white/10 bg-[#141519] text-sm text-zinc-200">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
        {playing ? (
          <button type="button" onClick={stop} className={BUTTON}>
            정지
          </button>
        ) : (
          <button
            type="button"
            aria-busy={pending ? "true" : undefined}
            disabled={!supported}
            onClick={() => {
              // 대기 중 재누름은 무시한다. Provider도 막지만 여기서 호출 자체를 하지 않는다.
              if (!pending) void play();
            }}
            className={BUTTON}
          >
            재생
          </button>
        )}
        <span className="font-mono tabular-nums text-zinc-400">
          {position.bar}마디 · {position.beat}박
        </span>

        <label className="flex items-center gap-2">
          <span className="text-zinc-400">템포</span>
          <input
            type="range"
            aria-label="템포"
            min={MIN_TEMPO}
            max={MAX_TEMPO}
            value={song.tempo}
            onChange={(e) => {
              const bpm = parseTempoInput(e.target.value);
              // 방어용: 실제 range 입력은 NaN을 내지 않는다. 오면 곡 템포를 건드리지 않는다.
              if (bpm !== null) setTempo(bpm);
            }}
          />
          <span className="w-16 font-mono tabular-nums">{song.tempo} BPM</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="메트로놈"
            checked={metronome}
            onChange={(e) => setMetronome(e.target.checked)}
          />
          메트로놈
        </label>

        <button
          type="button"
          aria-label="되돌리기"
          disabled={!(canUndo && editable)}
          onClick={undo}
          className={BUTTON}
        >
          되돌리기
        </button>

        <div className="ml-auto">
          <SampleStatus />
        </div>
      </div>

      {!supported && (
        <p role="alert" className="px-3 pb-2 text-amber-400">
          이 브라우저는 Web Audio를 지원하지 않습니다.
        </p>
      )}
      {playing && (
        <p role="status" className="px-3 pb-2 text-zinc-400">
          재생 중에는 편집할 수 없습니다
        </p>
      )}
      {pending && (
        <p role="status" className="px-3 pb-2 text-zinc-400">
          샘플을 불러오는 중…
        </p>
      )}
      {message && (
        <p
          role="alert"
          className="flex items-center gap-2 px-3 pb-2 text-amber-400"
        >
          <span>{message}</span>
          <button
            type="button"
            aria-label="메시지 닫기"
            onClick={dismissMessage}
            className="rounded px-1.5 text-zinc-400 hover:bg-white/10"
          >
            ×
          </button>
        </p>
      )}
    </header>
  );
}
