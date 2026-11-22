"use client";

import { GRID_UNITS, type GridUnit } from "@/lib/score/notes";
import { useStudio } from "@/state/useStudio";

import { MessageStrip, useAudioSupported } from "../MessageStrip";

const BUTTON =
  "rounded border border-white/15 px-3 py-1 text-zinc-200 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent";

const UNITS = Object.keys(GRID_UNITS) as GridUnit[];

export interface RollHeaderProps {
  /** "피아노 · 1~2마디" 같은 제목. */
  title: string;
  unit: GridUnit;
  onUnitChange(unit: GridUnit): void;
  onClose(): void;
}

/**
 * 피아노롤 위쪽 줄: 돌아가기, 제목, 격자 단위(라디오), 재생/정지·위치, 되돌리기, 메시지 줄.
 * 재생·되돌리기·메시지는 상단 바와 같은 `useStudio` 액션이다(재생은 곡 처음부터 전체).
 * 10Hz 위치 표본을 읽으므로 무거운 자식은 이 컴포넌트 밖(memo)에 둔다.
 */
export function RollHeader({
  title,
  unit,
  onUnitChange,
  onClose,
}: RollHeaderProps) {
  const { playing, pending, editable, position, canUndo, undo, play, stop } =
    useStudio();
  const supported = useAudioSupported();

  return (
    <header className="border-b border-white/10 bg-[#141519] text-sm text-zinc-200">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
        <button type="button" onClick={onClose} className={BUTTON}>
          ← 돌아가기
        </button>
        <h2 className="font-medium text-zinc-200">{title}</h2>

        <div
          role="radiogroup"
          aria-label="격자 단위"
          className="flex items-center gap-1"
        >
          {UNITS.map((u) => (
            <label
              key={u}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-white/15 px-2 py-1 font-mono tabular-nums has-[:checked]:bg-white/15 has-[:checked]:ring-1 has-[:checked]:ring-zinc-400"
            >
              <input
                type="radio"
                name="roll-grid-unit"
                value={u}
                checked={unit === u}
                onChange={() => onUnitChange(u)}
              />
              {u}
            </label>
          ))}
        </div>

        {playing || pending ? (
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

        <button
          type="button"
          aria-label="되돌리기"
          disabled={!(canUndo && editable)}
          onClick={undo}
          className={BUTTON}
        >
          되돌리기
        </button>
      </div>
      <MessageStrip testId="roll-message-strip" />
    </header>
  );
}
