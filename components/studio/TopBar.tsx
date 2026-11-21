"use client";

import { MAX_TEMPO, MIN_TEMPO } from "@/lib/score/model";
import { useStudio } from "@/state/useStudio";

import { MessageStrip, useAudioSupported } from "./MessageStrip";
import { SampleStatus } from "./SampleStatus";
import { parseTempoInput } from "./tempo";

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
    canUndo,
    undo,
    play,
    stop,
    setTempo,
    metronome,
    setMetronome,
  } = useStudio();
  const supported = useAudioSupported();

  return (
    <header className="border-b border-white/10 bg-[#141519] text-sm text-zinc-200">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
        {playing || pending ? (
          // 재생 대기(샘플 내려받기·디코드) 중에도 멈출 수 있어야 한다. 받기가 영영 끝나지
          // 않아도 새로고침 말고 빠져나올 길이 있어야 해서다. 정지 버튼 하나만 보인다.
          <button type="button" onClick={stop} className={BUTTON}>
            정지
          </button>
        ) : (
          <button
            type="button"
            disabled={!supported}
            onClick={() => void play()}
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

      <MessageStrip />
    </header>
  );
}
