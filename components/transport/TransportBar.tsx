"use client";

import { useRef } from "react";

import { MAX_TEMPO, MIN_TEMPO } from "@/lib/score/schema";
import { parseSong } from "@/lib/score/serialize";
import { useStudio } from "@/state/StudioProvider";

import { downloadSong, readFileText } from "./songFile";

export function TransportBar() {
  const {
    song,
    isPlaying,
    tempo,
    metronome,
    position,
    supported,
    error,
    setError,
    play,
    stop,
    setTempo,
    setMetronome,
    loadSong,
    undo,
    canUndo,
    editable,
  } = useStudio();

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 같은 파일을 두 번 연속 고르면 값이 안 바뀌어 change가 오지 않는다.
    // 파일을 고쳐서 다시 여는 게 정확히 그 시나리오다.
    event.target.value = "";
    if (!file) return;

    const text = await readFileText(file);
    if (text === null) {
      setError("파일을 읽지 못했습니다.");
      return;
    }

    const result = parseSong(text);
    if (!result.ok) {
      setError(result.reason);
      return;
    }

    loadSong(result.song);
  }

  const notice = !supported
    ? "이 브라우저는 Web Audio를 지원하지 않아 재생할 수 없습니다."
    : error;

  return (
    <div className="flex flex-1 flex-wrap items-center gap-5">
      <button
        type="button"
        onClick={isPlaying ? stop : play}
        disabled={!supported}
        className="w-[86px] rounded-md border border-white/10 bg-white/[0.07] px-3 py-1.5 text-[13px] text-zinc-100 transition-colors hover:bg-white/[0.13] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPlaying ? "■ 정지" : "▶ 재생"}
      </button>

      <button
        type="button"
        onClick={undo}
        // 편집은 정지 중에만 일어나므로 실행취소도 정지 중에만 연다 — 재생
        // 중에 되돌리면 화면과 엔진이 서로 다른 곡을 드는 문제는
        // StudioProvider.undo 쪽 가드로 이미 막혀 있지만, 버튼 자체를 눌러도
        // 아무 일도 안 나는 채로 놔두면 "눌렀는데 반응 없음"으로 보인다.
        disabled={!canUndo || !editable}
        aria-label="실행 취소"
        className="rounded-md border border-white/10 bg-white/[0.07] px-3 py-1.5 text-[13px] text-zinc-100 transition-colors hover:bg-white/[0.13] disabled:cursor-not-allowed disabled:opacity-40"
      >
        ↩ 실행 취소
      </button>

      <button
        type="button"
        onClick={() => downloadSong(song)}
        disabled={!editable}
        aria-label="곡 저장"
        className="rounded-md border border-white/10 bg-white/[0.07] px-3 py-1.5 text-[13px] text-zinc-100 transition-colors hover:bg-white/[0.13] disabled:cursor-not-allowed disabled:opacity-40"
      >
        ⭳ 저장
      </button>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={!editable}
        aria-label="곡 불러오기"
        className="rounded-md border border-white/10 bg-white/[0.07] px-3 py-1.5 text-[13px] text-zinc-100 transition-colors hover:bg-white/[0.13] disabled:cursor-not-allowed disabled:opacity-40"
      >
        ⭱ 불러오기
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onPickFile}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />

      {/* 폭이 흔들리지 않게 tabular-nums + 고정 자릿수 */}
      <div
        aria-label="현재 위치"
        className="font-mono text-[15px] tabular-nums text-zinc-200"
      >
        {String(position.bar).padStart(3, "0")}
        <span className="text-zinc-600">:</span>
        {position.beat}
      </div>

      <label className="flex items-center gap-2.5 text-[13px] text-zinc-400">
        <span className="text-zinc-500">♩</span>
        <input
          type="range"
          min={MIN_TEMPO}
          max={MAX_TEMPO}
          step={1}
          value={tempo}
          onChange={(e) => setTempo(Number(e.target.value))}
          aria-label="템포"
          className="w-36 accent-zinc-400"
        />
        <span className="w-8 font-mono tabular-nums text-zinc-200">{tempo}</span>
      </label>

      <label className="flex items-center gap-2 text-[13px] text-zinc-400">
        <input
          type="checkbox"
          checked={metronome}
          onChange={(e) => setMetronome(e.target.checked)}
          className="accent-zinc-400"
        />
        메트로놈
      </label>

      {notice && (
        <p
          className={`ml-auto text-[13px] ${
            supported ? "text-red-400" : "text-amber-400"
          }`}
        >
          {notice}
        </p>
      )}
    </div>
  );
}
