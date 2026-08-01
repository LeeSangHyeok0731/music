"use client";

import { useStudio } from "@/state/StudioProvider";

export function TransportBar() {
  const {
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
  } = useStudio();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-white/15 bg-zinc-900 px-4 py-3">
        <button
          type="button"
          onClick={isPlaying ? stop : play}
          disabled={!supported}
          className="w-20 rounded bg-white/10 px-3 py-1.5 text-sm text-zinc-100 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPlaying ? "■ 정지" : "▶ 재생"}
        </button>

        <div className="font-mono text-sm tabular-nums text-zinc-300">
          {String(position.bar).padStart(3, "0")}:{position.beat}
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <span className="text-zinc-400">♩</span>
          <input
            type="range"
            min={40}
            max={240}
            step={1}
            value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
            className="w-40"
          />
          <span className="w-10 font-mono tabular-nums">{tempo}</span>
        </label>

        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={metronome}
            onChange={(e) => setMetronome(e.target.checked)}
          />
          메트로놈
        </label>
      </div>

      {!supported && (
        <p className="text-sm text-amber-400">
          이 브라우저는 Web Audio를 지원하지 않아 재생할 수 없습니다.
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
