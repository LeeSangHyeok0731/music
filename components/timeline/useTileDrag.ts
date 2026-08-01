"use client";

import { useCallback, useRef } from "react";

import { pxToTick } from "./layout";

export type DragKind = "move" | "resize";

type DragState = {
  kind: DragKind;
  tileId: string;
  startTick: number;
  lengthTick: number;
  originX: number;
  /** 드래그 시작 시점의 폭. offsetWidth를 매번 읽으면 값이 누적된다. */
  originWidth: number;
  element: HTMLElement;
};

/**
 * 타일 드래그. 드래그 중에는 곡 데이터를 건드리지 않고 DOM만 옮긴다.
 *
 * 매 pointermove마다 setSong을 부르면 곡 전체가 교체되고 실행취소
 * 히스토리에 수십 개가 쌓인다. 커밋은 pointerup에서 한 번뿐이다.
 */
export function useTileDrag({
  perBar,
  onCommitMove,
  onCommitResize,
}: {
  perBar: number;
  onCommitMove: (tileId: string, startTicks: number) => void;
  onCommitResize: (tileId: string, lengthTicks: number) => void;
}) {
  const drag = useRef<DragState | null>(null);

  const onPointerDown = useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      kind: DragKind,
      tileId: string,
      startTick: number,
      lengthTick: number,
    ) => {
      const element = event.currentTarget;
      // 포인터가 요소 밖으로 나가도 추적이 끊기지 않게 한다
      element.setPointerCapture(event.pointerId);
      drag.current = {
        kind,
        tileId,
        startTick,
        lengthTick,
        originX: event.clientX,
        originWidth: element.offsetWidth,
        element,
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state) return;

      const deltaPx = event.clientX - state.originX;

      if (state.kind === "move") {
        // transform만 바꾼다 — 레이아웃이 다시 계산되지 않는다
        state.element.style.transform = `translateX(${deltaPx}px)`;
      } else {
        // 시작 시점의 폭에서 계산한다. offsetWidth를 매번 읽으면 방금 쓴
        // 값을 다시 읽어 폭이 누적되며 폭주한다.
        state.element.style.width = `${Math.max(4, state.originWidth + deltaPx)}px`;
      }
    },
    [],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state) return;
      drag.current = null;

      const deltaTick = pxToTick(event.clientX - state.originX, perBar);

      // 미리보기를 되돌린다. 커밋된 곡이 새로 렌더되면서 제자리를 잡는다.
      state.element.style.transform = "";
      state.element.style.width = "";

      if (state.kind === "move") {
        onCommitMove(state.tileId, state.startTick + deltaTick);
      } else {
        onCommitResize(state.tileId, state.lengthTick + deltaTick);
      }
    },
    [perBar, onCommitMove, onCommitResize],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}
