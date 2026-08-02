"use client";

import { useEffect, useRef, useState } from "react";

import { midiToName } from "@/lib/score/notes";
import { useStudio } from "@/state/StudioProvider";

import { PITCHED_LINE_HEIGHT, RULER_HEIGHT, lineHeight, tickToPx } from "./layout";
import { NotePickerModal } from "./NotePickerModal";

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
  const { song, selection, select, edit, editable } = useStudio();
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 슬라이더를 끄는 동안의 미리보기. 커밋은 손을 뗄 때 한 번만 한다. */
  const [velocityDraft, setVelocityDraft] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const line = selection
    ? song.lines.find((l) => l.id === selection.lineId)
    : undefined;
  const tile = line?.tiles.find((t) => t.id === selection?.tileId);
  // 재생 중에는 열지 않는다. 편집 핸들러가 전부 no-op이라 열어두면 조작할 수
  // 있는 척하면서 아무 일도 안 하는 패널이 된다.
  const open = Boolean(
    editable && selection && line && tile && line.kind === "pitched",
  );

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      // 모달이 떠 있는 동안은 모달 자신의 Esc 핸들러가 모달만 닫는다.
      // 여기서도 반응하면 팝오버까지 같이 닫혀 선택이 풀려 버린다.
      if (pickerOpen) return;
      if (event.key === "Escape") select(null);
    }
    function onPointerDown(event: PointerEvent) {
      // 모달은 이 ref 바깥(포털처럼 body 레벨)에 뜬다. 가드가 없으면
      // 모달 안을 클릭할 때마다 "바깥 클릭"으로 오인해 팝오버가 먼저
      // 닫히고 그 아래 모달만 허공에 남는다.
      if (pickerOpen) return;
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
  }, [open, select, pickerOpen]);

  if (!open || !line || !tile || !selection) return null;

  // 이 라인의 위쪽 모서리가 스테이지에서 몇 px 아래인지
  let lineTop = RULER_HEIGHT;
  for (const l of song.lines) {
    if (l.id === line.id) break;
    lineTop += lineHeight(l.kind);
  }

  // 항상 타일 아래에 둔다. 위로 뒤집지 않는다.
  //
  // 원래는 "아래쪽 라인이면 위로 뒤집는다"였는데, 그 판정이 아래에 남은
  // 공간이 아니라 아래 라인들의 높이 합을 재고 있었다. 스테이지는 min-h-full
  // 이라 라인 아래로 화면 끝까지 늘어나 있고, 그 여백은 계산에 잡히지 않는다.
  // 그래서 4라인짜리 지금 곡에서도 둘째 라인부터 뒤집혔고, 뒤집힌 팝오버는
  // top이 음수가 되어 스크롤 컨테이너 위로 잘려 나갔다 — 아래로 넘치는 것과
  // 달리 위로 잘린 내용은 스크롤로도 볼 수 없다.
  //
  // 아래로만 두면 넘치더라도 스크롤해서 볼 수 있다. 라인이 아주 많아져
  // 아래로 밀리는 게 문제가 되면 그때는 스크롤 컨테이너 크기를 실제로 재야지,
  // 데이터 높이로 추정하면 안 된다.
  return (
    <>
      <div
        ref={ref}
        className="absolute z-20 w-[190px] rounded-md border border-white/15 bg-[#16171c] p-2.5 text-[11px] shadow-lg"
        style={{
          left: tickToPx(tile.start, perBar),
          top: lineTop + PITCHED_LINE_HEIGHT + 4,
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
          <button
            type="button"
            aria-label="음 고르기"
            className="rounded bg-white/10 px-1.5 py-0.5"
            onClick={() => setPickerOpen(true)}
          >
            +
          </button>
        </div>

        <label className="mb-2 flex items-center gap-2 text-zinc-500">
          세기
          {/*
            끄는 동안에는 미리보기만 갱신하고 손을 뗄 때 한 번 커밋한다.
            onChange마다 커밋하면 슬라이더를 한 번 끄는 것만으로 실행취소
            히스토리 50칸이 1%짜리 항목으로 가득 차 이전 편집이 전부 밀려난다.
            타일 드래그가 같은 이유로 pointerup에서만 커밋한다.
          */}
          <input
            type="range"
            min={0}
            max={100}
            value={velocityDraft ?? Math.round(tile.velocity * 100)}
            className="flex-1 accent-zinc-400"
            onChange={(event) => setVelocityDraft(Number(event.target.value))}
            onPointerUp={() => {
              if (velocityDraft === null) return;
              edit.setVelocity(line.id, tile.id, velocityDraft / 100);
              setVelocityDraft(null);
            }}
            onKeyUp={() => {
              if (velocityDraft === null) return;
              edit.setVelocity(line.id, tile.id, velocityDraft / 100);
              setVelocityDraft(null);
            }}
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
      {/*
        팝오버의 ref 바깥에 둔다. 팝오버는 pointerdown이 이 ref 밖이면
        선택을 풀도록 되어 있는데, 모달을 ref 안에 두면 모달 내부 클릭도
        "바깥 클릭"으로 오인해 팝오버가 먼저 닫히고 모달만 허공에 남는다.
        (위 useEffect의 pickerOpen 가드와 짝을 이루는 코드다.)
      */}
      {pickerOpen && (
        <NotePickerModal
          initialNotes={tile.notes}
          onCancel={() => setPickerOpen(false)}
          onConfirm={(notes) => {
            edit.setNotes(line.id, tile.id, notes);
            setPickerOpen(false);
          }}
        />
      )}
    </>
  );
}
