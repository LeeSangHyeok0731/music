"use client";

import { useEffect, useRef, useState } from "react";

import { NOTE_CHOICES, midiToName } from "@/lib/score/notes";
import { useStudio } from "@/state/StudioProvider";

import { PITCHED_LINE_HEIGHT, RULER_HEIGHT, lineHeight, tickToPx } from "./layout";

const LENGTH_CHOICES: Array<{ label: string; ticks: number }> = [
  { label: "1/16", ticks: 120 },
  { label: "1/8", ticks: 240 },
  { label: "1/4", ticks: 480 },
  { label: "1/2", ticks: 960 },
  { label: "1마디", ticks: 1920 },
];

/**
 * 선택된 타일의 설정. 타일 아래에 뜨고, 아래 공간이 모자라면 위로 뒤집는다.
 * 드럼 타일에는 뜨지 않는다 — 격자 칸은 시작 시점과 길이가 이미 정해져 있다.
 */
export function TilePopover({ perBar }: { perBar: number }) {
  const { song, selection, select, edit } = useStudio();
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const line = selection
    ? song.lines.find((l) => l.id === selection.lineId)
    : undefined;
  const tile = line?.tiles.find((t) => t.id === selection?.tileId);
  const open = Boolean(selection && line && tile && line.kind === "pitched");

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") select(null);
    }
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        select(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    // 타일 클릭 자체가 이 핸들러를 즉시 부르지 않도록 캡처가 아닌 버블로 듣는다
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, select]);

  if (!open || !line || !tile || !selection) return null;

  // 이 라인의 위쪽 모서리가 스테이지에서 몇 px 아래인지
  let lineTop = RULER_HEIGHT;
  for (const l of song.lines) {
    if (l.id === line.id) break;
    lineTop += lineHeight(l.kind);
  }

  // 스테이지 아래쪽 라인이면 위로 뒤집는다. 아래에 뜨면 화면 밖으로 나간다.
  const stageHeight =
    RULER_HEIGHT +
    song.lines.reduce((sum, l) => sum + lineHeight(l.kind), 0);
  const flipUp = lineTop + PITCHED_LINE_HEIGHT > stageHeight - 160;

  return (
    <div
      ref={ref}
      className="absolute z-20 w-[190px] rounded-md border border-white/15 bg-[#16171c] p-2.5 text-[11px] shadow-lg"
      style={{
        left: tickToPx(tile.start, perBar),
        // 뒤집을 때는 라인 위쪽 모서리를 기준으로 두고 자기 높이만큼 끌어올린다
        top: flipUp ? lineTop - 4 : lineTop + PITCHED_LINE_HEIGHT + 4,
        transform: flipUp ? "translateY(-100%)" : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-zinc-500">음</span>
        {tile.notes.map((note) => (
          <span
            key={note}
            className="inline-flex items-center gap-1 rounded bg-indigo-500/30 px-1.5 py-0.5 font-mono text-indigo-100"
          >
            {midiToName(note)}
            <button
              type="button"
              aria-label={`${midiToName(note)} 제거`}
              disabled={tile.notes.length === 1}
              className="text-indigo-300 disabled:opacity-30"
              onClick={() =>
                edit.setNotes(
                  line.id,
                  tile.id,
                  tile.notes.filter((n) => n !== note),
                )
              }
            >
              ×
            </button>
          </span>
        ))}
        {adding ? (
          <select
            autoFocus
            aria-label="음 추가"
            className="rounded bg-white/10 px-1 py-0.5 font-mono"
            defaultValue=""
            onChange={(event) => {
              const note = Number(event.target.value);
              setAdding(false);
              if (!Number.isNaN(note) && !tile.notes.includes(note)) {
                edit.setNotes(line.id, tile.id, [...tile.notes, note].sort((a, b) => a - b));
              }
            }}
            onBlur={() => setAdding(false)}
          >
            <option value="" disabled>
              선택
            </option>
            {NOTE_CHOICES.map((note) => (
              <option key={note} value={note}>
                {midiToName(note)}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            aria-label="음 추가"
            className="rounded bg-white/10 px-1.5 py-0.5"
            onClick={() => setAdding(true)}
          >
            +
          </button>
        )}
      </div>

      <label className="mb-2 flex items-center gap-2 text-zinc-500">
        세기
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(tile.velocity * 100)}
          aria-label="세기"
          className="flex-1 accent-zinc-400"
          onChange={(event) =>
            edit.setVelocity(line.id, tile.id, Number(event.target.value) / 100)
          }
        />
      </label>

      <label className="flex items-center gap-2 text-zinc-500">
        길이
        <select
          value={tile.length}
          aria-label="길이"
          className="flex-1 rounded bg-white/10 px-1 py-0.5 font-mono"
          onChange={(event) =>
            edit.resize(line.id, tile.id, Number(event.target.value))
          }
        >
          {LENGTH_CHOICES.map((choice) => (
            <option key={choice.ticks} value={choice.ticks}>
              {choice.label}
            </option>
          ))}
          {LENGTH_CHOICES.every((c) => c.ticks !== tile.length) && (
            <option value={tile.length}>{tile.length}틱</option>
          )}
        </select>
      </label>
    </div>
  );
}
