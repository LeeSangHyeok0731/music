"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { SNAP_TICKS } from "@/lib/score/edit";
import { midiToName } from "@/lib/score/notes";
import { ticksPerBar } from "@/lib/score/time";
import { useStudio } from "@/state/StudioProvider";

import { PITCHED_LINE_HEIGHT, RULER_HEIGHT, lineHeight, tickToPx } from "./layout";
import { NotePickerModal } from "./NotePickerModal";

/**
 * 팝오버 자체의 폭. 스테이지 오른쪽 경계를 벗어나지 않게 클램프할 때 쓴다.
 * 아래 JSX의 `w-[190px]`와 같은 값이어야 한다.
 */
const POPOVER_WIDTH = 190;

/** 앞 네 개는 박자표와 무관한 순수 음가라 리터럴로 둔다. 1마디만 박자표에 따라 달라진다. */
const NOTE_VALUE_CHOICES: Array<{ label: string; ticks: number }> = [
  { label: "1/16", ticks: 120 },
  { label: "1/8", ticks: 240 },
  { label: "1/4", ticks: 480 },
  { label: "1/2", ticks: 960 },
];

/**
 * 길이 드롭다운 선택지. "1마디"는 4/4가 아니면 1920틱이 아니므로
 * song.timeSignature로 매번 다시 계산한다.
 */
function lengthChoices(
  timeSignature: [number, number],
): Array<{ label: string; ticks: number }> {
  return [
    ...NOTE_VALUE_CHOICES,
    { label: "1마디", ticks: ticksPerBar(timeSignature) },
  ];
}

/**
 * 목록에 없는 길이(드래그 리사이즈로 만들어진 값)를 음악적으로 표현한다.
 * 길이는 항상 16분음표(SNAP_TICKS)의 정수배이므로 "1/16 × n"이 항상
 * 정확하고, 위 목록의 표기 방식과도 어울린다. "360틱"처럼 raw 틱 수를
 * 그대로 보여주면 음가 단위로 쓰인 다른 항목들 사이에서 버그처럼 읽힌다.
 */
function describeLength(ticks: number): string {
  return `1/16 × ${ticks / SNAP_TICKS}`;
}

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
      // 이 가드는 팝오버가 같이 닫히는 걸 막지 못한다 — Timeline.tsx의
      // window keydown 리스너가 따로 있고, 그쪽이 모달 열림 여부와 무관하게
      // Esc에서 select(null)을 부르기 때문이다(그 리스너 쪽에 가드가 있다).
      // 여기 있는 건 이 컴포넌트가 자기 자신의 리스너에서 이중으로
      // select(null)을 부르지 않게 하는 것뿐이다.
      if (pickerOpen) return;
      if (event.key === "Escape") select(null);
    }
    function onPointerDown(event: PointerEvent) {
      // 모달은 createPortal로 body 바로 아래에 뜨므로 이 ref 안에 없다.
      // 가드가 없으면 모달 안을 클릭할 때마다 "바깥 클릭"으로 오인해
      // 팝오버가 먼저 닫히고 그 아래 모달만 허공에 남는다.
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

  // 스테이지 오른쪽 경계를 넘지 않게 클램프한다. Timeline.tsx가 쓰는 것과
  // 같은 식으로 스테이지 폭을 구한다 — 이 값이 다르면 클램프 지점도 어긋난다.
  // 마지막 마디의 타일은 클램프가 없으면 팝오버가 190px 폭만큼 스테이지
  // 밖으로 밀려나 가로 스크롤 범위를 그만큼 늘려 버린다.
  const stageWidth = tickToPx(song.lengthTicks, perBar);
  const left = Math.min(
    tickToPx(tile.start, perBar),
    Math.max(0, stageWidth - POPOVER_WIDTH),
  );

  // 1마디의 틱 수는 박자표에 따라 달라진다(4/4가 아니면 1920이 아니다).
  const choices = lengthChoices(song.timeSignature);

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
          left,
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
            // 제스처가 끊기면(터치 스크롤이 포인터를 가져가는 pointercancel,
            // 또는 그 결과로 캡처를 잃는 lostpointercapture) 커밋하지 않고
            // 미리보기만 비운다 — 슬라이더 값은 자동으로 tile.velocity로
            // 되돌아간다(value={velocityDraft ?? ...}). useTileDrag의
            // onPointerCancel도 같은 상황에서 커밋 없이 미리보기만 되돌리므로
            // 여기도 같은 선택을 한다. 정상적인 pointerup 뒤에도
            // lostpointercapture가 따라오지만, 그때는 이미 위에서 draft가
            // null이 되어 있어 여기서 다시 지워도 아무 일도 안 난다.
            onPointerCancel={() => setVelocityDraft(null)}
            onLostPointerCapture={() => setVelocityDraft(null)}
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
            {choices.map((choice) => (
              <option key={choice.ticks} value={choice.ticks}>
                {choice.label}
              </option>
            ))}
            {choices.every((c) => c.ticks !== tile.length) && (
              <option value={tile.length}>{describeLength(tile.length)}</option>
            )}
          </select>
        </label>
      </div>
      {/*
        body에 포털로 띄운다. .timeline-scroll 안(이 컴포넌트가 렌더되는
        위치)에 그대로 두면 fixed 백드롭이 스크롤 컨테이너의 자손이 되어,
        모달 위에서 휠을 굴리면 뒤의 타임라인이 스크롤된다 — 백드롭 자신은
        스크롤되지 않으니 이벤트가 가장 가까운 스크롤 가능한 조상을 타고
        올라간 것이다. body 포털이면 그 조상이 없다.
        (ref 밖으로 나가는 결과는 같아서, 위 useEffect의 pickerOpen 가드도
        여전히 필요하다 — window 리스너는 DOM 포함 관계로만 판정한다.)
      */}
      {pickerOpen &&
        createPortal(
          <NotePickerModal
            initialNotes={tile.notes}
            onCancel={() => setPickerOpen(false)}
            onConfirm={(notes) => {
              edit.setNotes(line.id, tile.id, notes);
              setPickerOpen(false);
            }}
          />,
          document.body,
        )}
    </>
  );
}
