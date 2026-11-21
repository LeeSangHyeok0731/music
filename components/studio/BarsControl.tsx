"use client";

import { MAX_BARS_UI, MIN_BARS } from "@/lib/score/edit";
import { useStudio } from "@/state/useStudio";

import { RULER_HEIGHT } from "./layout";

/** 격자 오른쪽 끝에 붙는 컨트롤 열의 폭(px). `Studio`가 스테이지 최소 폭을 줄이는 데 쓴다. */
export const BARS_CONTROL_WIDTH = 72;

const BUTTON =
  "flex size-6 items-center justify-center rounded border border-white/15 text-zinc-200 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * 마디 추가·삭제. 눈금자 행과 같은 높이로 마지막 마디 뒤에 놓여 타임라인과 함께
 * 가로 스크롤된다. 곡이 `MAX_BARS_UI`를 넘으면(불러온 곡) 두 버튼 모두 막는다 —
 * 순수 `setBars`가 64로 잘라 내용을 지우기 때문이다.
 */
export function BarsControl() {
  const { song, editable, edit } = useStudio();
  const oversized = song.bars > MAX_BARS_UI;
  const canAdd = editable && !oversized && song.bars < MAX_BARS_UI;
  const canRemove = editable && !oversized && song.bars > MIN_BARS;

  return (
    <div
      data-testid="bars-control"
      className="flex shrink-0 items-center justify-center gap-1"
      style={{ width: BARS_CONTROL_WIDTH, height: RULER_HEIGHT }}
    >
      <button
        type="button"
        aria-label="마디 삭제"
        disabled={!canRemove}
        onClick={() => edit.setBars(song.bars - 1)}
        className={BUTTON}
      >
        －
      </button>
      <button
        type="button"
        aria-label="마디 추가"
        disabled={!canAdd}
        onClick={() => edit.setBars(song.bars + 1)}
        className={BUTTON}
      >
        ＋
      </button>
    </div>
  );
}
