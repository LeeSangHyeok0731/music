"use client";

import { useEffect, useState } from "react";

import {
  MAX_OCTAVE,
  MIN_OCTAVE,
  NATURAL_SEMITONES,
  SHARP_SEMITONES,
  midiOf,
  midiToName,
  octaveOf,
} from "@/lib/score/notes";

/**
 * 검은건이 걸치는 흰건 이음매. 키는 반음(semitone) 값이지 배열 위치가
 * 아니다 — SHARP_SEMITONES를 순서대로 도는 코드가 아니라 값으로 조회한다.
 * 반음이 균등 분포가 아니라 미/파, 시/도 사이에는 검은건이 없기 때문에
 * 칸 개수로 흩뿌리면 자리가 틀어진다 — 실제 이음매 위치를 표로 못박는다.
 * (도# 도레 사이, 레# 레미 사이, 파# 파솔 사이, 솔# 솔라 사이, 라# 라시 사이)
 * SHARP_SEMITONES 값이 아닌 걸 넣으면 컴파일 타임에 걸리도록 키 타입을
 * 그 튜플로 좁힌다 — 표 갱신을 빠뜨리면 런타임에 undefined가 되어
 * left: NaN으로 조용히 0번 위치에 겹치는 사고를 막는다.
 */
const SHARP_SEAM_INDEX: Record<(typeof SHARP_SEMITONES)[number], number> = {
  1: 1, // 도#: 도(0)와 레(1) 사이
  3: 2, // 레#: 레(1)와 미(2) 사이
  6: 4, // 파#: 파(3)와 솔(4) 사이
  8: 5, // 솔#: 솔(4)와 라(5) 사이
  10: 6, // 라#: 라(5)와 시(6) 사이
};

const WHITE_KEY_WIDTH = 44;
const WHITE_KEY_HEIGHT = 140;
const BLACK_KEY_WIDTH = 28;
const BLACK_KEY_HEIGHT = 88;

interface NotePickerModalProps {
  initialNotes: number[];
  onCancel: () => void;
  onConfirm: (notes: number[]) => void;
}

/**
 * 타일 전체 음을 편집하는 중앙 모달. 드래프트만 건드리다가 확인을 눌러야
 * edit.setNotes로 커밋된다 — 취소/Esc는 드래프트를 그냥 버린다.
 */
export function NotePickerModal({
  initialNotes,
  onCancel,
  onConfirm,
}: NotePickerModalProps) {
  const [draft, setDraft] = useState<number[]>(initialNotes);
  // 타일의 가장 낮은 음이 있는 옥타브에서 시작한다. 코드를 쌓을 때 보통
  // 낮은 음부터 보게 되므로 그쪽이 열려 있는 게 자연스럽다.
  const [octave, setOctave] = useState(() =>
    initialNotes.length > 0
      ? octaveOf(Math.min(...initialNotes))
      : 4,
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function toggleNote(note: number) {
    setDraft((prev) =>
      prev.includes(note)
        ? prev.filter((n) => n !== note)
        : [...prev, note],
    );
  }

  const sortedDraft = [...draft].sort((a, b) => a - b);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(event) => {
        // 모달 바깥(백드롭) 클릭은 취소로 취급한다.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="음 고르기"
        className="w-[420px] rounded-lg border border-white/15 bg-[#141519] p-4 text-zinc-200 shadow-xl"
      >
        <h2 className="mb-3 text-sm font-medium text-zinc-200">음 고르기</h2>

        <div className="mb-4 flex min-h-[26px] flex-wrap items-center gap-1 rounded border border-white/10 bg-white/5 p-1.5">
          <span className="mr-1 text-[11px] text-zinc-500">선택</span>
          {sortedDraft.length === 0 && (
            <span id="note-picker-empty-hint" className="text-[11px] text-zinc-500">
              없음
            </span>
          )}
          {sortedDraft.map((note) => (
            <button
              key={note}
              type="button"
              aria-label={`${midiToName(note)} 제거`}
              className="inline-flex items-center gap-1 rounded bg-indigo-500/30 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-indigo-100"
              onClick={() => toggleNote(note)}
            >
              {midiToName(note)}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>

        <div className="mb-2 flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label="이전 옥타브"
            disabled={octave <= MIN_OCTAVE}
            className="rounded px-2 py-1 text-zinc-400 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
            onClick={() => setOctave((o) => Math.max(MIN_OCTAVE, o - 1))}
          >
            ◀
          </button>
          <span className="font-mono text-xs tabular-nums text-zinc-400">
            {octave}옥타브
          </span>
          <button
            type="button"
            aria-label="다음 옥타브"
            disabled={octave >= MAX_OCTAVE}
            className="rounded px-2 py-1 text-zinc-400 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
            onClick={() => setOctave((o) => Math.min(MAX_OCTAVE, o + 1))}
          >
            ▶
          </button>
        </div>

        <div
          className="relative mx-auto mb-4"
          style={{
            width: NATURAL_SEMITONES.length * WHITE_KEY_WIDTH,
            height: WHITE_KEY_HEIGHT,
          }}
        >
          <div className="flex h-full">
            {NATURAL_SEMITONES.map((semitone) => {
              const note = midiOf(octave, semitone);
              const active = draft.includes(note);
              return (
                <button
                  key={semitone}
                  type="button"
                  aria-label={midiToName(note)}
                  aria-pressed={active}
                  className={`flex h-full flex-1 items-end justify-center rounded-b border border-white/20 pb-2 font-mono text-[11px] ${
                    active
                      ? "bg-indigo-400 text-zinc-900"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                  style={{ minWidth: WHITE_KEY_WIDTH }}
                  onClick={() => toggleNote(note)}
                >
                  {midiToName(note)}
                </button>
              );
            })}
          </div>

          {SHARP_SEMITONES.map((semitone) => {
            const note = midiOf(octave, semitone);
            const active = draft.includes(note);
            const seamIndex = SHARP_SEAM_INDEX[semitone];
            // 이음매 좌표: seamIndex번째 흰건과 (seamIndex+1)번째 흰건의 경계.
            const left =
              seamIndex * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2;
            return (
              <button
                key={semitone}
                type="button"
                aria-label={midiToName(note)}
                aria-pressed={active}
                className={`absolute top-0 z-10 rounded-b border border-black/40 font-mono text-[10px] ${
                  active
                    ? "bg-indigo-500 text-white"
                    : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                } flex items-end justify-center pb-1.5`}
                style={{
                  left,
                  width: BLACK_KEY_WIDTH,
                  height: BLACK_KEY_HEIGHT,
                }}
                onClick={() => toggleNote(note)}
              >
                {midiToName(note)}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-white/10 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10"
            onClick={onCancel}
          >
            취소
          </button>
          <button
            type="button"
            // 빈 선택은 setTileNotes가 조용히 무시한다 — 눌러도 아무 일도
            // 안 일어나는 버튼 대신 아예 비활성화해서 이유를 보여준다.
            // aria-describedby는 비활성화된 이유("없음")를 스크린 리더에도
            // 연결한다 — 그 span은 정확히 이 disabled 조건에서만 존재한다.
            disabled={sortedDraft.length === 0}
            aria-describedby={
              sortedDraft.length === 0 ? "note-picker-empty-hint" : undefined
            }
            className="rounded bg-indigo-500 px-3 py-1 text-xs text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-indigo-500"
            onClick={() => onConfirm(sortedDraft)}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
